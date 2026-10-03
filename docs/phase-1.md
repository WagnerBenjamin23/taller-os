# Fase 1 — entrega para revisión

Estado: implementación de infraestructura completa; detenido antes de Fase 2. No se implementaron entidades/pantallas del producto ni se desplegó en servicios remotos.

## Cambios

- Arquitectura 0.2 con los siete ajustes aprobados: RPC de portal sin service_role, aprobación parcial formal, duration_minutes, idempotencia persistente, archived_at, streaming R2 y suite de seguridad preservada.
- Git local en rama main; npm workspaces web/API/contratos, dependencias exactas y lockfile.
- TypeScript strict con comprobación de índices y propiedades opcionales.
- React/Vite/Tailwind con una página técnica mínima; Worker con health, errores, límites de routing y headers.
- Supabase CLI/config local, migración de defaults de privilegios y pgTAP de infraestructura; seed sin datos.
- Wrangler/Static Assets, build dry-run, CI de checks y job DB sin deploy, ejemplos de variables y README.

## Validación

| Check                               | Resultado                                                                                                    |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| npm ci                              | Instalación reproducible verificada con lockfile                                                             |
| Prettier                            | Aprobado                                                                                                     |
| ESLint                              | Aprobado, sin warnings del código                                                                            |
| TypeScript                          | Aprobado en 3 workspaces                                                                                     |
| Vitest                              | 14 tests aprobados: API 10, web 3, contratos 1                                                               |
| Builds                              | Contratos, Vite y Worker dry-run aprobados                                                                   |
| Config Supabase/Wrangler            | TOML/JSONC y reglas de routing validados estáticamente                                                       |
| Worker runtime                      | Smoke en workerd real aprobado: health, 404 API, 405, origen externo, HEAD, HTML, CSP, assets y fallback SPA |
| Audit de dependencias de producción | Sin vulnerabilidades reportadas en esta ejecución                                                            |
| Supabase local/SQL                  | Pendiente: no hay Docker ni Podman en el entorno                                                             |
| GitHub CI                           | Configurado; no ejecutado en GitHub porque no se creó/subió un remoto                                        |

### Límite del smoke en este entorno

Wrangler sin adaptación temporal falló en `os.networkInterfaces()` por una restricción del entorno (`uv_interface_addresses`). Para ejecutar el smoke se usó un preload externo al repositorio que devuelve únicamente loopback cuando esa enumeración falla. No modifica Worker, workerd, HTTP, bindings ni assertions. Con esa adaptación pasó el smoke real. La adaptación no se entrega ni es necesaria en equipos normales/CI; debe verificarse allí la ejecución estándar de `npm run smoke`.

La CLI Supabase pudo leer la configuración, pero `npm run db:start` falló explícitamente porque no existe Docker/Podman. Por esa dependencia, no se ejecutaron reset/lint/pgTAP sobre una DB real. Sus seis assertions se conservan y el job CI exige ejecutarlas. No se afirma que el aislamiento de negocio/RLS esté probado: sus tablas no existen todavía.

El entorno emitió avisos de proxy de npm/Wrangler; no son fallas de lint del proyecto. No se utilizó autenticación Cloudflare, recursos de Supabase remoto, R2 ni secretos reales.

## Antes de Fase 2

Revisar entrega, ejecutar `npm run check`, `npm run verify:config`, `npm run smoke` y la secuencia `db:start`, `db:reset`, `db:lint`, `db:test` en un equipo con Docker. Confirmar la migración de defaults y los seis checks SQL. Los tests de tenants/permisos/portal/concurrencia se implementarán y serán bloqueantes en sus fases, según test-plan.

No comenzar Auth, membresías ni RLS de producto hasta la revisión solicitada.
