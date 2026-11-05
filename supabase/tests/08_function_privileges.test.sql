begin;
select * from no_plan();
-- Ask Postgres itself (not a regex): which SECURITY DEFINER functions in public can an anonymous caller run?
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), array[]::text[])
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('anon', p.oid, 'EXECUTE')),
  array['leaderboard']::text[],
  'only the public leaderboard may be called without logging in');
-- Internal and trigger functions must not be callable by signed-in users either.
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), array[]::text[])
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef and has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and p.proname in ('scrub_profile', 'expire_stale_games', 'ranked_eligible', 'log_tier_usage', 'reports_autohide', 'games_enqueue_rating', 'on_auth_user_deleted', 'void_game_flag', 'process_game_result', 'retry_rating_jobs', 'award_game_gold')),
  array[]::text[],
  'internal and trigger functions are not callable by signed-in users');
select * from finish();
rollback;
