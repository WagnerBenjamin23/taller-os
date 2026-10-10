begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
insert into auth.users(id,email,email_confirmed_at,raw_user_meta_data) values
 ('11111111-1111-4111-8111-111111111111','owner-a@example.test',now(),'{}'),
 ('22222222-2222-4222-8222-222222222222','owner-b@example.test',now(),'{}'),
 ('33333333-3333-4333-8333-333333333333','reception@example.test',now(),'{}'),
 ('44444444-4444-4444-8444-444444444444','mechanic@example.test',now(),'{}'),
 ('55555555-5555-4555-8555-555555555555','inactive@example.test',now(),'{}'),
 ('66666666-6666-4666-8666-666666666666','dual@example.test',now(),'{}'),
 ('77777777-7777-4777-8777-777777777777','invitee@example.test',now(),'{}'),
 ('88888888-8888-4888-8888-888888888888','wrong@example.test',now(),'{}'),
 ('99999999-9999-4999-8999-999999999999','new-owner@example.test',now(),'{}'),
 ('00000000-0000-4000-8000-000000000001','unverified@example.test',null,'{}');
insert into public.workshops(id,name) values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Taller A'),('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Taller B');
insert into public.workshop_members(id,workshop_id,user_id,role,is_active) values
 ('10000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','11111111-1111-4111-8111-111111111111','OWNER',true),
 ('10000000-0000-4000-8000-000000000002','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','22222222-2222-4222-8222-222222222222','OWNER',true),
 ('10000000-0000-4000-8000-000000000003','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','RECEPTION',true),
 ('10000000-0000-4000-8000-000000000004','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','44444444-4444-4444-8444-444444444444','MECHANIC',true),
 ('10000000-0000-4000-8000-000000000005','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','55555555-5555-4555-8555-555555555555','MECHANIC',false),
 ('10000000-0000-4000-8000-000000000006','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','66666666-6666-4666-8666-666666666666','RECEPTION',true),
 ('10000000-0000-4000-8000-000000000007','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','66666666-6666-4666-8666-666666666666','OWNER',true);
insert into public.workshop_invitations(id,workshop_id,email,role,token_hash,invited_by,created_at,expires_at,revoked_at) values
 ('20000000-0000-4000-8000-000000000001','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitee@example.test','MECHANIC',encode(extensions.digest(repeat('a',64),'sha256'),'hex'),'11111111-1111-4111-8111-111111111111',now(),now()+interval '7 days',null),
 ('20000000-0000-4000-8000-000000000002','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','invitee@example.test','RECEPTION',encode(extensions.digest(repeat('b',64),'sha256'),'hex'),'11111111-1111-4111-8111-111111111111',now(),now()+interval '7 days',now()),
 ('20000000-0000-4000-8000-000000000003','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','invitee@example.test','RECEPTION',encode(extensions.digest(repeat('c',64),'sha256'),'hex'),'22222222-2222-4222-8222-222222222222',now()-interval '8 days',now()-interval '1 day',null);

set local role anon;
select set_config('request.jwt.claims','{}',true);
select throws_ok('select * from public.workshops','42501',null,'anon no lee talleres');
select throws_ok('select * from public.workshop_members','42501',null,'anon no lee membresías');
select throws_ok($$select public.create_workshop('X','','','','','',gen_random_uuid())$$,'42501',null,'anon no ejecuta onboarding');
reset role;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated"}',true);
select is((select count(*) from public.workshops),1::bigint,'A sólo lee un taller');
select is((select count(*) from public.workshops where id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),0::bigint,'UUID real de B no filtra taller');
select is((select count(*) from public.workshop_members where workshop_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),0::bigint,'A no lee membresías B');
select throws_ok($$select public.update_workshop('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Intrusión','','','','','')$$,'PT404','NOT_FOUND','A no escribe B por RPC directa');
select throws_ok($$select public.update_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000002','MECHANIC',false)$$,'PT404','NOT_FOUND','UUID real de miembro B no permite IDOR dentro de A');
select throws_ok($$update public.workshop_members set role='OWNER' where id='10000000-0000-4000-8000-000000000003'$$,'42501',null,'Data API directa no tiene grants de escritura');
select throws_ok('select token_hash from public.workshop_invitations','42501',null,'ningún hash de invitación es visible directamente');
select throws_ok('select * from private.idempotency_keys','42501',null,'ledger privado no es visible');
select throws_ok($$select public.update_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','OWNER',false)$$,'PT409','LAST_OWNER','último OWNER no se desactiva');
select throws_ok($$select public.update_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000001','MECHANIC',true)$$,'PT409','LAST_OWNER','último OWNER no se degrada');
select throws_ok('delete from public.workshop_members','42501',null,'usuarios no eliminan físicamente miembros');
select throws_ok($$select public.list_invitations('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')$$,'PT404','NOT_FOUND','invitaciones B aisladas');
select ok(not has_function_privilege('authenticated','private.idempotency_cleanup()','EXECUTE'),'cleanup no ejecutable por app');
select ok(not (public.list_invitations('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0 ? 'token_hash'),'proyección de invitaciones no incluye hash');
select ok(not (public.list_invitations('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')->0 ? 'token'),'proyección de invitaciones no incluye token');

select set_config('request.jwt.claims','{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated"}',true);
select is((select count(*) from public.workshop_members),1::bigint,'RECEPTION sólo lee su membresía');
select throws_ok($$select public.update_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003','OWNER',true)$$,'PT403','OWNER_REQUIRED','RECEPTION no eleva su propio rol');
select throws_ok($$select public.update_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000004','OWNER',true)$$,'PT403','OWNER_REQUIRED','RECEPTION no modifica otros miembros');
select throws_ok($$select public.create_invitation('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','other@example.test','OWNER')$$,'PT403','OWNER_REQUIRED','RECEPTION no invita OWNER');
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
select throws_ok($$select public.update_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000004','OWNER',true)$$,'PT403','OWNER_REQUIRED','MECHANIC no eleva su rol');
select throws_ok($$select public.update_member('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','10000000-0000-4000-8000-000000000003','OWNER',true)$$,'PT403','OWNER_REQUIRED','MECHANIC no modifica miembros');
select set_config('request.jwt.claims','{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated"}',true);
select is((select count(*) from public.workshops),0::bigint,'miembro inactivo no lee taller');
select is((select count(*) from public.workshop_members),0::bigint,'miembro inactivo no lee miembros');
select throws_ok($$select public.update_workshop('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Intrusión','','','','','')$$,'PT404','NOT_FOUND','inactivo no escribe');
select set_config('request.jwt.claims','{"sub":"66666666-6666-4666-8666-666666666666","role":"authenticated"}',true);
select is((select count(*) from public.workshops),2::bigint,'usuario dual lee ambos talleres autorizados');
select throws_ok($$select public.update_workshop('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Intrusión','','','','','')$$,'PT403','OWNER_REQUIRED','OWNER en B no es OWNER en A');
select lives_ok($$select public.update_workshop('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B autorizado','','','','','')$$,'usuario dual modifica únicamente taller donde es OWNER');
select throws_ok($$update public.workshop_members set workshop_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id='10000000-0000-4000-8000-000000000006'$$,'42501',null,'usuario dual no mueve membresía');

select set_config('request.jwt.claims','{"sub":"88888888-8888-4888-8888-888888888888","role":"authenticated"}',true);
select throws_ok($$select public.accept_invitation(repeat('a',64),gen_random_uuid())$$,'PT404','INVITATION_INVALID','email diferente no acepta invitación');
select set_config('request.jwt.claims','{"sub":"77777777-7777-4777-8777-777777777777","role":"authenticated"}',true);
select throws_ok($$select public.accept_invitation(repeat('b',64),gen_random_uuid())$$,'PT404','INVITATION_INVALID','invitación revocada no se acepta');
select throws_ok($$select public.accept_invitation(repeat('c',64),gen_random_uuid())$$,'PT404','INVITATION_INVALID','invitación vencida no se acepta');
select lives_ok($$select public.accept_invitation(repeat('a',64),'30000000-0000-4000-8000-000000000001')$$,'aceptación crea miembro');
select lives_ok($$select public.accept_invitation(repeat('a',64),'30000000-0000-4000-8000-000000000001')$$,'mismo key reproduce aceptación sin duplicar');
select throws_ok($$select public.accept_invitation(repeat('a',64),gen_random_uuid())$$,'PT409','INVITATION_USED','otro key no reutiliza invitación');
select is((select role::text from public.workshop_members where user_id=auth.uid()),'MECHANIC','rol proviene de invitación, no de cliente');
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',true);
select lives_ok($$select public.create_workshop('Nuevo','','','','','','30000000-0000-4000-8000-000000000002')$$,'onboarding transaccional');
select lives_ok($$select public.create_workshop('Nuevo','','','','','','30000000-0000-4000-8000-000000000002')$$,'onboarding idempotente');
select is((select count(*) from public.workshops),1::bigint,'onboarding no duplica');
select is((select role::text from public.workshop_members where user_id=auth.uid()),'OWNER','onboarding deriva OWNER de usuario');
select throws_ok($$select public.create_workshop('Otros datos','','','','','','30000000-0000-4000-8000-000000000002')$$,'PT409','IDEMPOTENCY_KEY_REUSED','key con datos distintos falla');
select throws_ok($$select public.create_workshop(null,'','','','','',gen_random_uuid())$$,'PT422','INVALID_INPUT','Data API no salta validación');
select set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
select throws_ok($$select public.create_workshop('No confirmado','','','','','',gen_random_uuid())$$,'PT401','AUTH_REQUIRED','email sin confirmar no hace onboarding');
reset role;
update private.idempotency_keys set expires_at=now()-interval '1 second'
where actor_scope='99999999-9999-4999-8999-999999999999' and operation='workshop.create';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"99999999-9999-4999-8999-999999999999","role":"authenticated"}',true);
select throws_ok($$select public.create_workshop('Nuevo','','','','','','30000000-0000-4000-8000-000000000002')$$,'PT409','IDEMPOTENCY_KEY_EXPIRED','key vencida no ejecuta nuevamente');
reset role;
select lives_ok('select private.idempotency_cleanup()','operador elimina respuestas vencidas');
select is((select count(*) from private.idempotency_keys where actor_scope='99999999-9999-4999-8999-999999999999' and response_json is null),1::bigint,'tombstone conserva key sin respuesta');
update private.idempotency_keys set created_at=now()-interval '31 days'
where actor_scope='99999999-9999-4999-8999-999999999999';
select lives_ok('select private.idempotency_cleanup()','operador purga luego de 30 días');
select is((select count(*) from private.idempotency_keys where actor_scope='99999999-9999-4999-8999-999999999999'),0::bigint,'purga elimina tombstone vencido');
update auth.users set banned_until=now()+interval '1 day' where id='44444444-4444-4444-8444-444444444444';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated"}',true);
select is((select count(*) from public.workshops),0::bigint,'usuario suspendido no lee talleres aun con JWT previo');
select throws_ok($$select public.create_workshop('Suspendido','','','','','',gen_random_uuid())$$,'PT401','AUTH_REQUIRED','usuario suspendido no crea taller');
reset role;
-- Triggers de defensa se prueban incluso con DML privilegiado, fuera de grants de app.
select throws_ok($$delete from public.workshop_members where id='10000000-0000-4000-8000-000000000001'$$,'PT409','LAST_OWNER','trigger protege borrado físico del último OWNER');
select throws_ok($$update public.workshop_members set workshop_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id='10000000-0000-4000-8000-000000000003'$$,'PT409','IMMUTABLE_TENANT','trigger bloquea movimiento de miembro');
select throws_ok($$update public.workshop_invitations set workshop_id='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' where id='20000000-0000-4000-8000-000000000001'$$,'PT409','IMMUTABLE_TENANT','trigger bloquea movimiento de invitación');
select throws_ok($$update public.workshops set id=gen_random_uuid() where id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'$$,'PT409','IMMUTABLE_IDENTITY','identidad de taller inmutable');
select is((select count(*) from public.workshop_members where workshop_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' and user_id='77777777-7777-4777-8777-777777777777'),1::bigint,'aceptación no duplicó membresía');
select is((select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('create_workshop','update_workshop','update_member','create_invitation','accept_invitation','list_invitations','revoke_invitation') and p.prosecdef),0::bigint,'no se exponen funciones SECURITY DEFINER');
select * from finish();
rollback;
