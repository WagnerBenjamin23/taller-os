-- Privileged implementations are private; exposed wrappers are invoker.
create function private.idempotency_begin(p_actor text,p_operation text,p_key uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row private.idempotency_keys; v_hash text := encode(extensions.digest(p_request::text,'sha256'),'hex');
begin
  if p_key is null then raise exception using errcode='PT422',message='IDEMPOTENCY_REQUIRED'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_actor||p_operation||p_key::text,0));
  select * into v_row from private.idempotency_keys where actor_scope=p_actor and operation=p_operation
    and key_hash=encode(extensions.digest(p_key::text,'sha256'),'hex');
  if found then
    if v_row.request_hash <> v_hash then raise exception using errcode='PT409',message='IDEMPOTENCY_KEY_REUSED'; end if;
    if v_row.expires_at <= now() then raise exception using errcode='PT409',message='IDEMPOTENCY_KEY_EXPIRED'; end if;
    return v_row.response_json;
  end if;
  insert into private.idempotency_keys(actor_scope,operation,key_hash,request_hash)
    values(p_actor,p_operation,encode(extensions.digest(p_key::text,'sha256'),'hex'),v_hash);
  return null;
end $$;
create function private.idempotency_finish(p_actor text,p_operation text,p_key uuid,p_workshop uuid,p_resource uuid,p_response jsonb) returns void
language sql security definer set search_path='' as $$
  update private.idempotency_keys set workshop_id=p_workshop,resource_id=p_resource,response_json=p_response,completed_at=now()
    where actor_scope=p_actor and operation=p_operation and key_hash=encode(extensions.digest(p_key::text,'sha256'),'hex');
$$;
create function private.idempotency_cleanup() returns void
language plpgsql security definer set search_path='' as $$
begin
  update private.idempotency_keys set response_json=null where expires_at <= now() and response_json is not null;
  delete from private.idempotency_keys where created_at < now()-interval '30 days';
end $$;
-- Cleanup is operator-only (postgres). Never grant it to app roles.

create function private.create_workshop(p_name text,p_phone text,p_whatsapp text,p_email text,p_address text,p_tax_id text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=private.verified_uid(); v_previous jsonb; v_id uuid; v_response jsonb;
begin
  if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_phone is null or length(p_phone)>30
    or p_whatsapp is null or length(p_whatsapp)>30 or p_email is null or length(p_email)>254
    or p_address is null or length(p_address)>300 or p_tax_id is null or length(p_tax_id)>20 then
    raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  v_previous:=private.idempotency_begin(v_uid::text,'workshop.create',p_key,
    jsonb_build_object('name',btrim(p_name),'phone',p_phone,'whatsapp',p_whatsapp,'email',p_email,'address',p_address,'tax_id',p_tax_id));
  if v_previous is not null then
    if not private.has_role((v_previous->>'id')::uuid,array['OWNER']::public.workshop_role[]) then
      raise exception using errcode='PT403',message='MEMBERSHIP_REQUIRED'; end if;
    return v_previous;
  end if;
  -- DB-level abuse bound cannot be bypassed through the Data API.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('onboarding:'||v_uid::text,0));
  if (select count(*) from public.workshop_members where user_id=v_uid and role='OWNER' and created_at>now()-interval '1 hour')>=10 then
    raise exception using errcode='PT429',message='RATE_LIMITED'; end if;
  insert into public.workshops(name,phone,whatsapp,email,address,tax_id)
    values(btrim(p_name),p_phone,p_whatsapp,p_email,p_address,p_tax_id) returning id into v_id;
  insert into public.workshop_members(workshop_id,user_id,role) values(v_id,v_uid,'OWNER');
  v_response:=jsonb_build_object('id',v_id,'name',btrim(p_name));
  perform private.idempotency_finish(v_uid::text,'workshop.create',p_key,v_id,v_id,v_response);
  return v_response;
end $$;

create function private.update_workshop(p_workshop uuid,p_name text,p_phone text,p_whatsapp text,p_email text,p_address text,p_tax_id text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.verified_uid();
  perform 1 from public.workshops where id=p_workshop for update;
  if not private.has_role(p_workshop,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]) then
    raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if not private.has_role(p_workshop,array['OWNER']::public.workshop_role[]) then
    raise exception using errcode='PT403',message='OWNER_REQUIRED'; end if;
  if p_name is null or length(btrim(p_name)) not between 1 and 120 or p_phone is null or length(p_phone)>30
    or p_whatsapp is null or length(p_whatsapp)>30 or p_email is null or length(p_email)>254
    or p_address is null or length(p_address)>300 or p_tax_id is null or length(p_tax_id)>20 then
    raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  update public.workshops set name=btrim(p_name),phone=p_phone,whatsapp=p_whatsapp,email=p_email,address=p_address,tax_id=p_tax_id,updated_at=now() where id=p_workshop;
  return jsonb_build_object('id',p_workshop,'name',btrim(p_name));
end $$;
create function private.update_member(p_workshop uuid,p_member uuid,p_role public.workshop_role,p_active boolean) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row public.workshop_members;
begin
  perform private.verified_uid();
  perform 1 from public.workshops where id=p_workshop for update;
  if not private.has_role(p_workshop,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]) then
    raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if not private.has_role(p_workshop,array['OWNER']::public.workshop_role[]) then
    raise exception using errcode='PT403',message='OWNER_REQUIRED'; end if;
  if p_role is null or p_active is null then raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  select * into v_row from public.workshop_members where workshop_id=p_workshop and id=p_member;
  if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  update public.workshop_members set role=p_role,is_active=p_active where workshop_id=p_workshop and id=p_member returning * into v_row;
  return jsonb_build_object('id',v_row.id,'workshop_id',v_row.workshop_id,'user_id',v_row.user_id,'role',v_row.role,'is_active',v_row.is_active);
end $$;
create function private.create_invitation(p_workshop uuid,p_email text,p_role public.workshop_role) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=private.verified_uid(); v_token text:=encode(extensions.gen_random_bytes(32),'hex'); v_row public.workshop_invitations; v_email text:=lower(btrim(p_email));
begin
  perform 1 from public.workshops where id=p_workshop for update;
  if not private.has_role(p_workshop,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]) then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if not private.has_role(p_workshop,array['OWNER']::public.workshop_role[]) then raise exception using errcode='PT403',message='OWNER_REQUIRED'; end if;
  if v_email is null or length(v_email) not between 3 and 254 or position('@' in v_email)<=1 or p_role is null then raise exception using errcode='PT422',message='INVALID_INPUT'; end if;
  if exists(select 1 from public.workshop_members m join auth.users u on u.id=m.user_id where m.workshop_id=p_workshop and lower(u.email)=v_email) then
    raise exception using errcode='PT409',message='MEMBER_ALREADY_EXISTS'; end if;
  if (select count(*) from public.workshop_invitations where workshop_id=p_workshop and created_at>now()-interval '1 hour')>=30 then
    raise exception using errcode='PT429',message='RATE_LIMITED'; end if;
  update public.workshop_invitations set revoked_at=now() where workshop_id=p_workshop and email=v_email and revoked_at is null and accepted_at is null;
  insert into public.workshop_invitations(workshop_id,email,role,token_hash,invited_by)
    values(p_workshop,v_email,p_role,encode(extensions.digest(v_token,'sha256'),'hex'),v_uid) returning * into v_row;
  return jsonb_build_object('id',v_row.id,'workshop_id',v_row.workshop_id,'email',v_row.email,'role',v_row.role,'expires_at',v_row.expires_at,'token',v_token);
end $$;
create function private.accept_invitation(p_token text,p_key uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_uid uuid:=private.verified_uid(); v_row public.workshop_invitations; v_previous jsonb; v_response jsonb; v_member uuid;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception using errcode='PT404',message='INVITATION_INVALID'; end if;
  -- Lookup before lock establishes target; lock order is workshop -> invitation in all operations.
  select * into v_row from public.workshop_invitations where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  if not found then raise exception using errcode='PT404',message='INVITATION_INVALID'; end if;
  perform 1 from public.workshops where id=v_row.workshop_id for update;
  select * into v_row from public.workshop_invitations where id=v_row.id for update;
  if v_row.revoked_at is not null or v_row.expires_at<=now() or
    v_row.email is distinct from (select lower(email) from auth.users where id=v_uid) or
    not exists(select 1 from public.workshop_members m join auth.users u on u.id=m.user_id
      where m.workshop_id=v_row.workshop_id and m.user_id=v_row.invited_by and m.is_active and m.role='OWNER'
      and u.email_confirmed_at is not null and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now())) then
      raise exception using errcode='PT404',message='INVITATION_INVALID'; end if;
  v_previous:=private.idempotency_begin(v_uid::text,'invitation.accept',p_key,jsonb_build_object('token_hash',v_row.token_hash));
  if v_previous is not null then
    if not private.has_role(v_row.workshop_id,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]) then raise exception using errcode='PT403',message='MEMBERSHIP_REQUIRED'; end if;
    return v_previous;
  end if;
  if v_row.accepted_at is not null then raise exception using errcode='PT409',message='INVITATION_USED'; end if;
  if exists(select 1 from public.workshop_members where workshop_id=v_row.workshop_id and user_id=v_uid) then
    raise exception using errcode='PT409',message='MEMBER_ALREADY_EXISTS'; end if;
  insert into public.workshop_members(workshop_id,user_id,role) values(v_row.workshop_id,v_uid,v_row.role) returning id into v_member;
  update public.workshop_invitations set accepted_at=now(),accepted_by=v_uid where id=v_row.id;
  v_response:=jsonb_build_object('id',v_member,'workshop_id',v_row.workshop_id,'role',v_row.role);
  perform private.idempotency_finish(v_uid::text,'invitation.accept',p_key,v_row.workshop_id,v_member,v_response);
  return v_response;
end $$;
create function private.list_invitations(p_workshop uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  perform private.verified_uid();
  if not private.has_role(p_workshop,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]) then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if not private.has_role(p_workshop,array['OWNER']::public.workshop_role[]) then raise exception using errcode='PT403',message='OWNER_REQUIRED'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object('id',q.id,'email',q.email,'role',q.role,'expires_at',q.expires_at,'accepted_at',q.accepted_at,'revoked_at',q.revoked_at)),'[]'::jsonb)
    from (select id,email,role,expires_at,accepted_at,revoked_at from public.workshop_invitations where workshop_id=p_workshop order by created_at desc,id limit 100) q);
end $$;
create function private.revoke_invitation(p_workshop uuid,p_invitation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform private.verified_uid();
  perform 1 from public.workshops where id=p_workshop for update;
  if not private.has_role(p_workshop,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]) then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if not private.has_role(p_workshop,array['OWNER']::public.workshop_role[]) then raise exception using errcode='PT403',message='OWNER_REQUIRED'; end if;
  update public.workshop_invitations set revoked_at=coalesce(revoked_at,now()) where workshop_id=p_workshop and id=p_invitation;
  if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  return jsonb_build_object('id',p_invitation,'revoked',true);
end $$;

create function public.create_workshop(p_name text,p_phone text,p_whatsapp text,p_email text,p_address text,p_tax_id text,p_key uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.create_workshop(p_name,p_phone,p_whatsapp,p_email,p_address,p_tax_id,p_key)$$;
create function public.update_workshop(p_workshop uuid,p_name text,p_phone text,p_whatsapp text,p_email text,p_address text,p_tax_id text) returns jsonb
language sql security invoker set search_path='' as $$select private.update_workshop(p_workshop,p_name,p_phone,p_whatsapp,p_email,p_address,p_tax_id)$$;
create function public.update_member(p_workshop uuid,p_member uuid,p_role public.workshop_role,p_active boolean) returns jsonb
language sql security invoker set search_path='' as $$select private.update_member(p_workshop,p_member,p_role,p_active)$$;
create function public.create_invitation(p_workshop uuid,p_email text,p_role public.workshop_role) returns jsonb
language sql security invoker set search_path='' as $$select private.create_invitation(p_workshop,p_email,p_role)$$;
create function public.accept_invitation(p_token text,p_key uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.accept_invitation(p_token,p_key)$$;
create function public.list_invitations(p_workshop uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.list_invitations(p_workshop)$$;
create function public.revoke_invitation(p_workshop uuid,p_invitation uuid) returns jsonb
language sql security invoker set search_path='' as $$select private.revoke_invitation(p_workshop,p_invitation)$$;
-- Defaults deny EXECUTE. Grant only audited entrypoints, never idempotency helpers/cleanup/triggers.
grant execute on function public.create_workshop(text,text,text,text,text,text,uuid), private.create_workshop(text,text,text,text,text,text,uuid),
  public.update_workshop(uuid,text,text,text,text,text,text), private.update_workshop(uuid,text,text,text,text,text,text),
  public.update_member(uuid,uuid,public.workshop_role,boolean),private.update_member(uuid,uuid,public.workshop_role,boolean),
  public.create_invitation(uuid,text,public.workshop_role),private.create_invitation(uuid,text,public.workshop_role),
  public.accept_invitation(text,uuid),private.accept_invitation(text,uuid),
  public.list_invitations(uuid),private.list_invitations(uuid),
  public.revoke_invitation(uuid,uuid),private.revoke_invitation(uuid,uuid) to authenticated;
