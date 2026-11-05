-- Stored-data limits found by the security tests: a profile avatar is shown to other players, so it must be small and well formed
-- (otherwise a client could store a megabyte of junk, or a config that crashes everyone who looks at it).
create function public.vk_valid_avatar(a jsonb) returns boolean
language plpgsql immutable set search_path = public, extensions as $$
declare hex text := '^#[0-9a-fA-F]{6}$'; k text;
begin
  if a is null then return true; end if;
  if jsonb_typeof(a) <> 'object' or octet_length(a::text) > 1500 then return false; end if;
  for k in select jsonb_object_keys(a) loop
    if k not in ('seed', 'look', 'jersey', 'shorts', 'shoes') then return false; end if;
  end loop;
  if jsonb_typeof(a->'seed') <> 'string' or char_length(a->>'seed') not between 1 and 64 then return false; end if;
  if jsonb_typeof(a->'jersey') <> 'object' or (a->'jersey'->>'style') not in ('classic', 'stripe', 'split')
     or (a->'jersey'->>'primary') !~ hex or (a->'jersey'->>'secondary') !~ hex
     or jsonb_typeof(a->'jersey'->'number') <> 'number' or (a->'jersey'->>'number') !~ '^[0-9]{1,2}$' then return false; end if;
  if jsonb_typeof(a->'shorts') <> 'object' or (a->'shorts'->>'color') !~ hex then return false; end if;
  if jsonb_typeof(a->'shoes') <> 'object' or (a->'shoes'->>'style') not in ('low', 'high') or (a->'shoes'->>'color') !~ hex then return false; end if;
  if a ? 'look' then
    if jsonb_typeof(a->'look') <> 'object'
       or (a->'look'->>'skin') !~ '^[0-5]$' or (a->'look'->>'hairColor') !~ '^[0-5]$'
       or (a->'look'->>'hair') not in ('bald', 'buzz', 'short', 'waves', 'afro', 'locs', 'bun')
       or (a->'look'->>'beard') not in ('none', 'stubble', 'goatee', 'full') then return false; end if;
  end if;
  return true;
exception when others then
  return false; -- anything odd is simply "not valid"
end $$;
-- A pure validator (no data access): the check constraint runs as the caller, so signed-in users need to execute it.
revoke execute on function public.vk_valid_avatar(jsonb) from public, anon;
grant execute on function public.vk_valid_avatar(jsonb) to authenticated;
alter table public.profiles add constraint profiles_avatar_valid check (public.vk_valid_avatar(avatar));

-- Function exposure: nothing is callable by a logged-out visitor except the public leaderboard, and internal helpers
-- (trigger functions, code generators) are not callable by anyone over the API. Everything signed-in players could call
-- before keeps working; this only takes away what they never needed.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text sig, has_function_privilege('authenticated', p.oid, 'EXECUTE') auth
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
      and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e') -- not ours: leave extension functions alone
  loop
    execute format('revoke execute on function %s from public, anon', r.sig);
    if r.auth then execute format('grant execute on function %s to authenticated', r.sig); end if;
  end loop;
end $$;
revoke execute on function public.games_touch(), public.gen_friend_code() from authenticated;
grant execute on function public.leaderboard(int, int) to anon;
alter default privileges in schema public revoke execute on functions from public, anon;
