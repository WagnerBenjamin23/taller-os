# TallerOS — Fase 1

Repositorio inicial para un SaaS de talleres mecánicos. Incluye infraestructura de desarrollo y una verificación de liveness. No implementa Auth, tenants, RLS, tablas de negocio, portal, R2 ni funciones del producto.

La arquitectura aprobada, incluidos los siete ajustes, está en [docs/architecture.md](docs/architecture.md). No continuar a Fase 2 sin revisión.

## Requisitos

- Node 24 LTS y npm 11; versiones registradas en `.nvmrc`, `packageManager` y lockfile.
- Docker Engine/Docker Desktop en ejecución **sólo para Supabase local**.
- Git. No se requiere cuenta Cloudflare para desarrollo local ni dry-run.

## Instalación y desarrollo

```bash
npm ci
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
npm run dev
```

Web en `http://127.0.0.1:5173`, API en `http://127.0.0.1:8787/api/v1/health`. Vite proxifica `/api` al Worker. `predev` genera assets para que Wrangler encuentre el directorio al arrancar. Para probar únicamente el artefacto compilado: `npm run build` y `npm run dev -w @talleros/api`; abrir puerto 8787.

La página técnica permite comprobar el contrato API. `status: ok` demuestra que el Worker responde, **no** que Supabase/R2 estén configurados ni que exista autenticación. No hay datos ni permisos de producto.

## Checks

```bash
npm run check
npm run verify:config
npm run smoke
```

`check` ejecuta formato, ESLint sin warnings, typecheck strict, Vitest de web/API/contratos, build Vite y `wrangler deploy --dry-run`. `smoke` inicia Wrangler/workerd real local, comprueba API/HTML/assets/headers y lo detiene; ejecutar después del build. `verify:config` valida config Supabase y routing de Wrangler, sin conectar a bases remotas. Para formatear: `npm run format`.

## Supabase local

```bash
npm run db:start
npm run db:status
npm run db:reset
npm run db:lint
npm run db:test
npm run db:stop
```

La CLI está fijada como dependencia. Configuración en `supabase/config.toml`: API 54321, PostgreSQL 54322, Studio 54323, correo local 54324. Redirects exactos para loopback en 5173/8787 y confirmación de email activada. Usar sólo credenciales locales mostradas por CLI, sin publicarlas en Git o logs.

Fase 1 tiene una migración de infraestructura que revoca grants por defecto para futuras tablas/funciones privadas en `public`, y un test pgTAP de esos defaults; no tiene tablas de negocio. Esos defaults se aplican al propietario `postgres`: si fases futuras crean objetos con otro propietario deben ajustar sus defaults explícitamente. Cada migración futura incluirá RLS y grants revisados. Seed vacío intencional; no crear demo ni objetos de producto ahora.

`db:reset` **borra datos de la base local**. No usar `--linked`, `--db-url` ni ejecutar estos comandos sobre producción. Si Docker no está instalado, desarrollo web/API y sus checks funcionan; los comandos DB fallarán y no equivalen a una prueba SQL aprobada.

## Seguridad y variables

Inventario raíz `.env.example`; Vite carga sus variables desde `apps/web`. Sólo `VITE_*` públicas. Worker carga `.dev.vars` en `apps/api`. Los ejemplos no contienen secretos y archivos reales están ignorados. No existe configuración de `SUPABASE_SERVICE_ROLE_KEY`.

`PORTAL_RPC_GATEWAY_KEY` queda reservada para Fase 8: capacidad restringida del Worker para RPC públicas, cuya comparación hash se realizará dentro de PostgreSQL. No hay RPC ni claves generadas en Fase 1. Auth Supabase y gateway se conectarán en sus fases; no se simula éxito.

API responde JSON 404 para `/api` y `/api/*` desconocidos, nunca HTML. CORS sin wildcard; origen permitido del entorno y mismo origen. API con no-store, request_id generado y logs sin URL/query/headers. Assets con CSP y headers definidos en `apps/web/public/_headers`. CSP deberá ampliarse de forma específica al incorporar Auth/Turnstile, sin usar wildcard.

## Estructura

- `apps/web`: React/Vite/Tailwind y página técnica mínima.
- `apps/api`: Worker Fetch estándar y health endpoint.
- `packages/contracts`: contratos Zod compartidos para health y errores.
- `supabase`: config, migración y test de infraestructura.
- `docs`: arquitectura, alcance, matriz de tests y resultados.
- `scripts`: verificación de config y smoke de runtime.
- `.github/workflows/ci.yml`: checks, build, smoke y job independiente Supabase local.

## CI y despliegue

CI se dispara en push/PR: `npm ci`, checks, verificación y smoke; job separado inicia Supabase con Docker, reset, lint y pgTAP. Sin secrets, conexión remota ni despliegue automático. Es una definición lista para GitHub; no se ejecutó en GitHub hasta subir el repositorio.

Wrangler contiene local/staging/production, URLs `.invalid` deliberadas y workers.dev deshabilitado. No es una configuración lista para publicar sin editar rutas/dominio/origen y completar secrets. Dry-run valida empaquetado pero no prueba cuentas, recursos externos ni permisos de deploy. R2/rate limit no están enlazados aún.

Despliegue futuro: configurar dominio/origen por entorno, provisionar recursos, configurar secrets mediante Wrangler, validar staging y aplicar migraciones versionadas con CI protegida. No publicar ni aplicar migraciones remotas en Fase 1.

## Revisión pendiente

Ver [docs/phase-1.md](docs/phase-1.md) y [docs/test-plan.md](docs/test-plan.md). El alcance termina aquí. Las pruebas de aislamiento/roles/concurrencia/portal se conservan como requisitos bloqueantes para cuando existan esas funcionalidades; no se presentan como implementadas o aprobadas.
