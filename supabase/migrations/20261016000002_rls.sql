-- Row level security. Deny by default; policies below are the only access.
alter table public.profiles enable row level security;
alter table public.courts enable row level security;
alter table public.check_ins enable row level security;
alter table public.blocks enable row level security;
alter table public.reports enable row level security;
alter table public.runs enable row level security;
alter table public.run_members enable row level security;
alter table public.games enable row level security;
alter table public.game_players enable row level security;
alter table public.player_ratings_given enable row level security;
alter table public.ratings enable row level security;
alter table public.rating_events enable row level security;
alter table public.tier_usage enable row level security;
alter table public.gold_ledger enable row level security;

-- Minors are not visible to adults on any surface (profiles included); blocked users are hidden both ways.
create function public.can_see_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select p_user = auth.uid() or (
    (public.viewer_is_minor() or not coalesce((select is_minor from public.profiles where id = p_user), true))
    and not exists (select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = p_user) or (b.blocker_id = p_user and b.blocked_id = auth.uid()))
  )
$$;

-- profiles: read visible users; update only own safe columns (gold and minor flag are locked)
create policy profiles_select on public.profiles for select to authenticated using (public.can_see_user(id));
create policy profiles_update_own on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated, anon;
grant update (display_name, casual_elo_opt_in, avatar) on public.profiles to authenticated;
revoke insert, delete on public.profiles from authenticated, anon; -- created via create_profile(), removed via delete_my_account()

-- courts: public read of public-access courts; nobody writes from clients
create policy courts_select on public.courts for select to authenticated using (is_public);
revoke insert, update, delete on public.courts from authenticated, anon;

-- check_ins: own rows only; created through check_in(); headcount via court_headcounts()
create policy check_ins_select_own on public.check_ins for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.check_ins from authenticated, anon;

-- blocks: manage own
create policy blocks_select_own on public.blocks for select to authenticated using (blocker_id = auth.uid());
create policy blocks_insert_own on public.blocks for insert to authenticated with check (blocker_id = auth.uid());
create policy blocks_delete_own on public.blocks for delete to authenticated using (blocker_id = auth.uid());

-- reports: file and read own; reviewers use the service role
create policy reports_insert_own on public.reports for insert to authenticated with check (reporter_id = auth.uid());
create policy reports_select_own on public.reports for select to authenticated using (reporter_id = auth.uid());

-- runs: host must be visible to the viewer (so minors' runs are hidden from adults)
create policy runs_select on public.runs for select to authenticated using (public.can_see_user(host_id));
create policy runs_insert on public.runs for insert to authenticated with check (host_id = auth.uid());
create policy runs_update_host on public.runs for update to authenticated using (host_id = auth.uid()) with check (host_id = auth.uid());
create policy run_members_select on public.run_members for select to authenticated using (public.can_see_user(user_id));
create policy run_members_join on public.run_members for insert to authenticated
  with check (user_id = auth.uid() and exists (select 1 from public.runs r where r.id = run_id and r.status = 'open' and public.can_see_user(r.host_id)));
create policy run_members_leave on public.run_members for delete to authenticated using (user_id = auth.uid());

-- games: participants only
create policy games_select on public.games for select to authenticated using (public.is_game_player(id) or created_by = auth.uid());
create policy games_insert on public.games for insert to authenticated with check (created_by = auth.uid());
create policy games_update on public.games for update to authenticated
  using ((public.is_game_player(id) or created_by = auth.uid()) and status not in ('final', 'voided'))
  with check (public.is_game_player(id) or created_by = auth.uid());
create policy game_players_select on public.game_players for select to authenticated using (public.is_game_player(game_id) or user_id = auth.uid());
create policy game_players_insert on public.game_players for insert to authenticated
  with check (exists (select 1 from public.games g where g.id = game_id and g.created_by = auth.uid()));
create policy game_players_rate on public.game_players for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
revoke update on public.game_players from authenticated, anon;
grant update (game_rating) on public.game_players to authenticated;
create policy prg_insert on public.player_ratings_given for insert to authenticated
  with check (rater_id = auth.uid() and public.is_game_player(game_id));
create policy prg_select_own on public.player_ratings_given for select to authenticated using (rater_id = auth.uid());

-- ratings: public read (of visible users); written only by the service role
create policy ratings_select on public.ratings for select to authenticated using (public.can_see_user(user_id));
create policy rating_events_select_own on public.rating_events for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.ratings, public.rating_events from authenticated, anon;

-- tier usage and gold: read own only, never writable by clients
create policy tier_usage_select_own on public.tier_usage for select to authenticated using (user_id = auth.uid());
create policy gold_select_own on public.gold_ledger for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.tier_usage, public.gold_ledger from authenticated, anon;

-- functions callable by signed-in users only
revoke execute on function public.create_profile(text, date) from public, anon;
revoke execute on function public.check_in(uuid, double precision, double precision, double precision) from public, anon;
revoke execute on function public.court_headcounts() from public, anon;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.create_profile(text, date), public.check_in(uuid, double precision, double precision, double precision),
  public.court_headcounts(), public.delete_my_account() to authenticated;
