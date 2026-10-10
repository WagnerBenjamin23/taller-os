-- Fase 2 únicamente. Nunca almacenar tokens de invitación en claro.
create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;
alter default privileges for role postgres in schema private revoke execute on functions from public, anon, authenticated;
create type public.workshop_role as enum ('OWNER', 'RECEPTION', 'MECHANIC');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default '' check (length(display_name) <= 100),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workshops (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  phone text not null default '' check (length(phone) <= 30),
  whatsapp text not null default '' check (length(whatsapp) <= 30),
  email text not null default '' check (length(email) <= 254),
  address text not null default '' check (length(address) <= 300),
  tax_id text not null default '' check (length(tax_id) <= 20),
  timezone text not null default 'America/Argentina/Buenos_Aires',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.workshop_members (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  role public.workshop_role not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workshop_id, user_id),
  unique (workshop_id, id)
);
create index workshop_members_user_active on public.workshop_members(user_id, workshop_id) where is_active;
create table public.workshop_invitations (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid not null references public.workshops(id) on delete restrict,
  email text not null check (email = lower(btrim(email)) and length(email) between 3 and 254 and position('@' in email) > 1),
  role public.workshop_role not null,
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  invited_by uuid not null references public.profiles(id) on delete restrict,
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  accepted_by uuid references public.profiles(id) on delete restrict,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at),
  check ((accepted_at is null) = (accepted_by is null)),
  unique (workshop_id, id)
);
create unique index invitations_one_pending on public.workshop_invitations(workshop_id,email) where revoked_at is null and accepted_at is null;
create index invitations_workshop_created on public.workshop_invitations(workshop_id,created_at,id);
create table private.idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  workshop_id uuid references public.workshops(id) on delete restrict,
  actor_scope text not null,
  operation text not null check (operation in ('workshop.create','invitation.accept')),
  key_hash text not null,
  request_hash text not null,
  resource_id uuid,
  response_json jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null default now() + interval '24 hours',
  unique (actor_scope, operation, key_hash)
);
create index idempotency_expires on private.idempotency_keys(expires_at);
alter table private.idempotency_keys enable row level security;
revoke all on private.idempotency_keys from public, anon, authenticated;

create function private.verified_uid() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists (
    select 1 from auth.users u where u.id = v_uid and u.email_confirmed_at is not null
      and u.deleted_at is null and (u.banned_until is null or u.banned_until <= now())
  ) then raise exception using errcode = 'PT401', message = 'AUTH_REQUIRED'; end if;
  return v_uid;
end $$;
create function private.has_role(p_workshop uuid, p_roles public.workshop_role[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.workshop_members m join auth.users u on u.id=m.user_id
    where m.workshop_id=p_workshop and m.user_id=auth.uid() and m.is_active and m.role=any(p_roles)
    and u.email_confirmed_at is not null and u.deleted_at is null
    and (u.banned_until is null or u.banned_until <= now()));
$$;
create function private.new_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id,display_name) values(new.id,left(coalesce(new.raw_user_meta_data->>'display_name',''),100));
  return new;
end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function private.new_profile();
insert into public.profiles(id,display_name) select id,left(coalesce(raw_user_meta_data->>'display_name',''),100) from auth.users on conflict(id) do nothing;

create function private.immutable_identity() returns trigger language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id then raise exception using errcode='PT409',message='IMMUTABLE_IDENTITY'; end if;
  if tg_table_name='workshop_members' then
    if new.workshop_id is distinct from old.workshop_id or new.user_id is distinct from old.user_id then
      raise exception using errcode='PT409',message='IMMUTABLE_TENANT'; end if;
  elsif tg_table_name='idempotency_keys' then
    if old.workshop_id is not null and new.workshop_id is distinct from old.workshop_id then
      raise exception using errcode='PT409',message='IMMUTABLE_TENANT'; end if;
  elsif tg_table_name='workshop_invitations' then
    if new.workshop_id is distinct from old.workshop_id or new.email is distinct from old.email or new.role is distinct from old.role or new.token_hash is distinct from old.token_hash or new.invited_by is distinct from old.invited_by then
      raise exception using errcode='PT409',message='IMMUTABLE_TENANT'; end if;
  end if;
  return new;
end $$;
create trigger workshops_identity before update on public.workshops for each row execute function private.immutable_identity();
create trigger profiles_identity before update on public.profiles for each row execute function private.immutable_identity();
create trigger members_identity before update on public.workshop_members for each row execute function private.immutable_identity();
create trigger invitations_identity before update on public.workshop_invitations for each row execute function private.immutable_identity();

create function private.guard_last_owner() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  -- Todos los cambios de membresía se serializan por taller, incluyendo DML operativo.
  perform 1 from public.workshops where id=old.workshop_id for update;
  if old.role='OWNER' and old.is_active then
    if tg_op='DELETE' or (new.role <> 'OWNER' or not new.is_active) then
      if not exists (select 1 from public.workshop_members where workshop_id=old.workshop_id and id<>old.id and role='OWNER' and is_active) then
        raise exception using errcode='PT409',message='LAST_OWNER';
      end if;
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger members_last_owner before update or delete on public.workshop_members for each row execute function private.guard_last_owner();

alter table public.profiles enable row level security;
alter table public.workshops enable row level security;
alter table public.workshop_members enable row level security;
alter table public.workshop_invitations enable row level security;
revoke all on public.profiles,public.workshops,public.workshop_members,public.workshop_invitations from public,anon,authenticated;
grant select on public.profiles, public.workshops, public.workshop_members to authenticated;
create policy profile_own_read on public.profiles for select to authenticated using (id=(select auth.uid()));
create policy workshop_member_read on public.workshops for select to authenticated
using (private.has_role(id,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]));
create policy member_own_or_owner_read on public.workshop_members for select to authenticated
using (private.has_role(workshop_id,array['OWNER']::public.workshop_role[]) or
  (user_id=(select auth.uid()) and private.has_role(workshop_id,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[])));
-- No direct table writes and no direct invitation SELECT, including token_hash.
grant execute on function private.has_role(uuid,public.workshop_role[]) to authenticated;

create trigger idempotency_identity before update on private.idempotency_keys for each row execute function private.immutable_identity();
