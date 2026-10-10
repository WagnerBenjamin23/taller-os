-- Accepted invitations are historical, terminal records; manage membership separately.
create function private.guard_terminal_invitation() returns trigger
language plpgsql set search_path='' as $$
begin
  if old.accepted_at is not null and new is distinct from old then
    raise exception using errcode='PT409',message='INVITATION_ACCEPTED';
  end if;
  return new;
end $$;
create trigger invitations_terminal before update on public.workshop_invitations
for each row execute function private.guard_terminal_invitation();

create or replace function private.revoke_invitation(p_workshop uuid,p_invitation uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare v_row public.workshop_invitations;
begin
  perform private.verified_uid();
  perform 1 from public.workshops where id=p_workshop for update;
  if not private.has_role(p_workshop,array['OWNER','RECEPTION','MECHANIC']::public.workshop_role[]) then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if not private.has_role(p_workshop,array['OWNER']::public.workshop_role[]) then raise exception using errcode='PT403',message='OWNER_REQUIRED'; end if;
  select * into v_row from public.workshop_invitations where workshop_id=p_workshop and id=p_invitation for update;
  if not found then raise exception using errcode='PT404',message='NOT_FOUND'; end if;
  if v_row.accepted_at is not null then raise exception using errcode='PT409',message='INVITATION_ACCEPTED'; end if;
  update public.workshop_invitations set revoked_at=coalesce(revoked_at,now()) where workshop_id=p_workshop and id=p_invitation;
  return jsonb_build_object('id',p_invitation,'revoked',true);
end $$;
