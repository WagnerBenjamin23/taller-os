begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(6);
-- Rol de migración postgres; objetos de test revertidos al finalizar.
create table public.phase1_privilege_probe (id integer);
create function public.phase1_function_probe() returns boolean
language sql security invoker as $$ select true; $$;
select ok(not has_table_privilege('anon', 'public.phase1_privilege_probe', 'SELECT'), 'anon no recibe lectura por defecto');
select ok(not has_table_privilege('anon', 'public.phase1_privilege_probe', 'INSERT'), 'anon no recibe escritura por defecto');
select ok(not has_table_privilege('authenticated', 'public.phase1_privilege_probe', 'SELECT'), 'authenticated no recibe lectura por defecto');
select ok(not has_table_privilege('authenticated', 'public.phase1_privilege_probe', 'INSERT'), 'authenticated no recibe escritura por defecto');
select ok(not has_function_privilege('anon', 'public.phase1_function_probe()', 'EXECUTE'), 'anon no ejecuta funciones nuevas por defecto');
select ok(not has_function_privilege('authenticated', 'public.phase1_function_probe()', 'EXECUTE'), 'authenticated no ejecuta funciones nuevas por defecto');
select * from finish();
rollback;
