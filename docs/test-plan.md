# Matriz de seguridad y negocio preservada

Todos los tests de arquitectura 0.2 siguen siendo obligatorios. En Fase 1 no existen tenants/tablas/portal y no se fabrican mocks para afirmar aislamiento. Estas pruebas se implementarán sobre PostgreSQL, Data API y Worker reales al desarrollar su fase.

| Familia          | Casos obligatorios                                                                                                                                                                                | Fase              |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------- |
| RLS/multi-tenant | A no lee ni modifica B por API/Data API; anónimo no lee datos privados; usuario sin taller; usuario de ambos talleres no mueve registros; FK cruzada falla                                        | 2 y tablas de 4–9 |
| Permisos         | OWNER/RECEPTION/MECHANIC; orden sólo asignada; finanzas ocultas; actor inactivo; membresías no elevables; último OWNER protegido; profiles mínimos                                                | 2, 5, 6           |
| Historial        | Eventos sin UPDATE/DELETE; transiciones válidas y retrocesos/cancelación con permiso; no volver a abrir terminales                                                                                | 5                 |
| Concurrencia     | Conexiones independientes; doble creación/numeración; revisiones en conflicto; rollback completo                                                                                                  | 2, 5, 6, 8        |
| Idempotencia     | Unique real en DB; replay; request hash distinto; TTL/tombstone/purga; revalidar autorización/revocación; fallo sin consumir key; ninguna respuesta guarda tokens                                 | 2, 5, 6, 8        |
| Presupuestos     | Totales exactos; snapshots; versión vigente; ítems ajenos/duplicados; descuento proporcional; PARTIALLY_APPROVED ejecuta sólo ACCEPTED; recomendaciones únicas                                    | 6, 8              |
| Portal           | Token válido, vencido, revocado, versión vieja; sin gateway o sin token; gateway no administra usuarios; allowlist sin privados; GET sin mutaciones; aprobación/rechazo y revocación concurrentes | 8                 |
| Uploads          | MIME/extensión/firma/estructura/tamaño/píxeles; límites con streaming; desconexión; cuarentena nunca pública; recuperación de huérfanos; permisos por foto                                        | 7                 |
| Archivo/turnos   | archived_at conserva historial/patente; impide nuevas operaciones; duración positiva acotada y fin derivado                                                                                       | 4, 9              |
| Frontend         | Caché por usuario/taller; logout/switch; formularios, teclado, estados y errores; mobile                                                                                                          | 2–11              |
| Operación        | Restore DB + objetos; migraciones limpias; no secretos; API no cacheada; performance y accesibilidad                                                                                              | Cada fase y 11    |

Fixture: talleres A/B; OWNER, RECEPTION y MECHANIC de A; miembro B; miembro de A+B; usuario sin taller; anónimo. Pruebas DB con pgTAP y requests de Data API, no sustituidas por unit tests.

CI extenderá sus gates a medida que haya implementaciones. Fase 11 consolida, no posterga la seguridad hasta el final.

## Estado de Fase 2 — 10 de octubre de 2026

Los casos de identidad/RLS se escribieron en `tenant_security.test.sql` (58 assertions) y `scripts/tenant-integration.mjs`, además de conservar las 6 assertions SQL de defaults. Ninguno pasó todavía en un entorno real: Docker/Podman ausentes, PostgreSQL local inaccesible. CI configura su ejecución pero no hay run aprobado. Los 45 tests unitarios no sustituyen estos gates. Los casos de negocio/portal/archivos de fases futuras permanecen íntegros y pendientes de su fase autorizada. Ver `phase-2.md`.

Correcciones de revisión: 64 assertions SQL previas preservadas + 3 de invitación terminal (67 pendientes). Integración añade aislamiento de exposición private y registro/email local/PKCE/aceptación reales, aún sin ejecutar. 51 tests unitarios pasan, incluidos continuidad de invitación/callback, TTL y UI terminal.
