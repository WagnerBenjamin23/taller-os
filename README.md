# TallerOS — Fase 2, pendiente de validación SQL/RLS

Fase 1 completada y revisada. Fase 2 autorizada: identidad y acceso. Fase 3 no autorizada. La implementación se entrega para revisión; **no se declara la Fase 2 completada** hasta que PostgreSQL/RLS y la integración real pasen.

Incluye Supabase Auth, perfiles, talleres, membresías OWNER/RECEPTION/MECHANIC, invitaciones, onboarding transaccional, idempotencia persistente, permisos y migraciones RLS. No incluye clientes, vehículos, órdenes, presupuestos, R2 ni pantallas de esas fases. Ver [arquitectura](docs/architecture.md), [entrega y pendientes](docs/phase-2.md) y [matriz de tests preservada](docs/test-plan.md).

## Desarrollo

Node 24, npm 11 y Docker Engine/Desktop para Supabase local. Git y cuenta Cloudflare no son necesarios para iniciar ni compilar localmente.

```bash
npm ci
npm run db:start
npm run db:reset
npm run db:status
cp apps/web/.env.example apps/web/.env.local
cp apps/api/.dev.vars.example apps/api/.dev.vars
```

Copiar la URL local y la clave **pública** de Supabase en ambos archivos: `VITE_SUPABASE_URL`/`VITE_SUPABASE_PUBLISHABLE_KEY` y `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY`. No usar `service_role`. Los archivos reales están ignorados por Git. No pegar credenciales en logs ni commits.

```bash
npm run dev
```

React/Vite: `http://127.0.0.1:5173`; Worker: `http://127.0.0.1:8787`. Vite proxifica `/api`. `predev` compila assets para Wrangler. Sin configuración Auth, el frontend muestra un skeleton explícito y las rutas de identidad responden 503; no simula sesiones.

Supabase local: API 54321, PostgreSQL 54322, Studio 54323 y correo de prueba 54324. Registro exige confirmar email; los mensajes locales se revisan en el correo de prueba. PKCE, persistencia y refresh mediante SDK; la API valida el JWT contra Auth y las RPC verifican el usuario en DB. Los enlaces PKCE deben abrirse en el navegador donde comenzó el flujo. Redirects exactos para `/auth/callback` y `/reset-password`, en 5173 y 8787. No hay SMTP remoto configurado ni se envían invitaciones automáticamente: OWNER comparte el enlace generado.

## Checks y gate SQL

```bash
npm run check
npm run verify:config
npm run smoke
npm run db:lint
npm run db:test
npm run test:integration
```

`check`: formato, lint, TypeScript strict, tests unitarios, build web y build Worker en dry-run. `smoke`: workerd real, liveness y assets; no demuestra aislamiento. `db:test`: pgTAP real. Integración: Auth real, Data API, Worker y concurrencia, exclusivamente contra Supabase local descartable; crea fixtures y requiere build previo. `db:reset` borra datos locales; nunca usar `--linked` ni URLs de producción para estos tests.

CI ejecuta instalación/checks/smoke y otro job con start/reset/lint/SQL/build/integración/stop. No despliega ni usa secretos remotos. El repositorio entregado no tiene remote GitHub: la configuración de CI **no es evidencia de un run aprobado**. En Work faltan Docker/Podman; los checks DB fallan por esa limitación. No se agregaron emuladores ni bypasses al repositorio.

## Seguridad y permisos

Todas las tablas públicas de Fase 2 tienen RLS y grants explícitos. `authenticated` sólo lee su perfil, talleres donde es miembro activo y membresías permitidas por rol. Sin DML directo; las escrituras pasan por RPC que vuelven a comprobar identidad, taller y permisos. `anon` no tiene acceso privado. Invitaciones sólo se leen por una proyección OWNER sin hashes/tokens. Helpers SECURITY DEFINER privados, `search_path=''`, wrappers públicos SECURITY INVOKER; no existe clave administrativa en web/Worker.

Último OWNER: trigger y serialización por taller. Identidades y `workshop_id` son inmutables. Una membresía inactiva bloquea ese taller aunque el JWT siga vigente; no elimina la cuenta ni impide acceder a otros talleres autorizados. La API no acepta roles ni identidades del cliente para crear taller/aceptar invitación.

Los endpoints están enumerados en `docs/phase-2.md`. Lecturas acotadas a 100; formularios mínimos. No hay paginación completa de listados aún. `PATCH /workshops/:wid` recibe la representación completa de los campos editables; campos de contacto omitidos se vacían.

Invitaciones: 32 bytes aleatorios, SHA-256 almacenado, email confirmado coincidente, vencimiento de 7 días, revocación y uso único; el emisor debe seguir siendo OWNER activo y no suspendido. No reactiva ni eleva membresías existentes. Token devuelto una sola vez; enlace con fragmento, sin query ni logs.

Idempotencia real para crear taller y aceptar invitación: clave UUID por actor/operación, hashes de clave y request, lock transaccional, respuesta sin secretos, replay por 24 h con autorización vigente. Otra carga con la misma clave da 409. Se conserva tombstone hasta 30 días; después puede reutilizarse la clave. Limpieza mediante `private.idempotency_cleanup()` exclusivamente operativa (`postgres`): **falta programar su ejecución periódica en el entorno elegido**. Las reservas fallidas se revierten con la transacción.

Assets: CSP generada al build con el origen exacto `VITE_SUPABASE_URL`, sin wildcard; configurar variables antes de compilar. La plantilla conservadora sigue en `apps/web/public/_headers`. API no-store, errores genéricos, logs de rutas de plantilla sin tokens ni parámetros. No se conectaron Turnstile, portal ni R2.

## Entrega y despliegue

Vistas estáticas en el archivo de revisión adjunto, con controles deshabilitados y sin datos de taller inventados. Muestran el skeleton actual y los formularios existentes que requieren Auth/DB para habilitarse.

Wrangler conserva entornos local/staging/production con dominios `.invalid` y workers.dev deshabilitado. Dry-run sólo empaqueta: no publica. No se aplicaron migraciones remotas ni se avanzó a Fase 3. Antes de aprobar Fase 2: pasar el job database real, corregir cualquier fallo y revisar visualmente los flujos contra Supabase local.
