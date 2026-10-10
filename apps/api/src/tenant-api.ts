import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  acceptInvitationSchema,
  invitationInputSchema,
  invitationCreatedSchema,
  invitationAcceptedSchema,
  invitationSummarySchema,
  memberUpdateSchema,
  membershipSchema,
  workshopInputSchema,
  workshopSchema,
  workshopSummarySchema,
  meSchema,
  uuidSchema,
  can,
} from '@talleros/contracts';
import type { WorkerEnv } from './index';

export class HttpError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const messages: Record<string, string> = {
  AUTH_REQUIRED: 'Iniciá sesión con un email confirmado.',
  NOT_FOUND: 'Recurso no encontrado.',
  OWNER_REQUIRED: 'Esta operación requiere el rol OWNER.',
  MEMBERSHIP_REQUIRED: 'No tenés una membresía activa.',
  LAST_OWNER: 'El taller debe conservar al menos un OWNER activo.',
  IMMUTABLE_TENANT: 'No se puede trasladar el registro a otro taller.',
  IMMUTABLE_IDENTITY: 'No se puede cambiar la identidad del registro.',
  INVALID_INPUT: 'Revisá los datos ingresados.',
  INVITATION_INVALID: 'La invitación no está disponible para esta cuenta.',
  INVITATION_USED: 'La invitación ya fue utilizada.',
  INVITATION_ACCEPTED: 'La invitación aceptada no puede revocarse. Administrá la membresía.',
  MEMBER_ALREADY_EXISTS: 'El usuario ya tiene una membresía en el taller.',
  IDEMPOTENCY_KEY_REUSED: 'La clave de operación ya se utilizó con otros datos.',
  IDEMPOTENCY_KEY_EXPIRED: 'La clave de operación venció.',
  IDEMPOTENCY_REQUIRED: 'Falta la clave de operación.',
  RATE_LIMITED: 'Demasiadas operaciones. Intentá más tarde.',
};
function dbError(error: { code?: string; message?: string }): never {
  const code = error.message ?? '';
  if (messages[code]) {
    const status = error.code?.startsWith('PT') ? Number(error.code.slice(2)) : 500;
    throw new HttpError(code, status, messages[code]);
  }
  throw new HttpError('UPSTREAM_ERROR', 502, 'No se pudo completar la operación.');
}
export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get('Content-Type')?.startsWith('application/json'))
    throw new HttpError('INVALID_CONTENT_TYPE', 415, 'Se requiere JSON.');
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError('INVALID_INPUT', 422, 'Falta el cuerpo de la solicitud.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) {
        await reader.cancel();
        throw new HttpError('BODY_TOO_LARGE', 413, 'La solicitud excede el tamaño permitido.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown;
  } catch {
    throw new HttpError('INVALID_JSON', 400, 'JSON inválido.');
  }
}
function input<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new HttpError('INVALID_INPUT', 422, 'Revisá los datos ingresados.');
  return parsed.data;
}
export function matchTenantRoute(path: string): string | null {
  if (path === '/api/v1/me') return '/api/v1/me';
  if (path === '/api/v1/workshops') return '/api/v1/workshops';
  if (path === '/api/v1/invitations/accept') return '/api/v1/invitations/accept';
  if (/^\/api\/v1\/workshops\/[^/]+$/.test(path)) return '/api/v1/workshops/:wid';
  if (/^\/api\/v1\/workshops\/[^/]+\/(members|invitations|access)$/.test(path))
    return `/api/v1/workshops/:wid/${path.split('/')[5]}`;
  if (/^\/api\/v1\/workshops\/[^/]+\/members\/[^/]+$/.test(path))
    return '/api/v1/workshops/:wid/members/:mid';
  if (/^\/api\/v1\/workshops\/[^/]+\/invitations\/[^/]+\/revoke$/.test(path))
    return '/api/v1/workshops/:wid/invitations/:iid/revoke';
  return null;
}
export async function tenantApi(
  request: Request,
  env: WorkerEnv,
): Promise<{ body: unknown; status: number }> {
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY)
    throw new HttpError(
      'AUTH_NOT_CONFIGURED',
      503,
      'Supabase Auth todavía no está configurado en este entorno.',
    );
  const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token || token.length > 8192)
    throw new HttpError('AUTH_REQUIRED', 401, messages.AUTH_REQUIRED ?? 'Iniciá sesión.');
  const client = createClient(env.SUPABASE_URL, env.SUPABASE_PUBLISHABLE_KEY, {
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }),
    },
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  // Network validation by Auth, never trust getSession() or decoded JWT alone.
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth.user?.email_confirmed_at)
    throw new HttpError('AUTH_REQUIRED', 401, messages.AUTH_REQUIRED ?? 'Iniciá sesión.');
  const path = new URL(request.url).pathname;
  const method = request.method;
  const allowed: Record<string, readonly string[]> = {
    '/api/v1/me': ['GET'],
    '/api/v1/workshops': ['GET', 'POST'],
    '/api/v1/invitations/accept': ['POST'],
    '/api/v1/workshops/:wid': ['GET', 'PATCH'],
    '/api/v1/workshops/:wid/access': ['GET'],
    '/api/v1/workshops/:wid/members': ['GET'],
    '/api/v1/workshops/:wid/members/:mid': ['PATCH'],
    '/api/v1/workshops/:wid/invitations': ['GET', 'POST'],
    '/api/v1/workshops/:wid/invitations/:iid/revoke': ['POST'],
  };
  if (!allowed[matchTenantRoute(path) ?? '']?.includes(method))
    throw new HttpError('METHOD_NOT_ALLOWED', 405, 'Método no permitido.');
  async function rpc<T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const result = await client.rpc(name, args);
    if (result.error) dbError(result.error);
    const parsed = schema.safeParse(result.data as unknown);
    if (!parsed.success)
      throw new HttpError('INVALID_UPSTREAM_RESPONSE', 502, 'Respuesta inesperada del servidor.');
    return parsed.data;
  }
  function key(): string {
    return input(uuidSchema, request.headers.get('Idempotency-Key'));
  }
  const args = (value: z.infer<typeof workshopInputSchema>) => ({
    p_name: value.name,
    p_phone: value.phone,
    p_whatsapp: value.whatsapp,
    p_email: value.email,
    p_address: value.address,
    p_tax_id: value.tax_id,
  });
  if (path === '/api/v1/me' && method === 'GET') {
    const result = await client
      .from('profiles')
      .select('display_name')
      .eq('id', auth.user.id)
      .maybeSingle();
    if (result.error) dbError(result.error);
    const profile = z.object({ display_name: z.string() }).parse(result.data as unknown);
    return {
      body: meSchema.parse({
        id: auth.user.id,
        email: auth.user.email ?? '',
        display_name: profile.display_name,
      }),
      status: 200,
    };
  }
  if (path === '/api/v1/workshops') {
    if (method === 'GET') {
      const result = await client
        .from('workshops')
        .select('id,name,phone,whatsapp,email,address,tax_id,timezone')
        .order('created_at')
        .limit(100);
      if (result.error) dbError(result.error);
      return { body: z.array(workshopSchema).parse(result.data as unknown), status: 200 };
    }
    if (method === 'POST')
      return {
        body: await rpc(
          'create_workshop',
          { ...args(input(workshopInputSchema, await readJson(request))), p_key: key() },
          workshopSummarySchema,
        ),
        status: 201,
      };
  }
  if (path === '/api/v1/invitations/accept' && method === 'POST') {
    const value = input(acceptInvitationSchema, await readJson(request));
    return {
      body: await rpc(
        'accept_invitation',
        { p_token: value.token, p_key: key() },
        invitationAcceptedSchema,
      ),
      status: 200,
    };
  }
  const parts = path.split('/');
  const wid = input(uuidSchema, parts[4]);
  const access = await client
    .from('workshop_members')
    .select('id,workshop_id,user_id,role,is_active')
    .eq('workshop_id', wid)
    .eq('user_id', auth.user.id)
    .eq('is_active', true)
    .maybeSingle();
  if (access.error) dbError(access.error);
  if (!access.data)
    throw new HttpError('NOT_FOUND', 404, messages.NOT_FOUND ?? 'Recurso no encontrado.');
  const membership = membershipSchema.parse(access.data as unknown);
  function owner(permission: string) {
    if (!can(membership.role, permission))
      throw new HttpError(
        'OWNER_REQUIRED',
        403,
        messages.OWNER_REQUIRED ?? 'Permiso insuficiente.',
      );
  }
  if (parts.length === 5) {
    if (method === 'GET') {
      const result = await client
        .from('workshops')
        .select('id,name,phone,whatsapp,email,address,tax_id,timezone')
        .eq('id', wid)
        .maybeSingle();
      if (result.error) dbError(result.error);
      if (!result.data)
        throw new HttpError('NOT_FOUND', 404, messages.NOT_FOUND ?? 'Recurso no encontrado.');
      return { body: workshopSchema.parse(result.data as unknown), status: 200 };
    }
    if (method === 'PATCH') {
      owner('workshops.update');
      return {
        body: await rpc(
          'update_workshop',
          { p_workshop: wid, ...args(input(workshopInputSchema, await readJson(request))) },
          workshopSummarySchema,
        ),
        status: 200,
      };
    }
  }
  if (parts[5] === 'access' && parts.length === 6 && method === 'GET')
    return { body: membership, status: 200 };
  if (parts[5] === 'members') {
    if (parts.length === 6 && method === 'GET') {
      owner('members.read');
      const result = await client
        .from('workshop_members')
        .select('id,workshop_id,user_id,role,is_active')
        .eq('workshop_id', wid)
        .order('created_at')
        .limit(100);
      if (result.error) dbError(result.error);
      return { body: z.array(membershipSchema).parse(result.data as unknown), status: 200 };
    }
    if (parts.length === 7 && method === 'PATCH') {
      owner('members.update');
      const value = input(memberUpdateSchema, await readJson(request));
      return {
        body: await rpc(
          'update_member',
          {
            p_workshop: wid,
            p_member: input(uuidSchema, parts[6]),
            p_role: value.role,
            p_active: value.is_active,
          },
          membershipSchema,
        ),
        status: 200,
      };
    }
  }
  if (parts[5] === 'invitations') {
    owner('invitations.manage');
    if (parts.length === 6 && method === 'GET')
      return {
        body: await rpc('list_invitations', { p_workshop: wid }, z.array(invitationSummarySchema)),
        status: 200,
      };
    if (parts.length === 6 && method === 'POST') {
      const value = input(invitationInputSchema, await readJson(request));
      return {
        body: await rpc(
          'create_invitation',
          { p_workshop: wid, p_email: value.email, p_role: value.role },
          invitationCreatedSchema,
        ),
        status: 201,
      };
    }
    if (parts.length === 8 && parts[7] === 'revoke' && method === 'POST')
      return {
        body: await rpc(
          'revoke_invitation',
          { p_workshop: wid, p_invitation: input(uuidSchema, parts[6]) },
          z.object({ id: uuidSchema, revoked: z.literal(true) }).strict(),
        ),
        status: 200,
      };
  }
  throw new HttpError('METHOD_NOT_ALLOWED', 405, 'Método no permitido.');
}
