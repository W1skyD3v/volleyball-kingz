-- Stand-in for Supabase's auth schema when only plain Postgres is available (also used with PostgREST in e2e tests).
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key default gen_random_uuid());
-- Same lookup Supabase uses: PostgREST sets request.jwt.claims; pgTAP tests set request.jwt.claim.sub.
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
do $$ begin
  if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname='authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated to authenticator;
grant usage on schema auth, public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant execute on functions to anon, authenticated;

-- Supabase keeps extensions in their own schema; clients may use their types but nothing there is exposed as an API.
create schema if not exists extensions;
grant usage on schema extensions to anon, authenticated, authenticator;
