// Integration against disposable Supabase LOCAL only. No service_role runtime/key needed.
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { randomUUID, randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createClient } from '@supabase/supabase-js';
const root = fileURLToPath(new URL('..', import.meta.url));
const bin = fileURLToPath(new URL('../node_modules/.bin/supabase', import.meta.url));
const status = JSON.parse(
  execFileSync(bin, ['status', '-o', 'json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }),
);
const url = new URL(status.API_URL);
const dbUrl = new URL(status.DB_URL);
assert(['127.0.0.1', 'localhost'].includes(url.hostname), 'Sólo Supabase local es permitido.');
assert(['127.0.0.1', 'localhost'].includes(dbUrl.hostname), 'Sólo PostgreSQL local es permitido.');
assert.equal(url.port, '54321');
assert.equal(dbUrl.port, '54322');
const pool = new pg.Pool({ connectionString: status.DB_URL, max: 4 });
const password = `${randomBytes(32).toString('base64url')}Aa1!`;
const tag = randomBytes(6).toString('hex');
const users = {};
let child;
let logs = '';
async function fixture(label) {
  const id = randomUUID(),
    email = `${label}-${tag}@example.test`;
  await pool.query(
    `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
    values('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,extensions.crypt($3,extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','')`,
    [id, email, password],
  );
  await pool.query(
    `insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
    values($1,$2::uuid,$2::text,jsonb_build_object('sub',$2::text,'email',$3::text,'email_verified',true,'phone_verified',false),'email',now(),now())`,
    [randomUUID(), id, email],
  );
  const client = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const auth = await client.auth.signInWithPassword({ email, password });
  assert.equal(auth.error, null, `Auth real falló para fixture ${label}`);
  assert(auth.data.session);
  return { id, email, client, token: auth.data.session.access_token };
}
async function rpc(user, name, args) {
  return user.client.rpc(name, args);
}
const onboarding = (name, key = randomUUID()) => ({
  p_name: name,
  p_phone: '',
  p_whatsapp: '',
  p_email: '',
  p_address: '',
  p_tax_id: '',
  p_key: key,
});
async function create(user, name) {
  const r = await rpc(user, 'create_workshop', onboarding(name));
  assert.equal(r.error, null);
  return r.data.id;
}
async function member(wid, uid) {
  return (
    await pool.query('select * from public.workshop_members where workshop_id=$1 and user_id=$2', [
      wid,
      uid,
    ])
  ).rows[0];
}
async function denied(promise, code, message) {
  const r = await promise;
  assert.equal(r.error?.code, code);
  if (message) assert.equal(r.error?.message, message);
}
async function api(user, path, method = 'GET', body) {
  return fetch(`http://127.0.0.1:8792/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(10000),
  });
}
try {
  for (const label of [
    'ownerA',
    'ownerB',
    'reception',
    'mechanic',
    'inactive',
    'dual',
    'invitee',
    'outsider',
  ])
    users[label] = await fixture(label);
  const a = await create(users.ownerA, 'Integración A'),
    b = await create(users.ownerB, 'Integración B');
  for (const [label, workshop, role, active] of [
    ['reception', a, 'RECEPTION', true],
    ['mechanic', a, 'MECHANIC', true],
    ['inactive', a, 'MECHANIC', false],
    ['dual', a, 'RECEPTION', true],
    ['dual', b, 'OWNER', true],
  ]) {
    await pool.query(
      'insert into public.workshop_members(workshop_id,user_id,role,is_active) values($1,$2,$3,$4)',
      [workshop, users[label].id, role, active],
    );
  }
  const ma = await member(a, users.ownerA.id),
    mb = await member(b, users.ownerB.id);
  // PostgREST schema allowlist is a deployment requirement, not a privilege grant.
  const privateRpc = await users.ownerA.client
    .schema('private')
    .rpc('create_workshop', onboarding('Private forbidden'));
  assert.equal(privateRpc.error?.code, 'PGRST106');
  const privateRead = await users.ownerA.client
    .schema('private')
    .from('idempotency_keys')
    .select('id');
  assert.equal(privateRead.error?.code, 'PGRST106');
  const qualifiedRpc = await users.ownerA.client.rpc(
    'private.create_workshop',
    onboarding('Qualified forbidden'),
  );
  assert.equal(qualifiedRpc.error?.code, 'PGRST202');
  const foreignRead = await users.ownerA.client.from('workshops').select('id').eq('id', b);
  assert.equal(foreignRead.error, null);
  assert.deepEqual(foreignRead.data, []);
  await denied(
    rpc(users.ownerA, 'update_workshop', {
      p_workshop: b,
      ...Object.fromEntries(Object.entries(onboarding('Intrusión')).filter(([k]) => k !== 'p_key')),
    }),
    'PT404',
    'NOT_FOUND',
  );
  await denied(
    rpc(users.ownerA, 'update_member', {
      p_workshop: a,
      p_member: mb.id,
      p_role: 'MECHANIC',
      p_active: false,
    }),
    'PT404',
    'NOT_FOUND',
  );
  await denied(
    users.ownerA.client.from('workshop_members').update({ role: 'OWNER' }).eq('id', ma.id),
    '42501',
  );
  await denied(
    users.ownerA.client.from('workshop_members').update({ workshop_id: b }).eq('id', ma.id),
    '42501',
  );
  const anon = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await denied(anon.from('workshops').select('id'), '42501');
  assert.deepEqual(
    (await users.inactive.client.from('workshops').select('id').eq('id', a)).data,
    [],
  );
  await denied(
    rpc(users.inactive, 'update_member', {
      p_workshop: a,
      p_member: ma.id,
      p_role: 'OWNER',
      p_active: true,
    }),
    'PT404',
  );
  for (const label of ['reception', 'mechanic']) {
    const own = await member(a, users[label].id);
    await denied(
      rpc(users[label], 'update_member', {
        p_workshop: a,
        p_member: own.id,
        p_role: 'OWNER',
        p_active: true,
      }),
      'PT403',
      'OWNER_REQUIRED',
    );
    await denied(
      rpc(users[label], 'update_member', {
        p_workshop: a,
        p_member: ma.id,
        p_role: 'MECHANIC',
        p_active: false,
      }),
      'PT403',
    );
  }
  await denied(
    rpc(users.ownerA, 'update_member', {
      p_workshop: a,
      p_member: ma.id,
      p_role: 'OWNER',
      p_active: false,
    }),
    'PT409',
    'LAST_OWNER',
  );
  await denied(
    rpc(users.ownerA, 'update_member', {
      p_workshop: a,
      p_member: ma.id,
      p_role: 'MECHANIC',
      p_active: true,
    }),
    'PT409',
    'LAST_OWNER',
  );
  await assert.rejects(pool.query('delete from public.workshop_members where id=$1', [ma.id]), {
    code: 'PT409',
  });
  await assert.rejects(
    pool.query('update public.workshop_members set workshop_id=$1 where id=$2', [
      b,
      (await member(a, users.dual.id)).id,
    ]),
    { code: 'PT409' },
  );
  const dual = await users.dual.client.from('workshops').select('id').in('id', [a, b]);
  assert.equal(dual.data.length, 2);
  await denied(
    rpc(users.dual, 'update_workshop', {
      p_workshop: a,
      ...Object.fromEntries(Object.entries(onboarding('Intrusión')).filter(([k]) => k !== 'p_key')),
    }),
    'PT403',
  );
  // Concurrency: PostgREST sends independent PostgreSQL transactions.
  const same = onboarding('Concurrent onboarding', randomUUID());
  const double = await Promise.all([
    rpc(users.outsider, 'create_workshop', same),
    rpc(users.outsider, 'create_workshop', same),
  ]);
  assert.equal(double[0].error, null);
  assert.equal(double[1].error, null);
  assert.equal(double[0].data.id, double[1].data.id);
  await denied(
    rpc(users.outsider, 'create_workshop', { ...same, p_name: 'Otros datos' }),
    'PT409',
    'IDEMPOTENCY_KEY_REUSED',
  );
  // Real registration + local SMTP confirmation + PKCE, without administrative Auth calls.
  // Mailpit API contract: https://mailpit.axllent.org/docs/api-v1/
  const newEmail = `signup-${tag}@example.test`;
  const newcomer = createClient(status.API_URL, status.ANON_KEY, {
    auth: {
      flowType: 'pkce',
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
  const newInvite = await rpc(users.ownerA, 'create_invitation', {
    p_workshop: a,
    p_email: newEmail,
    p_role: 'RECEPTION',
  });
  assert.equal(newInvite.error, null);
  // Browser persistence/URL hygiene is separately tested by the actual React flow tests.
  const signup = await newcomer.auth.signUp({
    email: newEmail,
    password,
    options: { emailRedirectTo: 'http://127.0.0.1:5173/auth/callback' },
  });
  assert.equal(signup.error, null);
  assert.equal(signup.data.session, null, 'Confirmation must be required.');
  let mail;
  for (let i = 0; i < 60; i++) {
    const response = await fetch(
      'http://127.0.0.1:54324/api/v1/search?query=' + encodeURIComponent(`to:${newEmail}`),
      { signal: AbortSignal.timeout(2000) },
    );
    assert(response.ok, 'Local Mailpit is required for signup confirmation.');
    const messages = await response.json();
    const message = messages.messages?.find((m) => m.To?.some((to) => to.Address === newEmail));
    if (message) {
      const body = await fetch(
        `http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(message.ID)}`,
      );
      assert(body.ok);
      mail = await body.json();
      break;
    }
    await delay(250);
  }
  assert(mail, 'Confirmation email was not delivered locally.');
  const contents = String(mail.HTML ?? mail.Text ?? '');
  assert(!contents.includes(newInvite.data.token), 'Invite token must never enter Auth emails.');
  const hrefs = [...contents.matchAll(/href=["']([^"']+)["']/g)].map((m) =>
    m[1].replaceAll('&amp;', '&'),
  );
  const confirmation = hrefs
    .map((href) => new URL(href))
    .find((u) => u.pathname === '/auth/v1/verify');
  assert(confirmation, 'Email must contain the real confirmation link.');
  assert.equal(confirmation.origin, url.origin, 'Confirmation remains local.');
  const confirmed = await fetch(confirmation, {
    redirect: 'manual',
    signal: AbortSignal.timeout(10000),
  });
  assert([302, 303].includes(confirmed.status));
  const callback = new URL(confirmed.headers.get('location'));
  assert.equal(callback.origin, 'http://127.0.0.1:5173');
  assert.equal(callback.pathname, '/auth/callback');
  assert(!callback.href.includes(newInvite.data.token));
  const authCode = callback.searchParams.get('code');
  assert(authCode, 'Confirmation must return PKCE code.');
  const flowId = callback.searchParams.get('sb_flow_id');
  const exchange = await newcomer.auth.exchangeCodeForSession(
    authCode,
    flowId ? { flowId } : undefined,
  );
  assert.equal(exchange.error, null);
  assert.equal(exchange.data.user?.email, newEmail);
  assert(exchange.data.session);
  const joined = await newcomer.rpc('accept_invitation', {
    p_token: newInvite.data.token,
    p_key: randomUUID(),
  });
  assert.equal(joined.error, null);
  assert.equal(joined.data.workshop_id, a);
  assert.equal(joined.data.role, 'RECEPTION');
  newcomer.auth.stopAutoRefresh();
  const invitation = await rpc(users.ownerA, 'create_invitation', {
    p_workshop: a,
    p_email: users.invitee.email,
    p_role: 'MECHANIC',
  });
  assert.equal(invitation.error, null);
  await denied(users.ownerA.client.from('workshop_invitations').select('token_hash'), '42501');
  await denied(
    rpc(users.outsider, 'accept_invitation', {
      p_token: invitation.data.token,
      p_key: randomUUID(),
    }),
    'PT404',
    'INVITATION_INVALID',
  );
  const accept = { p_token: invitation.data.token, p_key: randomUUID() };
  const accepted = await Promise.all([
    rpc(users.invitee, 'accept_invitation', accept),
    rpc(users.invitee, 'accept_invitation', accept),
  ]);
  assert.equal(accepted[0].error, null);
  assert.equal(accepted[1].error, null);
  assert.equal(accepted[0].data.id, accepted[1].data.id);
  await denied(
    rpc(users.invitee, 'accept_invitation', { ...accept, p_key: randomUUID() }),
    'PT409',
    'INVITATION_USED',
  );
  await denied(
    rpc(users.ownerA, 'revoke_invitation', {
      p_workshop: a,
      p_invitation: invitation.data.id,
    }),
    'PT409',
    'INVITATION_ACCEPTED',
  );
  const count = await pool.query(
    'select count(*)::int n from public.workshop_members where workshop_id=$1 and user_id=$2',
    [a, users.invitee.id],
  );
  assert.equal(count.rows[0].n, 1);
  // Two OWNERS simultaneously demote themselves; at least one must remain OWNER.
  const c = await create(users.ownerA, 'Concurrent owners');
  await pool.query(
    "insert into public.workshop_members(workshop_id,user_id,role) values($1,$2,'OWNER')",
    [c, users.ownerB.id],
  );
  const ca = await member(c, users.ownerA.id),
    cb = await member(c, users.ownerB.id);
  const changes = await Promise.all([
    rpc(users.ownerA, 'update_member', {
      p_workshop: c,
      p_member: ca.id,
      p_role: 'MECHANIC',
      p_active: true,
    }),
    rpc(users.ownerB, 'update_member', {
      p_workshop: c,
      p_member: cb.id,
      p_role: 'MECHANIC',
      p_active: true,
    }),
  ]);
  assert.equal(changes.filter((r) => !r.error).length, 1);
  assert.equal(changes.filter((r) => r.error?.message === 'LAST_OWNER').length, 1);
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from public.workshop_members where workshop_id=$1 and role='OWNER' and is_active",
        [c],
      )
    ).rows[0].n,
    1,
  );
  const wrangler = fileURLToPath(
    new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url),
  );
  child = spawn(
    process.execPath,
    [
      wrangler,
      'dev',
      '--env=',
      '--local',
      '--ip',
      '127.0.0.1',
      '--port',
      '8792',
      '--var',
      `SUPABASE_URL:${status.API_URL}`,
      '--var',
      `SUPABASE_PUBLISHABLE_KEY:${status.ANON_KEY}`,
    ],
    {
      cwd: `${root}/apps/api`,
      detached: process.platform !== 'win32',
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      logs = (logs + chunk.toString()).slice(-10000);
    });
  let ready = false;
  for (let i = 0; i < 150; i++) {
    if (child.exitCode !== null) throw new Error('Wrangler no inició.');
    try {
      ready = (
        await fetch('http://127.0.0.1:8792/api/v1/health', { signal: AbortSignal.timeout(1000) })
      ).ok;
    } catch {
      /*startup*/
    }
    if (ready) break;
    await delay(200);
  }
  assert(ready, 'Worker no está listo.');
  assert.equal((await api(users.ownerA, `/workshops/${b}`)).status, 404);
  assert.equal(
    (
      await api(users.ownerA, `/workshops/${a}/members/${mb.id}`, 'PATCH', {
        role: 'OWNER',
        is_active: true,
      })
    ).status,
    404,
  );
  assert.equal((await api(users.inactive, `/workshops/${a}`)).status, 404);
  assert.equal(
    (
      await api(users.reception, `/workshops/${a}/members/${ma.id}`, 'PATCH', {
        role: 'OWNER',
        is_active: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api(users.mechanic, `/workshops/${a}/members/${ma.id}`, 'PATCH', {
        role: 'OWNER',
        is_active: true,
      })
    ).status,
    403,
  );
  assert.equal(
    (
      await api(users.ownerA, `/workshops/${a}/members/${ma.id}`, 'PATCH', {
        role: 'MECHANIC',
        is_active: true,
      })
    ).status,
    409,
  );
  assert.equal((await api(users.dual, `/workshops/${a}/access`)).status, 200);
  assert.equal((await api(users.dual, `/workshops/${b}/access`)).status, 200);
  console.log(
    'Integración real aprobada: Auth, Data API, RLS, RPC, Worker e invariantes concurrentes.',
  );
} catch (error) {
  // Never print tokens/passwords or full Wrangler output (may include local public keys).
  console.error('Integración falló. No se considera validada la Fase 2.');
  throw error;
} finally {
  if (child && child.exitCode === null) {
    try {
      if (process.platform === 'win32') child.kill('SIGTERM');
      else process.kill(-child.pid, 'SIGTERM');
    } catch {
      /*already stopped*/
    }
  }
  await pool.end();
  for (const user of Object.values(users)) user.client.auth.stopAutoRefresh();
}
