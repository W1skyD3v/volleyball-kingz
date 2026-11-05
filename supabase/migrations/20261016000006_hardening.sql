-- Hardening found by the adversarial review (docs/tribunal/2026-10-16-fresh-eyes.md):
--  1. profiles: other people could read birth_year, friend_code, gold and opt-in. Column-level lockdown.
--  2. void abuse: a captain could cancel a game they were losing. Mid-game void now needs both captains.
--  3. friend-code guessing is throttled.
--  4. impossible travel between check-ins raises an integrity flag.

-- ---------------------------------------------------------------- 1. profiles column lockdown
revoke select on public.profiles from authenticated, anon;
grant select (id, display_name, avatar) on public.profiles to authenticated; -- what other players may see
-- Your own full row (birth year, friend code, Gold, opt-in) comes only through this function.
create function public.my_profile() returns public.profiles
language sql stable security definer set search_path = public, extensions as $$
  select * from public.profiles where id = auth.uid() and deleted_at is null
$$;
revoke execute on function public.my_profile() from public, anon;
grant execute on function public.my_profile() to authenticated;

-- ---------------------------------------------------------------- 2. void needs both captains once play has started
create or replace function public.void_game_flag() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  -- A game that dies while disputed is a signal about whoever raised the dispute.
  if new.status = 'voided' and old.status = 'disputed' and jsonb_typeof(old.state->'dispute') = 'object' then
    insert into public.integrity_flags (user_id, game_id, kind, detail)
    select gp.user_id, new.id, 'dispute_void', 'Game voided while disputed (raised by this side)'
    from public.game_players gp where gp.game_id = new.id and gp.side = old.state->'dispute'->>'by' and gp.is_captain;
  end if;
  return new;
end $$;
create trigger games_void_flag after update on public.games for each row execute function public.void_game_flag();

-- ---------------------------------------------------------------- 3. friend request: throttled, returns a status
create table public.friend_lookup_failures (
  user_id uuid not null references public.profiles (id) on delete cascade,
  at timestamptz not null default now()
);
create index friend_lookup_failures_idx on public.friend_lookup_failures (user_id, at);
alter table public.friend_lookup_failures enable row level security;
revoke all on public.friend_lookup_failures from authenticated, anon;

drop function public.send_friend_request(text);
-- Returns a status instead of raising so a failed guess is recorded (an exception would roll the record back).
create function public.send_friend_request(p_code text) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare target uuid; existing public.friendships;
begin
  if not public.is_active_user() then return 'not_authenticated'; end if;
  if (select count(*) from public.friend_lookup_failures where user_id = auth.uid() and at > now() - interval '1 hour') >= 10 then return 'rate_limited'; end if;
  select id into target from public.profiles where friend_code = upper(trim(p_code)) and deleted_at is null;
  if target is null or target = auth.uid() or not public.can_see_user(target) then
    insert into public.friend_lookup_failures (user_id) values (auth.uid());
    return 'friend_not_found';
  end if;
  select * into existing from public.friendships
    where (requester_id = auth.uid() and addressee_id = target) or (requester_id = target and addressee_id = auth.uid());
  if found then
    if existing.status = 'pending' and existing.addressee_id = auth.uid() then
      update public.friendships set status = 'accepted' where id = existing.id;
      return 'accepted';
    end if;
    return 'already_friends_or_pending';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (auth.uid(), target);
  return 'sent';
end $$;
revoke execute on function public.send_friend_request(text) from public, anon;
grant execute on function public.send_friend_request(text) to authenticated;

-- ---------------------------------------------------------------- 4. impossible travel (flag, never block: GPS is noisy)
create or replace function public.check_in(p_court_id uuid, p_lat double precision, p_lng double precision, p_accuracy_m double precision default 0)
returns public.check_ins
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.courts; v_dist double precision; v_credit double precision := least(greatest(coalesce(p_accuracy_m, 0), 0), 50);
  v_row public.check_ins; prev record; km double precision; hrs double precision;
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'not authenticated'; end if;
  select * into c from public.courts where id = p_court_id and is_public;
  if not found then raise exception 'court_not_found'; end if;
  v_dist := st_distance(c.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography);
  if v_dist - v_credit > 100 then raise exception 'too_far'; end if;

  select ci.created_at, k.geog into prev from public.check_ins ci join public.courts k on k.id = ci.court_id
    where ci.user_id = auth.uid() and ci.court_id <> p_court_id and ci.created_at > now() - interval '3 hours'
    order by ci.created_at desc limit 1;
  if found then
    km := st_distance(prev.geog, c.geog) / 1000.0;
    hrs := greatest(extract(epoch from (now() - prev.created_at)) / 3600.0, 1.0 / 3600.0);
    if km > 2 and km / hrs > 120 then
      insert into public.integrity_flags (user_id, kind, detail)
      values (auth.uid(), 'impossible_travel', format('%s km in %s min between check-ins', round(km::numeric, 1), round((hrs * 60)::numeric, 1)));
    end if;
  end if;

  update public.check_ins set expires_at = now() where user_id = auth.uid() and expires_at > now();
  insert into public.check_ins (user_id, court_id, distance_m, expires_at) values (auth.uid(), p_court_id, v_dist, now() + interval '90 minutes') returning * into v_row;
  return v_row;
end $$;

-- ---------------------------------------------------------------- game_apply_event: two-captain void (mirror of scoring.ts)
create or replace function public.game_apply_event(p_game uuid, p_event jsonb) returns public.games
language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.games; st jsonb; me text; oth text; ev text := p_event->>'type';
  t int; sc text; wb int; a int; b int; pts int; ra jsonb; rb jsonb; res jsonb; w text; scorer text;
begin
  select * into g from public.games where id = p_game for update;
  if not found then raise exception 'game_not_found'; end if;
  select gp.side into me from public.game_players gp where gp.game_id = p_game and gp.user_id = auth.uid();
  if me is null or not public.is_active_user() then raise exception 'game_not_found'; end if;
  if not exists (select 1 from public.game_players gp where gp.game_id = p_game and gp.user_id = auth.uid() and gp.is_captain) then raise exception 'not_captain'; end if;
  if g.status in ('final', 'voided') then raise exception 'game_closed'; end if;
  if g.status = 'lobby' and ev <> 'void' then raise exception 'not_all_confirmed'; end if;
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
    scorer := nullif(p_event->>'scorer', '');
    if scorer is not null and (scorer !~ '^[0-9a-f-]{36}$' or not exists (select 1 from public.game_players gp where gp.game_id = p_game and gp.user_id = scorer::uuid and gp.side = me)) then
      raise exception 'bad_scorer';
    end if;
    st := jsonb_set(st, '{pending}', jsonb_strip_nulls(jsonb_build_object('by', me, 'points', pts, 'scorer', scorer)));
  elsif ev = 'confirm_point' then
    if jsonb_typeof(st->'pending') <> 'object' then raise exception 'nothing_pending'; end if;
    if g.status <> 'active' then raise exception 'not_active'; end if;
    if st->'pending'->>'by' = me then raise exception 'other_side_must_confirm'; end if;
    if st->'pending'->>'by' = 'A' then a := a + (st->'pending'->>'points')::int; else b := b + (st->'pending'->>'points')::int; end if;
    st := jsonb_set(st, '{shots}', coalesce(st->'shots', '[]'::jsonb) || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object('side', st->'pending'->>'by', 'points', (st->'pending'->>'points')::int, 'scorer', st->'pending'->>'scorer'))));
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
    if g.status <> 'active' then raise exception 'not_active'; end if;
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
    -- Cancelling is free before anything happened. Once play has started, a void needs BOTH captains:
    -- otherwise the side that is losing could erase the game.
    if g.status = 'lobby'
       or (a = 0 and b = 0 and coalesce(jsonb_typeof(st->'pending'), 'null') <> 'object' and coalesce(jsonb_typeof(st->'proposed'), 'null') <> 'object') then
      st := jsonb_set(st, '{status}', '"voided"');
    elsif coalesce(jsonb_typeof(st->'voidRequest'), 'null') = 'object' and st->'voidRequest'->>'by' <> me then
      st := jsonb_set(st, '{status}', '"voided"');
    else
      st := jsonb_set(st, '{voidRequest}', jsonb_build_object('by', me));
    end if;
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
