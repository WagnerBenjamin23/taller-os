import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

test('usuario nuevo acepta invitación tras registro, correo local y callback PKCE', async ({
  page,
  context,
  request,
}) => {
  const root = process.cwd();
  let status: { API_URL: string; DB_URL: string; ANON_KEY: string };
  try {
    status = JSON.parse(
      execFileSync(`${root}/node_modules/.bin/supabase`, ['status', '-o', 'json'], {
        cwd: root,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      }),
    ) as typeof status;
  } catch {
    throw new Error('Supabase local no disponible.');
  }
  for (const [value, port] of [
    [status.API_URL, '54321'],
    [status.DB_URL, '54322'],
  ]) {
    const url = new URL(value!);
    expect(['127.0.0.1', 'localhost'].includes(url.hostname)).toBe(true);
    expect(url.port).toBe(port);
  }
  const pool = new pg.Pool({ connectionString: status.DB_URL });
  const tag = randomBytes(6).toString('hex');
  const ownerId = randomUUID();
  const ownerEmail = `e2e-owner-${tag}@example.test`;
  const inviteEmail = `e2e-new-${tag}@example.test`;
  const password = randomBytes(24).toString('base64url') + 'Aa1!';
  const workshopName = `Taller E2E ${tag}`;
  const owner = createClient(status.API_URL, status.ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  try {
    // Only OWNER setup is seeded through SQL. The invitee must register from the UI.
    await test.step('fixture OWNER y enlace real por RPC', async () => {
      await pool.query(
        `insert into auth.users(instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at,confirmation_token,email_change,email_change_token_new,recovery_token)
        values('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,extensions.crypt($3,extensions.gen_salt('bf')),now(),'{"provider":"email","providers":["email"]}','{}',now(),now(),'','','','')`,
        [ownerId, ownerEmail, password],
      );
      await pool.query(
        `insert into auth.identities(id,user_id,provider_id,identity_data,provider,created_at,updated_at)
        values($1,$2::uuid,$2::text,jsonb_build_object('sub',$2::text,'email',$3::text,'email_verified',true,'phone_verified',false),'email',now(),now())`,
        [randomUUID(), ownerId, ownerEmail],
      );
      const login = await owner.auth.signInWithPassword({ email: ownerEmail, password });
      expect(login.error === null).toBe(true);
      expect(
        (await pool.query('select count(*)::int n from auth.users where email=$1', [inviteEmail]))
          .rows[0].n,
      ).toBe(0);
    });
    const workshop = await owner.rpc('create_workshop', {
      p_name: workshopName,
      p_phone: '',
      p_whatsapp: '',
      p_email: '',
      p_address: '',
      p_tax_id: '',
      p_key: randomUUID(),
    });
    expect(workshop.error === null).toBe(true);
    const invitation = await owner.rpc('create_invitation', {
      p_workshop: workshop.data.id,
      p_email: inviteEmail,
      p_role: 'RECEPTION',
    });
    expect(invitation.error === null).toBe(true);
    const token: string = invitation.data.token;
    let leaked = false;
    context.on('request', (req) => {
      if (req.url().includes(token)) leaked = true;
      if (req.url().includes('/auth/v1/') && req.postData()?.includes(token)) leaked = true;
    });
    await test.step('abrir enlace sin sesión y registrar desde UI', async () => {
      await page.goto('/#invite=' + token);
      await page.getByRole('button', { name: 'Crear cuenta', exact: true }).click();
      expect(new URL(page.url()).hash).toBe('');
      expect(
        await page.evaluate(() => Boolean(localStorage.getItem('talleros.pending-invitation.v1'))),
      ).toBe(true);
      await page.getByLabel('Nombre', { exact: true }).fill('Invitado E2E');
      await page.getByLabel('Email', { exact: true }).fill(inviteEmail);
      await page.getByLabel('Contraseña', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Registrarme', exact: true }).click();
      await expect(
        page.getByText('Revisá tu correo para confirmar la cuenta.', { exact: true }),
      ).toBeVisible();
      await expect(page.getByText('Mis talleres', { exact: true })).toHaveCount(0);
    });
    let confirmation: URL | undefined;
    await test.step('recibir email real en Mailpit', async () => {
      type Message = { ID: string; To: { Address: string }[] };
      await expect
        .poll(
          async () => {
            const response = await request.get('http://127.0.0.1:54324/api/v1/search', {
              params: { query: `to:${inviteEmail}` },
            });
            if (!response.ok()) return false;
            const listing = (await response.json()) as { messages: Message[] };
            const message = listing.messages.find((m) =>
              m.To.some((to) => to.Address === inviteEmail),
            );
            if (!message) return false;
            const bodyResponse = await request.get(
              `http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(message.ID)}`,
            );
            if (!bodyResponse.ok()) return false;
            const mail = (await bodyResponse.json()) as { HTML: string; Text: string };
            const contents = mail.HTML || mail.Text;
            expect(contents.includes(token)).toBe(false);
            for (const match of contents.matchAll(/href=["']([^"']+)["']/g)) {
              try {
                const link = new URL(match[1]!.replaceAll('&amp;', '&'));
                if (link.pathname === '/auth/v1/verify') confirmation = link;
              } catch {
                /*non-URL decorative link*/
              }
            }
            return Boolean(confirmation);
          },
          { timeout: 20000 },
        )
        .toBe(true);
      expect(confirmation!.origin).toBe(new URL(status.API_URL).origin);
    });
    // A new tab in the SAME browser context exercises localStorage/PKCE persistence.
    const callbackPage = await context.newPage();
    await page.close();
    let callbackSeen = false;
    callbackPage.on('request', (req) => {
      const url = new URL(req.url());
      if (url.pathname === '/auth/callback' && url.searchParams.has('code')) callbackSeen = true;
    });
    await test.step('confirmar email y recuperar invitación tras callback PKCE en otra pestaña', async () => {
      await callbackPage.goto(confirmation!.href);
      await expect(
        callbackPage.getByRole('button', { name: 'Aceptar invitación', exact: true }),
      ).toBeVisible();
      expect(callbackSeen).toBe(true);
      const callback = new URL(callbackPage.url());
      expect(callback.origin).toBe('http://127.0.0.1:5173');
      expect(callback.search).toBe('');
      expect(callback.hash).toBe('');
      await expect(callbackPage.getByLabel('Token de invitación', { exact: true })).toHaveCount(0);
    });
    await test.step('aceptar desde UI y ver taller con membresía real', async () => {
      const response = callbackPage.waitForResponse(
        (r) => r.url().endsWith('/api/v1/invitations/accept') && r.request().method() === 'POST',
      );
      await callbackPage.getByRole('button', { name: 'Aceptar invitación', exact: true }).click();
      expect((await response).status()).toBe(200);
      await expect(callbackPage.getByText('Invitación aceptada.', { exact: true })).toBeVisible();
      await callbackPage.getByRole('button', { name: workshopName, exact: true }).click();
      await expect(callbackPage.getByText('Rol: RECEPTION', { exact: true })).toBeVisible();
      expect(
        await callbackPage.evaluate(
          () => localStorage.getItem('talleros.pending-invitation.v1') === null,
        ),
      ).toBe(true);
      expect(leaked).toBe(false);
      const member = await pool.query(
        `select m.role, u.email_confirmed_at, i.accepted_at from public.workshop_members m
        join auth.users u on u.id=m.user_id join public.workshop_invitations i on i.accepted_by=u.id and i.workshop_id=m.workshop_id
        where m.workshop_id=$1 and u.email=$2`,
        [workshop.data.id, inviteEmail],
      );
      expect(member.rows.length).toBe(1);
      expect(member.rows[0].role).toBe('RECEPTION');
      expect(Boolean(member.rows[0].email_confirmed_at && member.rows[0].accepted_at)).toBe(true);
    });
  } finally {
    owner.auth.stopAutoRefresh();
    await pool.end();
    // Fixture history stays in the disposable DB; the next gate starts with db:reset.
  }
});
