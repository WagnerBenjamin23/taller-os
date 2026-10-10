import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleRequest, type WorkerEnv } from './index';
import { readJson } from './tenant-api';
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), from: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({ auth: { getUser: mocks.getUser }, rpc: mocks.rpc, from: mocks.from }),
}));
const uid = '11111111-1111-4111-8111-111111111111';
const wid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const mid = '10000000-0000-4000-8000-000000000001';
const env: WorkerEnv = {
  ASSETS: { fetch: async () => new Response('assets') },
  ENVIRONMENT: 'local',
  APP_ORIGIN: 'https://app.test',
  SUPABASE_URL: 'http://127.0.0.1:54321',
  SUPABASE_PUBLISHABLE_KEY: 'test-public-key',
};
function request(path: string, method = 'GET', body?: unknown) {
  return new Request(`https://app.test/api/v1${path}`, {
    method,
    headers: {
      Authorization: 'Bearer valid-token',
      'Content-Type': 'application/json',
      'Idempotency-Key': '30000000-0000-4000-8000-000000000001',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
function membership(role = 'OWNER', active = true) {
  const value = { id: mid, workshop_id: wid, user_id: uid, role, is_active: active };
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: active ? value : null, error: null }),
  };
  mocks.from.mockReturnValue(builder);
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getUser.mockResolvedValue({
    data: { user: { id: uid, email: 'owner@example.test', email_confirmed_at: '2026-10-03' } },
    error: null,
  });
  membership();
});
describe('API de identidad, sin sustituir tests RLS', () => {
  it.each(['/me', '/invitations/accept', '/workshops'])(
    'método no permitido devuelve 405: %s',
    async (path) => {
      expect((await handleRequest(request(path, 'DELETE'), env)).status).toBe(405);
      expect(mocks.rpc).not.toHaveBeenCalled();
    },
  );
  it('rechaza Bearer ausente', async () => {
    const r = await handleRequest(new Request('https://app.test/api/v1/workshops'), env);
    expect(r.status).toBe(401);
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it('verifica token remotamente y bloquea Auth inválido', async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: { message: 'internal' } });
    const r = await handleRequest(request('/workshops'), env);
    expect(r.status).toBe(401);
    expect(mocks.getUser).toHaveBeenCalledWith('valid-token');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('no confía en email sin confirmar', async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: uid, email_confirmed_at: null } },
      error: null,
    });
    expect((await handleRequest(request('/workshops'), env)).status).toBe(401);
  });
  it('crea mediante RPC y rechaza identidades extra del cliente', async () => {
    mocks.rpc.mockResolvedValue({ data: { id: wid, name: 'Taller' }, error: null });
    expect(
      (await handleRequest(request('/workshops', 'POST', { name: 'Taller' }), env)).status,
    ).toBe(201);
    expect(mocks.rpc).toHaveBeenCalledWith(
      'create_workshop',
      expect.objectContaining({ p_key: '30000000-0000-4000-8000-000000000001' }),
    );
    mocks.rpc.mockClear();
    expect(
      (
        await handleRequest(
          request('/workshops', 'POST', { name: 'Taller', workshop_id: wid, role: 'OWNER' }),
          env,
        )
      ).status,
    ).toBe(422);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each(['RECEPTION', 'MECHANIC'])('%s no modifica miembros en Worker', async (role) => {
    membership(role);
    const r = await handleRequest(
      request(`/workshops/${wid}/members/${mid}`, 'PATCH', { role: 'OWNER', is_active: true }),
      env,
    );
    expect(r.status).toBe(403);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('inactivo devuelve 404 sin RPC', async () => {
    membership('OWNER', false);
    const r = await handleRequest(
      request(`/workshops/${wid}/members/${mid}`, 'PATCH', { role: 'MECHANIC', is_active: false }),
      env,
    );
    expect(r.status).toBe(404);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('propaga LAST_OWNER sin detalles SQL', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'PT409', message: 'LAST_OWNER', details: 'secret SQL' },
    });
    const r = await handleRequest(
      request(`/workshops/${wid}/members/${mid}`, 'PATCH', { role: 'MECHANIC', is_active: false }),
      env,
    );
    expect(r.status).toBe(409);
    expect(await r.text()).not.toContain('secret SQL');
  });
  it('UUID real del recurso es enviado con contexto verificado y SQL puede denegarlo', async () => {
    const other = '10000000-0000-4000-8000-000000000002';
    mocks.rpc.mockResolvedValue({ data: null, error: { code: 'PT404', message: 'NOT_FOUND' } });
    const r = await handleRequest(
      request(`/workshops/${wid}/members/${other}`, 'PATCH', { role: 'OWNER', is_active: true }),
      env,
    );
    expect(r.status).toBe(404);
    expect(mocks.rpc).toHaveBeenCalledWith('update_member', {
      p_workshop: wid,
      p_member: other,
      p_role: 'OWNER',
      p_active: true,
    });
  });
  it('falla cerrado cuando no se configuró Supabase', async () => {
    const { SUPABASE_URL: unused, ...partial } = env;
    void unused;
    expect((await handleRequest(request('/workshops'), partial)).status).toBe(503);
  });
  it('rechaza cuerpo JSON sobredimensionado', async () => {
    await expect(
      readJson(request('/workshops', 'POST', { name: 'x'.repeat(20000) })),
    ).rejects.toMatchObject({ status: 413 });
  });
  it('no expone mensajes internos de PostgREST', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '23503', message: 'private foreign key' },
    });
    const r = await handleRequest(request('/workshops', 'POST', { name: 'Taller' }), env);
    expect(r.status).toBe(502);
    expect(await r.text()).not.toContain('private foreign key');
  });
});
