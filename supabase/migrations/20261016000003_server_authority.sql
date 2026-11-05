-- Server-authoritative games, moderation, check-out, court confirmations, rating queue, integrity flags.
-- Clients can no longer write games/game_players directly; everything goes through the RPCs below.

-- ---------------------------------------------------------------- columns and tables
alter table public.games add column updated_at timestamptz not null default now();
alter table public.game_players add column is_captain boolean not null default false;
alter table public.runs add column hidden boolean not null default false;
alter table public.reports drop constraint reports_target_type_check;
alter table public.reports add constraint reports_target_type_check check (target_type in ('post', 'user', 'game', 'run', 'court'));

create table public.court_confirmations (
  court_id uuid not null references public.courts (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (court_id, user_id)
);
alter table public.court_confirmations enable row level security;
create policy court_confirmations_select_own on public.court_confirmations for select to authenticated using (user_id = auth.uid());
revoke insert, update, delete on public.court_confirmations from authenticated, anon;

-- Queue for the rating worker (scripts/rate-worker.ts). One row per finalized game.
create table public.rating_jobs (
  game_id uuid primary key references public.games (id) on delete cascade,
  created_at timestamptz not null default now(),
  processed_at timestamptz,
  error text
);
alter table public.rating_jobs enable row level security; -- no policies: service role only
revoke all on public.rating_jobs from authenticated, anon;

-- Suspicious patterns found by the worker; read by moderators (service role) only.
create table public.integrity_flags (
  id bigint generated always as identity primary key,
  user_id uuid references public.profiles (id) on delete cascade,
  game_id uuid references public.games (id) on delete set null,
  kind text not null,
  detail text,
  created_at timestamptz not null default now()
);
alter table public.integrity_flags enable row level security;
revoke all on public.integrity_flags from authenticated, anon;

-- ---------------------------------------------------------------- preset helpers (mirror packages/core/src/presets.ts)
create function public.vk_preset(p text, out target int, out scoring text, out win_by int)
language plpgsql immutable as $$
declare m text[];
begin
  m := regexp_match(p, '^(7|10|11|21)-(1s|1s2s)-w([12])$');
  if m is null then raise exception 'bad_preset'; end if;
  target := m[1]::int;
  scoring := case m[2] when '1s' then 'ones' else 'onesAndTwos' end;
  win_by := m[3]::int;
end $$;

create function public.vk_winner(a int, b int, t int, wb int) returns text
language sql immutable as $$
  select case when a >= t and a - b >= wb then 'A' when b >= t and b - a >= wb then 'B' end
$$;

create function public.vk_valid_final(a int, b int, t int, sc text, wb int) returns boolean
language plpgsql immutable as $$
declare w text := public.vk_winner(a, b, t, wb); hi int; lo int; pts int;
begin
  if a < 0 or b < 0 or w is null then return false; end if;
  hi := case w when 'A' then a else b end;
  lo := case w when 'A' then b else a end;
  foreach pts in array case sc when 'ones' then array[1] else array[1, 2] end loop
    if hi - pts >= 0 and public.vk_winner(case w when 'A' then hi - pts else lo end, case w when 'A' then lo else hi - pts end, t, wb) is null then
      return true;
    end if;
  end loop;
  return false;
end $$;

-- ---------------------------------------------------------------- create_game
create function public.create_game(
  p_court uuid, p_lane text, p_tier int, p_preset text, p_mode text, p_side_a uuid[], p_side_b uuid[]
) returns public.games
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.courts;
  g public.games;
  everyone uuid[] := p_side_a || p_side_b;
  u uuid;
  minors int;
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  if p_side_a is null or p_side_b is null or cardinality(p_side_a) <> p_tier or cardinality(p_side_b) <> p_tier then raise exception 'bad_roster'; end if;
  if p_side_a[1] <> auth.uid() then raise exception 'creator_must_captain_a'; end if;
  if (select count(distinct x) from unnest(everyone) x) <> cardinality(everyone) then raise exception 'bad_roster'; end if;
  perform public.vk_preset(p_preset);
  select * into c from public.courts where id = p_court and is_public;
  if not found then raise exception 'court_not_found'; end if;
  if p_tier = 5 and not (c.court_type = 'full' and c.fit_confirmations >= 1) then raise exception 'six_on_six_needs_court'; end if;
  foreach u in array everyone loop
    if not exists (select 1 from public.profiles where id = u) or not public.can_see_user(u) then raise exception 'bad_roster'; end if;
    if p_lane = 'ranked' and not exists (select 1 from public.check_ins ci where ci.user_id = u and ci.court_id = p_court and ci.expires_at > now()) then
      raise exception 'ranked_requires_check_in';
    end if;
  end loop;
  -- Minors and adults never share a game (keeps minors out of adult-visible surfaces and matchmaking).
  select count(*) into minors from public.profiles where id = any (everyone) and is_minor;
  if minors not in (0, cardinality(everyone)) then raise exception 'age_mix'; end if;

  insert into public.games (court_id, lane, tier, preset_id, mode, created_by, state)
  values (p_court, p_lane, p_tier, p_preset, p_mode, auth.uid(), jsonb_build_object(
    'presetId', p_preset, 'mode', p_mode, 'status', 'active', 'score', jsonb_build_object('A', 0, 'B', 0),
    'pending', null, 'proposed', null, 'finalConfirmed', jsonb_build_object('A', false, 'B', false), 'dispute', null, 'log', '[]'::jsonb))
  returning * into g;
  insert into public.game_players (game_id, user_id, side, is_captain)
  select g.id, x, 'A', x = p_side_a[1] from unnest(p_side_a) x
  union all
  select g.id, x, 'B', x = p_side_b[1] from unnest(p_side_b) x;
  return g;
end $$;

-- ---------------------------------------------------------------- game_apply_event (mirror of scoring.ts)
create function public.game_apply_event(p_game uuid, p_event jsonb) returns public.games
language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.games;
  st jsonb;
  me text;
  oth text;
  ev text := p_event->>'type';
  t int; sc text; wb int;
  a int; b int; pts int;
  ra jsonb; rb jsonb;
  res jsonb;
  w text;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'game_not_found'; end if;
  select gp.side into me from public.game_players gp where gp.game_id = p_game and gp.user_id = auth.uid();
  if me is null then raise exception 'game_not_found'; end if; -- same answer for outsiders: do not reveal existence
  if not exists (select 1 from public.game_players gp where gp.game_id = p_game and gp.user_id = auth.uid() and gp.is_captain) then raise exception 'not_captain'; end if;
  if g.status in ('final', 'voided') then raise exception 'game_closed'; end if;
  oth := case me when 'A' then 'B' else 'A' end;
  st := g.state;
  select p.target, p.scoring, p.win_by into t, sc, wb from public.vk_preset(g.preset_id) p;
  a := (st->'score'->>'A')::int;
  b := (st->'score'->>'B')::int;

  if ev = 'claim_point' then
    if g.mode <> 'live' then raise exception 'live_only'; end if;
    if g.status <> 'active' then raise exception 'not_active'; end if;
    if jsonb_typeof(st->'pending') = 'object' then raise exception 'point_pending'; end if;
    pts := (p_event->>'points')::int;
    if not (pts = 1 or (pts = 2 and sc = 'onesAndTwos')) then raise exception 'points_not_allowed'; end if;
    st := jsonb_set(st, '{pending}', jsonb_build_object('by', me, 'points', pts));

  elsif ev = 'confirm_point' then
    if jsonb_typeof(st->'pending') <> 'object' then raise exception 'nothing_pending'; end if;
    if g.status <> 'active' then raise exception 'not_active'; end if;
    if st->'pending'->>'by' = me then raise exception 'other_side_must_confirm'; end if;
    if st->'pending'->>'by' = 'A' then a := a + (st->'pending'->>'points')::int; else b := b + (st->'pending'->>'points')::int; end if;
    st := jsonb_set(jsonb_set(st, '{score}', jsonb_build_object('A', a, 'B', b)), '{pending}', 'null'::jsonb);
    if public.vk_winner(a, b, t, wb) is not null then st := jsonb_set(st, '{status}', '"awaiting_final"'); end if;

  elsif ev = 'dispute' then
    if g.status not in ('active', 'awaiting_final') then raise exception 'cannot_dispute'; end if;
    st := jsonb_set(st, '{dispute}', jsonb_build_object('by', me, 'reason', left(coalesce(p_event->>'reason', ''), 200), 'from', g.status, 'resolutions', '{}'::jsonb));
    st := jsonb_set(st, '{status}', '"disputed"');

  elsif ev = 'propose_final' then
    if g.mode <> 'quick' then raise exception 'quick_only'; end if;
    if g.status <> 'active' then raise exception 'not_active'; end if;
    ra := p_event->'score';
    if not public.vk_valid_final((ra->>'A')::int, (ra->>'B')::int, t, sc, wb) then raise exception 'invalid_final'; end if;
    st := jsonb_set(st, '{proposed}', jsonb_build_object('by', me, 'score', jsonb_build_object('A', (ra->>'A')::int, 'B', (ra->>'B')::int)));

  elsif ev = 'confirm_proposed' then
    if jsonb_typeof(st->'proposed') <> 'object' then raise exception 'nothing_proposed'; end if;
    if g.status <> 'active' then raise exception 'not_active'; end if; -- a dispute freezes the game
    if st->'proposed'->>'by' = me then raise exception 'other_side_must_confirm'; end if;
    a := (st->'proposed'->'score'->>'A')::int;
    b := (st->'proposed'->'score'->>'B')::int;
    st := jsonb_set(st, '{score}', jsonb_build_object('A', a, 'B', b));
    st := jsonb_set(st, '{proposed}', 'null'::jsonb);
    st := jsonb_set(st, '{finalConfirmed}', jsonb_build_object('A', true, 'B', true));
    st := jsonb_set(st, '{status}', '"final"');

  elsif ev = 'confirm_final' then
    if g.status <> 'awaiting_final' then raise exception 'not_awaiting_final'; end if;
    st := jsonb_set(st, array['finalConfirmed', me], 'true');
    if (st->'finalConfirmed'->>'A')::boolean and (st->'finalConfirmed'->>'B')::boolean then st := jsonb_set(st, '{status}', '"final"'); end if;

  elsif ev = 'resolve_dispute' then
    if g.status <> 'disputed' then raise exception 'no_dispute'; end if;
    res := p_event->'score';
    st := jsonb_set(st, array['dispute', 'resolutions', me], jsonb_build_object('A', (res->>'A')::int, 'B', (res->>'B')::int));
    ra := st->'dispute'->'resolutions'->'A';
    rb := st->'dispute'->'resolutions'->'B';
    if ra is not null and rb is not null and ra = rb then
      a := (ra->>'A')::int; b := (ra->>'B')::int;
      st := jsonb_set(st, '{score}', jsonb_build_object('A', a, 'B', b));
      st := jsonb_set(st, '{pending}', 'null'::jsonb);
      st := jsonb_set(st, '{proposed}', 'null'::jsonb);
      st := jsonb_set(st, '{finalConfirmed}', jsonb_build_object('A', false, 'B', false));
      st := jsonb_set(st, '{dispute}', 'null'::jsonb);
      st := jsonb_set(st, '{status}', to_jsonb(case when public.vk_winner(a, b, t, wb) is not null then 'awaiting_final' else 'active' end));
    end if;

  elsif ev = 'void' then
    st := jsonb_set(st, '{status}', '"voided"');
  else
    raise exception 'bad_event';
  end if;

  w := st->>'status';
  update public.games set state = st, status = w,
    score_a = (st->'score'->>'A')::int, score_b = (st->'score'->>'B')::int,
    finalized_at = case when w = 'final' then now() else finalized_at end
  where id = p_game returning * into g;
  return g;
end $$;

create function public.games_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger games_touch before update on public.games for each row execute function public.games_touch();

create function public.games_enqueue_rating() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status = 'final' and old.status <> 'final' then
    insert into public.rating_jobs (game_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger games_enqueue_rating after update on public.games for each row execute function public.games_enqueue_rating();

-- Disputes and abandoned games must not hang forever: void anything untouched for p_hours. Service/cron only.
create function public.expire_stale_games(p_hours int default 24) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  with v as (
    update public.games set status = 'voided', state = jsonb_set(state, '{status}', '"voided"')
    where status in ('active', 'awaiting_final', 'disputed') and updated_at < now() - make_interval(hours => p_hours)
    returning 1)
  select count(*) into n from v;
  return n;
end $$;
revoke execute on function public.expire_stale_games(int) from public, anon, authenticated;

-- ---------------------------------------------------------------- feedback RPCs (only after a final game, only your own game)
create function public.rate_game(p_game uuid, p_stars int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.games where id = p_game and status = 'final') or not public.is_game_player(p_game) then raise exception 'not_allowed'; end if;
  update public.game_players set game_rating = p_stars where game_id = p_game and user_id = auth.uid();
end $$;

create function public.rate_player(p_game uuid, p_ratee uuid, p_stars int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.games where id = p_game and status = 'final') or not public.is_game_player(p_game) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.game_players where game_id = p_game and user_id = p_ratee) or p_ratee = auth.uid() then raise exception 'not_allowed'; end if;
  insert into public.player_ratings_given (game_id, rater_id, ratee_id, stars) values (p_game, auth.uid(), p_ratee, p_stars)
  on conflict (game_id, rater_id, ratee_id) do update set stars = excluded.stars;
end $$;

-- ---------------------------------------------------------------- check-out and full-court confirmation
create function public.check_out() returns void
language sql security definer set search_path = public, extensions as $$
  update public.check_ins set expires_at = now() where user_id = auth.uid() and expires_at > now()
$$;

create function public.confirm_court_fit(p_court uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if not exists (select 1 from public.check_ins where user_id = auth.uid() and court_id = p_court and expires_at > now()) then raise exception 'not_checked_in'; end if;
  if not exists (select 1 from public.courts where id = p_court and court_type = 'full') then raise exception 'not_full_estimate'; end if;
  insert into public.court_confirmations (court_id, user_id) values (p_court, auth.uid()) on conflict do nothing;
  select count(*) into n from public.court_confirmations where court_id = p_court;
  update public.courts set fit_confirmations = n where id = p_court;
  return n;
end $$;

-- ---------------------------------------------------------------- moderation: auto-hide runs on reports
create function public.reports_autohide() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.target_type = 'run' and new.target_id ~ '^[0-9a-f-]{36}$' then
    if new.safety_escalation or (select count(distinct reporter_id) from public.reports where target_type = 'run' and target_id = new.target_id) >= 3 then
      update public.runs set hidden = true where id = new.target_id::uuid;
    end if;
  end if;
  return new;
end $$;
create trigger reports_autohide after insert on public.reports for each row execute function public.reports_autohide();

create view public.moderation_queue with (security_invoker = false) as
  select r.id, r.created_at, r.target_type, r.target_id, r.reason, r.details, r.safety_escalation, r.status,
    (select count(*) from public.reports r2 where r2.target_type = r.target_type and r2.target_id = r.target_id) as report_count
  from public.reports r where r.status <> 'closed'
  order by r.safety_escalation desc, r.created_at;
revoke all on public.moderation_queue from authenticated, anon;

-- ---------------------------------------------------------------- policies and grants
drop policy runs_select on public.runs;
create policy runs_select on public.runs for select to authenticated using (public.can_see_user(host_id) and (not hidden or host_id = auth.uid()));

drop policy games_insert on public.games;
drop policy games_update on public.games;
drop policy game_players_insert on public.game_players;
drop policy game_players_rate on public.game_players;
drop policy prg_insert on public.player_ratings_given;
revoke insert, update, delete on public.games, public.game_players, public.player_ratings_given from authenticated, anon;

revoke execute on function public.create_game(uuid, text, int, text, text, uuid[], uuid[]) from public, anon;
revoke execute on function public.game_apply_event(uuid, jsonb) from public, anon;
revoke execute on function public.rate_game(uuid, int) from public, anon;
revoke execute on function public.rate_player(uuid, uuid, int) from public, anon;
revoke execute on function public.check_out() from public, anon;
revoke execute on function public.confirm_court_fit(uuid) from public, anon;
grant execute on function public.create_game(uuid, text, int, text, text, uuid[], uuid[]), public.game_apply_event(uuid, jsonb),
  public.rate_game(uuid, int), public.rate_player(uuid, uuid, int), public.check_out(), public.confirm_court_fit(uuid) to authenticated;

-- Realtime for live scoring (no-op on plain Postgres).
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.games;
  end if;
end $$;
