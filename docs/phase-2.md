# Fase 2 — entrega para revisión

10 de octubre de 2026. Fase 1 completada y revisada; Fase 2 autorizada; Fase 3 no autorizada.

**Estado: implementación entregada, validación bloqueante SQL/RLS pendiente. No se declara Fase 2 completada.** No hubo despliegue, conexión remota ni implementación de fases posteriores.

## Implementado

- Auth SDK: registro, login, confirmación de email, recuperación, PKCE, refresh y cierre de sesión. API verifica tokens con `getUser`, no con JWT decodificado. Config local con confirmación obligatoria y contraseña mínima de 12 caracteres.
- `profiles` autogenerados desde Auth; `workshops`, `workshop_members`, `workshop_invitations`; roles OWNER/RECEPTION/MECHANIC, membresía activa y unicidad por taller/usuario.
- RPC transaccional de onboarding: taller y OWNER del usuario confirmado en una sola transacción; validación SQL y límite de abuso persistente.
- Creación, listado allowlisted, revocación y aceptación segura de invitaciones: token aleatorio/hash, email destinatario confirmado, expiración, validación del OWNER emisor y uso único. No hay envío automático de emails de invitación.
- RLS, grants mínimos, funciones privilegiadas privadas con search path vacío y wrappers públicos invoker. Escritura directa de tablas bloqueada también vía Data API.
- Serialización de cambios de miembros por taller y protección del último OWNER. Trigger de inmutabilidad de identidades/tenant.
- Ledger privado `idempotency_keys`, locks de concurrencia, request hash, replay autorizado por 24 h y tombstones de 30 días; limpieza sólo operativa.
- API estricta con DTO, límite JSON 16 KiB, timeout de upstream, errores redactados, UUIDs y permisos por taller. Sin `SUPABASE_SERVICE_ROLE_KEY`.
- Frontend mínimo de acceso, creación de taller, aceptación de invitación y administración OWNER de equipo/invitaciones. Caché separada por usuario/taller y eliminada al cerrar/cambiar sesión. Sin pantallas de clientes, vehículos, órdenes ni presupuestos.
- CSP de assets permite únicamente el origen Auth configurado al compilar; no wildcard.

## API de esta fase

Prefijo `/api/v1`; todas requieren JWT confirmado excepto health. No existe endpoint administrativo genérico.

| Ruta                                      | Método    | Permiso                                       |
| ----------------------------------------- | --------- | --------------------------------------------- |
| `/me`                                     | GET       | Perfil propio                                 |
| `/workshops`                              | GET       | Talleres con membresía activa                 |
| `/workshops`                              | POST      | Usuario confirmado; Idempotency-Key UUID      |
| `/workshops/:wid`                         | GET       | Miembro activo                                |
| `/workshops/:wid`                         | PATCH     | OWNER; representación completa editable       |
| `/workshops/:wid/access`                  | GET       | Membresía activa propia                       |
| `/workshops/:wid/members`                 | GET       | OWNER                                         |
| `/workshops/:wid/members/:mid`            | PATCH     | OWNER; rol/actividad, sin mover tenant        |
| `/workshops/:wid/invitations`             | GET, POST | OWNER                                         |
| `/workshops/:wid/invitations/:iid/revoke` | POST      | OWNER                                         |
| `/invitations/accept`                     | POST      | Destinatario confirmado; Idempotency-Key UUID |

`health.phase = 1` se conserva como contrato de liveness de infraestructura; no representa una declaración de finalización de fases.

## Migraciones y permisos

| Archivo                                   | Contenido                                                                                                                     | Estado real             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `20261003190000_secure_defaults.sql`      | Defaults deny de Fase 1, conservados                                                                                          | Sin ejecución SQL local |
| `20261003193000_identity_and_tenants.sql` | 4 tablas públicas, enum, ledger privado, índices/constraints, trigger de perfil, RLS y protección de identidades/último OWNER | Nueva; no aplicada      |
| `20261003194000_tenant_operations.sql`    | 7 RPC públicas invoker, implementaciones privadas, idempotencia y grants explícitos                                           | Nueva; no aplicada      |

`anon`: sin SELECT/DML/EXECUTE de entradas privadas. `authenticated`: SELECT del perfil propio y talleres activos. OWNER lee el roster de su taller; RECEPTION/MECHANIC sólo su membresía. Ningún rol de aplicación escribe tablas directamente. Invitaciones no tienen SELECT directo; su RPC lista metadatos sin token/hash. Ledger y limpieza inaccesibles a la aplicación. El esquema `private` no está expuesto por Data API.

Las funciones SECURITY DEFINER son propiedad del rol de migración postgres. Esta es una superficie privilegiada: sólo se otorga EXECUTE a entradas auditadas, nunca helpers de ledger/cleanup/triggers. Los roles se consultan en DB y no se confían al JWT. Una cuenta puede pertenecer a varios talleres sin heredar el rol OWNER de uno hacia otro.

Miembro inactivo no accede a ese taller; sigue pudiendo leer su propio perfil de identidad y utilizar otros talleres autorizados. Esto distingue desactivación de membresía de suspensión global Auth.

## Verificación ejecutada

| Check                    | Resultado                                                                |
| ------------------------ | ------------------------------------------------------------------------ |
| Formato                  | Aprobado                                                                 |
| ESLint sin warnings      | Aprobado                                                                 |
| TypeScript strict        | Aprobado                                                                 |
| Vitest                   | 45 tests aprobados: API 25, web 16, contratos 4                          |
| Build web                | Aprobado                                                                 |
| Build Worker             | Dry-run aprobado, sin despliegue                                         |
| Config Supabase/Wrangler | Verificación estática aprobada                                           |
| Smoke workerd            | Aprobado con adaptación externa de interfaces loopback; no es prueba RLS |
| `db:start`               | Bloqueado: no hay Docker ni Podman                                       |
| `db:test`                | Bloqueado: ECONNREFUSED en PostgreSQL local 54322                        |
| `test:integration`       | Bloqueado antes de fixtures: Supabase local no iniciado                  |
| CI GitHub                | Definido, no ejecutado; repo sin remote                                  |

Tests unitarios comprueban validación/API/permisos del Worker mediante mocks y componentes React. **No demuestran RLS ni sustituyen pruebas DB.** El build emitió una advertencia sobre un cambio futuro del loader de Vite; no afectó al resultado.

## Tests SQL/RLS pendientes, ya escritos

`supabase/tests/database/tenant_security.test.sql`: 58 assertions pgTAP, fixtures reales dentro de una transacción revertida. `secure_defaults.test.sql`: 6 assertions heredadas. Ambos siguen sin ejecutarse.

Casos bloqueantes incluidos:

- A no lee talleres/membresías de B ni escribe B por RPC; UUID reales de B no permiten IDOR.
- Anónimo sin lectura privada ni onboarding; usuario inactivo sin acceso al taller; usuario suspendido sin acceso aunque conserve JWT.
- RECEPTION/MECHANIC no modifican miembros ni elevan su propio rol; RECEPTION no invita OWNER.
- Último OWNER no se elimina, desactiva ni degrada; trigger se comprueba incluso mediante DML operativo.
- Usuario dual conserva roles distintos por taller; OWNER en B no modifica A ni mueve membresías.
- DML directo denegado, hashes/ledger ocultos, cleanup inaccesible, wrappers públicos sin SECURITY DEFINER.
- Identidad y `workshop_id` inmutables en miembros/invitaciones/talleres.
- Invitación de otro email, vencida o revocada rechazada; rol derivado del token; aceptación idempotente sin duplicados ni segundo uso.
- Onboarding atómico e idempotente; otra carga con la misma clave rechazada; usuario no confirmado bloqueado.
- Proyección de invitaciones sin token/hash; expiración de keys, tombstone y purga operativa.

`scripts/tenant-integration.mjs`: pendiente integración con Auth real, JWTs de prueba, Data API/PostgREST y Worker/workerd. Verifica aislamiento, DML directo/IDOR, roles, usuarios inactivos, dualidad, inmutabilidad y último OWNER. Requests concurrentes independientes comprueban onboarding duplicado, doble aceptación y dos OWNERS intentando degradarse simultáneamente. No utiliza claves administrativas en runtime; fixtures se crean por conexión SQL local, nunca remota.

CI ejecutará start/reset/lint/pgTAP/build/integración/stop sobre Ubuntu compatible con Docker. Para cerrar el gate hace falta un run real aprobado y revisar/corregir posibles errores de las migraciones. Configurar CI por sí solo no satisface el gate.

## Archivos agregados/modificados

Agregados:

- `apps/api/src/tenant-api.ts` y `tenant-api.test.ts`.
- `apps/web/src/auth/client.ts`, `AuthPanel.tsx`, `AuthPanel.test.tsx`.
- `apps/web/security-headers.ts` y `security-headers.test.ts`.
- Dos migraciones nuevas y `supabase/tests/database/tenant_security.test.sql`.
- `scripts/tenant-integration.mjs` y este informe.

Actualizados: contratos y tests compartidos, Worker router, App/styles, configuración Vite/Vitest/TypeScript, Supabase Auth, variables de ejemplo, dependencias/lockfile, CI, README, arquitectura y matriz de pruebas. Los tests de aislamiento, permisos, concurrencia, RLS y portal de la propuesta siguen íntegros; portal se implementará en su fase autorizada.

## Revisión visual y riesgos abiertos

`TallerOS-Fase2-Vistas.html` contiene cinco vistas estáticas derivadas del código React: entorno actual sin configuración, ingreso, registro, recuperación y formularios de onboarding/invitación. Controles deshabilitados, sin requests, sesiones o talleres inventados. Los formularios no son evidencia de funcionamiento contra Auth/DB. La vista actual en Work sigue siendo skeleton porque Supabase local no está disponible. No se alteró la arquitectura para generarlas.

Riesgos y pendientes:

1. **Bloqueante:** migraciones, SQL/RLS, grants y concurrencia no ejecutados. Podrían requerir correcciones al correr Supabase real. No habilitar producción ni aprobar Fase 2 con unit tests solamente.
2. Configurar remoto sólo en el entorno autorizado: URLs, claves públicas, redirects exactos y SMTP. Registro/confirmación/reset/refresh reales y revocación con sesión vigente necesitan prueba end-to-end. No se ha probado entrega de correo.
3. Programar limpieza operativa del ledger. Sin scheduling, los tombstones acumulan filas; las claves vencidas igual se rechazan por SQL.
4. UI básica, sin validación visual interactiva con sesión real; IDs de membresías en lugar de perfiles de terceros. Listas limitadas a 100, sin paginación completa. No hay cuenta demo.
5. Onboarding conserva una key de reintento; modificar datos tras una respuesta incierta puede dar 409 y requerir reiniciar la operación. No hay persistencia de keys en el navegador entre recargas; la persistencia autoritativa sí está en DB.
6. Rate bounds de DB iniciales (10 talleres por usuario/hora y 30 invitaciones/taller/hora); rate limiting de infraestructura/Turnstile de fases futuras no implementado.
7. Bloqueo de localhost en navegador Work y detección de interfaces de Wrangler en este entorno. El smoke puede usar la adaptación temporal externa documentada, sin cambios al repo ni deshabilitar seguridad.

La entrega se detiene para revisión. Fase 3 no iniciada.
