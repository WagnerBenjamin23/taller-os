import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiErrorSchema, healthResponseSchema } from '@talleros/contracts';
import { handleRequest, type WorkerEnv } from './index';
const assets = vi.fn(async () => new Response('<html>base</html>'));
const env: WorkerEnv = {
  ASSETS: { fetch: assets },
  ENVIRONMENT: 'local',
  APP_ORIGIN: 'http://127.0.0.1:5173',
};
afterEach(() => {
  vi.restoreAllMocks();
  assets.mockClear();
});
describe('Worker mínimo', () => {
  it('verifica liveness y headers sin afirmar readiness de DB', async () => {
    const r = await handleRequest(new Request('https://app.test/api/v1/health'), env);
    expect(r.status).toBe(200);
    expect(healthResponseSchema.safeParse(await r.json()).success).toBe(true);
    expect(r.headers.get('Cache-Control')).toBe('no-store');
    expect(r.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(r.headers.get('X-Request-Id')).toMatch(/^[a-f0-9-]{36}$/);
  });
  it.each(['/api', '/api/unknown', '/api/public/token-secret'])(
    'no aplica fallback SPA a %s',
    async (path) => {
      const r = await handleRequest(new Request(`https://app.test${path}`), env);
      expect(r.status).toBe(404);
      expect(apiErrorSchema.safeParse(await r.json()).success).toBe(true);
      expect(assets).not.toHaveBeenCalled();
    },
  );
  it('rechaza escritura en health', async () => {
    const r = await handleRequest(
      new Request('https://app.test/api/v1/health', { method: 'POST' }),
      env,
    );
    expect(r.status).toBe(405);
    expect(r.headers.get('Allow')).toBe('GET, HEAD');
  });
  it('rechaza origen externo sin CORS wildcard', async () => {
    const r = await handleRequest(
      new Request('https://app.test/api/v1/health', { headers: { Origin: 'https://other.test' } }),
      env,
    );
    expect(r.status).toBe(403);
    expect(r.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
  it('acepta el origen de Vite configurado', async () => {
    const r = await handleRequest(
      new Request('https://app.test/api/v1/health', { headers: { Origin: env.APP_ORIGIN } }),
      env,
    );
    expect(r.status).toBe(200);
  });
  it('HEAD no contiene cuerpo y producción envía HSTS', async () => {
    const r = await handleRequest(
      new Request('https://app.test/api/v1/health', { method: 'HEAD' }),
      { ...env, ENVIRONMENT: 'production' },
    );
    expect(await r.text()).toBe('');
    expect(r.headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });
  it('delega rutas del frontend al binding de assets', async () => {
    const request = new Request('https://app.test/');
    await handleRequest(request, env);
    expect(assets).toHaveBeenCalledWith(request);
  });
  it('no registra tokens, querystrings ni headers del cliente', async () => {
    const log = vi.spyOn(console, 'info').mockImplementation(() => {});
    await handleRequest(
      new Request('https://app.test/api/public/secret-token?key=secret-query', {
        headers: { Authorization: 'Bearer secret-jwt', 'X-Request-Id': 'secret-id' },
      }),
      env,
    );
    const output = JSON.stringify(log.mock.calls);
    expect(output).not.toContain('secret');
    expect(output).toContain('unmatched-api');
  });
});
