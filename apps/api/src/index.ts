import { healthResponseSchema, type HealthResponse } from '@talleros/contracts';
import { HttpError, matchTenantRoute, tenantApi } from './tenant-api';
export interface WorkerEnv {
  ASSETS: { fetch(request: Request): Promise<Response> };
  ENVIRONMENT: string;
  APP_ORIGIN: string;
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
}
function json(payload: unknown, status: number, requestId: string): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      'X-Request-Id': requestId,
    },
  });
}
function error(code: string, message: string, status: number, id: string): Response {
  return json({ error: { code, message, request_id: id } }, status, id);
}
export async function handleRequest(request: Request, env: WorkerEnv): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (path !== '/api' && !path.startsWith('/api/')) {
    return env.ASSETS.fetch(request);
  }
  const id = crypto.randomUUID();
  const started = performance.now();
  let response: Response;
  try {
    const origin = request.headers.get('Origin');
    if (origin && origin !== env.APP_ORIGIN && origin !== new URL(request.url).origin) {
      response = error('ORIGIN_NOT_ALLOWED', 'Origen no permitido.', 403, id);
    } else if (matchTenantRoute(path)) {
      const result = await tenantApi(request, env);
      response = json(result.body, result.status, id);
    } else if (path !== '/api/v1/health') {
      response = error('NOT_FOUND', 'Endpoint no encontrado.', 404, id);
    } else if (request.method !== 'GET' && request.method !== 'HEAD') {
      response = error('METHOD_NOT_ALLOWED', 'Método no permitido.', 405, id);
      response.headers.set('Allow', 'GET, HEAD');
    } else {
      const health: HealthResponse = {
        status: 'ok',
        service: 'talleros-api',
        version: '0.1.0',
        phase: 1,
      };
      response = json(healthResponseSchema.parse(health), 200, id);
    }
  } catch (caught) {
    if (caught instanceof HttpError) {
      response = error(caught.code, caught.message, caught.status, id);
    } else {
      response = error('INTERNAL_ERROR', 'No se pudo procesar la solicitud.', 500, id);
    }
  }
  if (env.ENVIRONMENT !== 'local') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000');
  }
  // Loguear ruta de plantilla, nunca URL, query, token o headers recibidos.
  console.info(
    JSON.stringify({
      request_id: id,
      route:
        path === '/api/v1/health' ? '/api/v1/health' : (matchTenantRoute(path) ?? 'unmatched-api'),
      method: request.method,
      status: response.status,
      duration_ms: Math.round(performance.now() - started),
    }),
  );
  return request.method === 'HEAD'
    ? new Response(null, { status: response.status, headers: response.headers })
    : response;
}
export default { fetch: handleRequest };
