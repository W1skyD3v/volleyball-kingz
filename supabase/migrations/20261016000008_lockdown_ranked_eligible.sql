-- Found by the repo guard (packages/guards): ranked_eligible was SECURITY DEFINER with EXECUTE left on PUBLIC,
-- so even a logged-out caller could ask whether a game's players were all checked in. It is only used by tests and
-- server code; nobody needs to call it over the API.
revoke execute on function public.ranked_eligible(uuid) from public, anon, authenticated;

-- The DB-level privilege test (supabase/tests/08) found more. RLS policies run these helpers as the signed-in role, so
-- authenticated keeps EXECUTE, but a logged-out caller has no use for them.
revoke execute on function public.can_see_user(uuid), public.is_game_player(uuid), public.viewer_is_minor() from public, anon;

-- Trigger functions run because a trigger exists; nobody needs EXECUTE to fire them (Postgres checks it at CREATE TRIGGER).
revoke execute on function public.games_enqueue_rating(), public.log_tier_usage(), public.on_auth_user_deleted(),
  public.reports_autohide(), public.void_game_flag() from public, anon, authenticated;
