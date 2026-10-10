import { useEffect, useRef, useState } from 'react';
import { useForm } from 'react-hook-form';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { z } from 'zod';
import {
  workshopSchema,
  workshopInputSchema,
  membershipSchema,
  invitationCreatedSchema,
  invitationAcceptedSchema,
  invitationSummarySchema,
  roleSchema,
  workshopSummarySchema,
  can,
  type Workshop,
  type Membership,
} from '@talleros/contracts';
import { authClient } from './client';
import {
  capturePendingInvitation,
  readPendingInvitation,
  bindPendingInvitation,
  clearPendingInvitation,
} from './pending-invitation';
const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false, staleTime: 15000 } },
});
interface AccountFields {
  email: string;
  password: string;
  display_name: string;
}
async function api<T>(
  session: Session,
  path: string,
  schema: z.ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      ...options.headers,
      Authorization: `Bearer ${session.access_token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const parsed = z.object({ error: z.object({ message: z.string() }) }).safeParse(body);
    throw new Error(
      parsed.success ? parsed.data.error.message : 'No se pudo completar la operación.',
    );
  }
  return schema.parse(body);
}
export function AuthPanel() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(Boolean(authClient));
  const [recovery, setRecovery] = useState(false);
  const [notice, setNotice] = useState('');
  const previous = useRef<string | null>(null);
  const callbackPromise = useRef<Promise<boolean> | null>(null);
  const sessionIdentity = useRef<string | null>(null);
  useEffect(() => {
    let mounted = true;
    try {
      capturePendingInvitation();
    } catch {
      queueMicrotask(() => {
        if (mounted)
          setNotice(
            'Este navegador no permite conservar la invitación. Habilitá almacenamiento local y volvé a abrir el enlace.',
          );
      });
    }
    if (!authClient) return;
    const { data } = authClient.auth.onAuthStateChange((event, next) => {
      const identity = next?.user.id ?? null;
      if (identity !== previous.current || event === 'SIGNED_OUT') {
        void queryClient.cancelQueries();
        queryClient.clear();
        previous.current = identity;
      }
      if (mounted) {
        setSession(next);
        if (!next || identity !== sessionIdentity.current) setRecovery(false);
        sessionIdentity.current = identity;
        if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      }
    });
    const callbackParams = new URLSearchParams(window.location.search);
    const code = callbackParams.get('code');
    const flowId = callbackParams.get('sb_flow_id');
    if (code && !callbackPromise.current) {
      window.history.replaceState({}, '', window.location.pathname);
      callbackPromise.current = authClient.auth
        .exchangeCodeForSession(code, flowId ? { flowId } : undefined)
        .then(({ error }) => !error);
    }
    if (callbackPromise.current) {
      void callbackPromise.current.then((ok) => {
        if (mounted) {
          setBusy(false);
          if (!ok)
            setNotice('El enlace venció o no corresponde a este navegador. Solicitá uno nuevo.');
        }
      });
    } else {
      void authClient.auth.getSession().then(({ data, error }) => {
        if (mounted) {
          setSession(data.session);
          setBusy(false);
          if (error) setNotice('No se pudo recuperar la sesión.');
        }
      });
    }
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, []);
  if (!authClient)
    return (
      <section aria-label="Autenticación">
        <h2>Acceso al taller</h2>
        <p>
          Skeleton de Fase 2. Configurá Supabase local para habilitar registro, login e
          invitaciones. No hay autenticación simulada.
        </p>
      </section>
    );
  return (
    <QueryClientProvider client={queryClient}>
      <section aria-label="Autenticación">
        <h2>Acceso al taller</h2>
        {notice && <p role="alert">{notice}</p>}
        {busy ? (
          <p role="status">Verificando sesión…</p>
        ) : session ? (
          <div key={session.user.id}>
            <p>{session.user.email}</p>
            <button
              onClick={() => {
                void authClient?.auth.signOut().then(({ error }) => {
                  if (error) setNotice('No se pudo cerrar sesión.');
                  else {
                    setRecovery(false);
                    setSession(null);
                    queryClient.clear();
                  }
                });
              }}
            >
              Cerrar sesión
            </button>
            {recovery ? (
              <RecoveryForm
                onDone={() => {
                  setRecovery(false);
                  setNotice('Contraseña actualizada.');
                }}
              />
            ) : (
              <WorkshopAccount session={session} />
            )}
          </div>
        ) : (
          <AccountForm />
        )}
      </section>
    </QueryClientProvider>
  );
}
function AccountForm() {
  const [mode, setMode] = useState<'login' | 'register' | 'recover'>('login');
  const [notice, setNotice] = useState('');
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<AccountFields>();
  async function submit(value: AccountFields) {
    if (!authClient) return;
    setNotice('');
    const origin = window.location.origin;
    if (mode === 'recover') {
      const { error } = await authClient.auth.resetPasswordForEmail(value.email, {
        redirectTo: `${origin}/reset-password`,
      });
      setNotice(
        error
          ? 'No se pudo solicitar la recuperación.'
          : 'Si existe una cuenta, recibirás un enlace de recuperación.',
      );
      return;
    }
    if (mode === 'register') {
      try {
        bindPendingInvitation(value.email);
      } catch {
        setNotice(
          'No se pudo conservar la invitación. Habilitá almacenamiento local antes de registrarte.',
        );
        return;
      }
      const { error } = await authClient.auth.signUp({
        email: value.email,
        password: value.password,
        options: {
          emailRedirectTo: `${origin}/auth/callback`,
          data: { display_name: value.display_name },
        },
      });
      setNotice(
        error
          ? 'No se pudo crear la cuenta. Revisá los datos e intentá más tarde.'
          : 'Revisá tu correo para confirmar la cuenta.',
      );
    } else {
      const { error } = await authClient.auth.signInWithPassword({
        email: value.email,
        password: value.password,
      });
      if (error)
        setNotice('No se pudo iniciar sesión. Revisá email, contraseña y confirmación de correo.');
    }
  }
  return (
    <>
      <div className="actions">
        {(['login', 'register', 'recover'] as const).map((option) => (
          <button
            key={option}
            type="button"
            aria-pressed={mode === option}
            onClick={() => {
              setMode(option);
              setNotice('');
              reset();
            }}
          >
            {option === 'login'
              ? 'Ingresar'
              : option === 'register'
                ? 'Crear cuenta'
                : 'Recuperar contraseña'}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit(submit)}>
        {mode === 'register' && (
          <label>
            Nombre
            <input
              autoComplete="name"
              {...register('display_name', { required: true, maxLength: 100 })}
            />
          </label>
        )}
        <label>
          Email
          <input
            type="email"
            autoComplete="email"
            {...register('email', { required: true, maxLength: 254 })}
          />
        </label>
        {mode !== 'recover' && (
          <label>
            Contraseña
            <input
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              {...register('password', {
                required: true,
                minLength: mode === 'register' ? 12 : 1,
                maxLength: 128,
              })}
            />
          </label>
        )}
        {Object.keys(errors).length > 0 && (
          <p role="alert">
            Completá los campos. Para registro, usá una contraseña de al menos 12 caracteres.
          </p>
        )}
        <button disabled={isSubmitting}>
          {isSubmitting
            ? 'Procesando…'
            : mode === 'login'
              ? 'Ingresar'
              : mode === 'register'
                ? 'Registrarme'
                : 'Enviar recuperación'}
        </button>
      </form>
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
function RecoveryForm({ onDone }: { onDone: () => void }) {
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ password: string; confirmation: string }>();
  const [error, setError] = useState('');
  return (
    <form
      onSubmit={handleSubmit(async (value) => {
        if (value.password !== value.confirmation) {
          setError('Las contraseñas no coinciden.');
          return;
        }
        const result = await authClient?.auth.updateUser({ password: value.password });
        if (result?.error)
          setError('No se pudo actualizar la contraseña. Solicitá un nuevo enlace.');
        else onDone();
      })}
    >
      <h3>Nueva contraseña</h3>
      <label>
        Contraseña
        <input
          type="password"
          autoComplete="new-password"
          {...register('password', { required: true, minLength: 12, maxLength: 128 })}
        />
      </label>
      <label>
        Repetir contraseña
        <input
          type="password"
          autoComplete="new-password"
          {...register('confirmation', { required: true, minLength: 12, maxLength: 128 })}
        />
      </label>
      <button disabled={isSubmitting}>Actualizar contraseña</button>
      {error && <p role="alert">{error}</p>}
    </form>
  );
}
function WorkshopAccount({ session }: { session: Session }) {
  const [selected, setSelected] = useState<Workshop | null>(null);
  const [invitation, setInvitation] = useState(readPendingInvitation);
  const [notice, setNotice] = useState('');
  const createKey = useRef(crypto.randomUUID());

  useEffect(() => {
    if (window.location.hash) window.history.replaceState({}, '', window.location.pathname);
  }, []);
  const list = useQuery({
    queryKey: [session.user.id, 'workshops'],
    queryFn: ({ signal }) => api(session, '/workshops', z.array(workshopSchema), { signal }),
  });
  return (
    <>
      <h3>Mis talleres</h3>
      {list.isPending && <p role="status">Cargando talleres…</p>}
      {list.error && <p role="alert">{list.error.message}</p>}
      <div className="actions">
        {list.data?.map((workshop) => (
          <button
            key={workshop.id}
            onClick={() => {
              setSelected(workshop);
              setNotice('');
            }}
            aria-pressed={selected?.id === workshop.id}
          >
            {workshop.name}
          </button>
        ))}
      </div>
      {list.data?.length === 0 && (
        <p>No tenés talleres activos. Creá uno o aceptá una invitación.</p>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const name = String(data.get('name') ?? '');
          const parsed = workshopInputSchema.safeParse({ name });
          if (!parsed.success) {
            setNotice('Ingresá un nombre válido.');
            return;
          }
          void api(session, '/workshops', workshopSummarySchema, {
            method: 'POST',
            headers: { 'Idempotency-Key': createKey.current },
            body: JSON.stringify(parsed.data),
          })
            .then(async () => {
              createKey.current = crypto.randomUUID();
              setNotice('Taller creado.');
              await queryClient.invalidateQueries({ queryKey: [session.user.id, 'workshops'] });
            })
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : 'No se pudo crear el taller.');
            });
        }}
      >
        <label>
          Nuevo taller
          <input name="name" required maxLength={120} />
        </label>
        <button>Crear taller</button>
      </form>
      {invitation &&
      (!invitation.email || invitation.email === session.user.email?.trim().toLowerCase()) ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!invitation) return;
            void api(session, '/invitations/accept', invitationAcceptedSchema, {
              method: 'POST',
              headers: { 'Idempotency-Key': invitation.key },
              body: JSON.stringify({ token: invitation.token }),
            })
              .then(async () => {
                clearPendingInvitation();
                setInvitation(null);
                setNotice('Invitación aceptada.');
                await queryClient.invalidateQueries({ queryKey: [session.user.id, 'workshops'] });
              })
              .catch((error: unknown) => {
                setNotice(error instanceof Error ? error.message : 'No se pudo aceptar.');
              });
          }}
        >
          <p>Tenés una invitación pendiente. Confirmá para incorporarte al taller.</p>
          <button>Aceptar invitación</button>
        </form>
      ) : invitation ? (
        <p>La invitación corresponde a otra cuenta. Iniciá sesión con el email destinatario.</p>
      ) : null}
      {notice && <p role="status">{notice}</p>}
      {selected && <WorkshopIdentity key={selected.id} workshop={selected} session={session} />}
    </>
  );
}
function WorkshopIdentity({ workshop, session }: { workshop: Workshop; session: Session }) {
  const access = useQuery({
    queryKey: [session.user.id, workshop.id, 'access'],
    queryFn: ({ signal }) =>
      api(session, `/workshops/${workshop.id}/access`, membershipSchema, { signal }),
  });
  if (access.isPending) return <p role="status">Verificando membresía…</p>;
  if (access.error) return <p role="alert">{access.error.message}</p>;
  const permission = access.data;
  return (
    <section>
      <h3>{workshop.name}</h3>
      <p>Rol: {permission.role}</p>
      {can(permission.role, 'members.read') && <Team workshop={workshop} session={session} />}
    </section>
  );
}
function Team({ workshop, session }: { workshop: Workshop; session: Session }) {
  const [notice, setNotice] = useState('');
  const [link, setLink] = useState('');
  const members = useQuery({
    queryKey: [session.user.id, workshop.id, 'members'],
    queryFn: ({ signal }) =>
      api(session, `/workshops/${workshop.id}/members`, z.array(membershipSchema), { signal }),
  });
  const invites = useQuery({
    queryKey: [session.user.id, workshop.id, 'invitations'],
    queryFn: ({ signal }) =>
      api(session, `/workshops/${workshop.id}/invitations`, z.array(invitationSummarySchema), {
        signal,
      }),
  });
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: [session.user.id, workshop.id] });
  }
  return (
    <>
      <h3>Miembros e invitaciones</h3>
      {members.error && <p role="alert">{members.error.message}</p>}
      {members.data?.map((member) => (
        <MemberForm
          key={`${member.id}-${member.role}-${member.is_active}`}
          member={member}
          onSave={async (value) => {
            try {
              await api(
                session,
                `/workshops/${workshop.id}/members/${member.id}`,
                membershipSchema,
                { method: 'PATCH', body: JSON.stringify(value) },
              );
              setNotice('Membresía actualizada.');
              await refresh();
            } catch (error) {
              setNotice(error instanceof Error ? error.message : 'No se pudo guardar.');
            }
          }}
        />
      ))}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const data = new FormData(event.currentTarget);
          const role = roleSchema.parse(data.get('role'));
          void api(session, `/workshops/${workshop.id}/invitations`, invitationCreatedSchema, {
            method: 'POST',
            body: JSON.stringify({ email: String(data.get('email')), role }),
          })
            .then(async (result) => {
              setLink(`${window.location.origin}/#invite=${result.token}`);
              setNotice('Enlace creado. La aplicación no envió un email.');
              await refresh();
            })
            .catch((error: unknown) => {
              setNotice(error instanceof Error ? error.message : 'No se pudo invitar.');
            });
        }}
      >
        <label>
          Email del invitado
          <input type="email" name="email" required maxLength={254} />
        </label>
        <label>
          Rol
          <select name="role" defaultValue="MECHANIC">
            {roleSchema.options.map((role) => (
              <option key={role}>{role}</option>
            ))}
          </select>
        </label>
        <button>Crear invitación</button>
      </form>
      {link && (
        <label>
          Enlace privado para compartir
          <textarea value={link} readOnly autoComplete="off" />
        </label>
      )}
      {invites.error && <p role="alert">{invites.error.message}</p>}
      {invites.data?.map((invite) => (
        <p key={invite.id}>
          {invite.email} · {invite.role} ·{' '}
          {invite.revoked_at
            ? 'revocada'
            : invite.accepted_at
              ? 'aceptada'
              : new Date(invite.expires_at) < new Date()
                ? 'vencida'
                : 'pendiente'}{' '}
          {!invite.revoked_at && !invite.accepted_at && (
            <button
              onClick={() => {
                void api(
                  session,
                  `/workshops/${workshop.id}/invitations/${invite.id}/revoke`,
                  z.object({ id: z.uuid(), revoked: z.literal(true) }),
                  { method: 'POST' },
                )
                  .then(refresh)
                  .catch((error: unknown) =>
                    setNotice(error instanceof Error ? error.message : 'No se pudo revocar.'),
                  );
              }}
            >
              Revocar
            </button>
          )}
        </p>
      ))}
      {notice && <p role="status">{notice}</p>}
    </>
  );
}
function MemberForm({
  member,
  onSave,
}: {
  member: Membership;
  onSave: (value: { role: Membership['role']; is_active: boolean }) => Promise<void>;
}) {
  const [pending, setPending] = useState(false);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setPending(true);
        void onSave({
          role: roleSchema.parse(data.get('role')),
          is_active: data.get('active') === 'on',
        }).finally(() => setPending(false));
      }}
    >
      <p>Usuario {member.user_id}</p>
      <label>
        Rol
        <select name="role" defaultValue={member.role}>
          {roleSchema.options.map((role) => (
            <option key={role}>{role}</option>
          ))}
        </select>
      </label>
      <label>
        <input type="checkbox" name="active" defaultChecked={member.is_active} />
        Activo
      </label>
      <button disabled={pending}>Guardar membresía</button>
    </form>
  );
}
