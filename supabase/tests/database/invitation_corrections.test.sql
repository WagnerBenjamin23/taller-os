begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select plan(3);
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('01010101-0101-4101-8101-010101010101','terminal-owner@example.test',now(),'{}'),
 ('02020202-0202-4202-8202-020202020202','terminal-invitee@example.test',now(),'{}');
insert into public.workshops(id,name) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','Terminal');
insert into public.workshop_members(workshop_id,user_id,role) values('cccccccc-cccc-4ccc-8ccc-cccccccccccc','01010101-0101-4101-8101-010101010101','OWNER');
insert into public.workshop_invitations(id,workshop_id,email,role,token_hash,invited_by,accepted_at,accepted_by) values
 ('03030303-0303-4303-8303-030303030303','cccccccc-cccc-4ccc-8ccc-cccccccccccc','terminal-invitee@example.test','MECHANIC',repeat('d',64),'01010101-0101-4101-8101-010101010101',now(),'02020202-0202-4202-8202-020202020202');
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"01010101-0101-4101-8101-010101010101","role":"authenticated"}',true);
select throws_ok($$select public.revoke_invitation('cccccccc-cccc-4ccc-8ccc-cccccccccccc','03030303-0303-4303-8303-030303030303')$$,'PT409','INVITATION_ACCEPTED','aceptada no puede revocarse por RPC');
reset role;
select throws_ok($$update public.workshop_invitations set revoked_at=now() where id='03030303-0303-4303-8303-030303030303'$$,'PT409','INVITATION_ACCEPTED','trigger conserva invitación terminal');
select is((select revoked_at from public.workshop_invitations where id='03030303-0303-4303-8303-030303030303'),null::timestamptz,'aceptada no quedó revocada');
select * from finish();
rollback;
