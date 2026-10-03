-- Infrastructure only. No domain tables or product policies in Phase 1.
-- Subsequent migrations must explicitly grant access and enable RLS.
revoke create on schema public from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
