-- 1) Consent before play  2) Keep name + stats on deletion, scrub the rest  3) Friends, invite-only private runs
-- 4) Public leaderboard and per-player stats that never expose Private games or minors.

-- ================================================================ 1. consent lobby
alter table public.games drop constraint games_status_check;
alter table public.games add constraint games_status_check check (status in ('lobby', 'active', 'awaiting_final', 'disputed', 'final', 'voided'));
alter table public.games alter column status set default 'lobby';
alter table public.game_players add column accepted_at timestamptz;

create or replace function public.create_game(
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
  if auth.uid() is null or not public.is_active_user() then raise exception 'not_authenticated'; end if;
  if p_side_a is null or p_side_b is null or cardinality(p_side_a) <> p_tier or cardinality(p_side_b) <> p_tier then raise exception 'bad_roster'; end if;
  if p_side_a[1] <> auth.uid() then raise exception 'creator_must_captain_a'; end if;
  if (select count(distinct x) from unnest(everyone) x) <> cardinality(everyone) then raise exception 'bad_roster'; end if;
  perform public.vk_preset(p_preset);
  select * into c from public.courts where id = p_court and is_public;
  if not found then raise exception 'court_not_found'; end if;
  if p_tier = 5 and not (c.court_type = 'full' and c.fit_confirmations >= 1) then raise exception 'six_on_six_needs_court'; end if;
  foreach u in array everyone loop
    if not exists (select 1 from public.profiles where id = u and deleted_at is null) or not public.can_see_user(u) then raise exception 'bad_roster'; end if;
    if p_lane = 'ranked' and not exists (select 1 from public.check_ins ci where ci.user_id = u and ci.court_id = p_court and ci.expires_at > now()) then
      raise exception 'ranked_requires_check_in';
    end if;
  end loop;
  select count(*) into minors from public.profiles where id = any (everyone) and is_minor;
  if minors not in (0, cardinality(everyone)) then raise exception 'age_mix'; end if;

  -- The game starts in 'lobby': nothing can be scored until every seated player accepts.
  insert into public.games (court_id, lane, tier, preset_id, mode, status, created_by, state)
  values (p_court, p_lane, p_tier, p_preset, p_mode, 'lobby', auth.uid(), jsonb_build_object(
    'presetId', p_preset, 'mode', p_mode, 'status', 'lobby', 'score', jsonb_build_object('A', 0, 'B', 0),
    'pending', null, 'proposed', null, 'finalConfirmed', jsonb_build_object('A', false, 'B', false), 'dispute', null, 'shots', '[]'::jsonb, 'log', '[]'::jsonb))
  returning * into g;
  insert into public.game_players (game_id, user_id, side, is_captain, accepted_at)
  select g.id, x, 'A', x = p_side_a[1], case when x = auth.uid() then now() end from unnest(p_side_a) x
  union all
  select g.id, x, 'B', x = p_side_b[1], null from unnest(p_side_b) x;
  return g;
end $$;

create function public.accept_game(p_game uuid) returns public.games
language plpgsql security definer set search_path = public, extensions as $$
declare g public.games; u uuid;
begin
  select * into g from public.games where id = p_game for update;
  if not found or not public.is_game_player(p_game) or not public.is_active_user() then raise exception 'game_not_found'; end if;
  if g.status <> 'lobby' then raise exception 'not_in_lobby'; end if;
  update public.game_players set accepted_at = coalesce(accepted_at, now()) where game_id = p_game and user_id = auth.uid();
  if not exists (select 1 from public.game_players where game_id = p_game and accepted_at is null) then
    -- everyone said yes: re-check what must still be true at kick-off
    if g.lane = 'ranked' then
      for u in select user_id from public.game_players where game_id = p_game loop
        if not exists (select 1 from public.check_ins ci where ci.user_id = u and ci.court_id = g.court_id and ci.expires_at > now()) then
          raise exception 'ranked_requires_check_in';
        end if;
      end loop;
    end if;
    update public.games set status = 'active', state = jsonb_set(state, '{status}', '"active"') where id = p_game returning * into g;
  end if;
  return g;
end $$;

create function public.decline_game(p_game uuid) returns public.games
language plpgsql security definer set search_path = public, extensions as $$
declare g public.games;
begin
  select * into g from public.games where id = p_game for update;
  if not found or not public.is_game_player(p_game) or not public.is_active_user() then raise exception 'game_not_found'; end if;
  if g.status <> 'lobby' then raise exception 'already_started'; end if;
  update public.games set status = 'voided', state = jsonb_set(state, '{status}', '"voided"') where id = p_game returning * into g;
  return g;
end $$;

-- Scoring is refused while the game is still a lobby (voiding it = cancelling is allowed).
create or replace function public.game_apply_event(p_game uuid, p_event jsonb) returns public.games
language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.games; st jsonb; me text; oth text; ev text := p_event->>'type';
  t int; sc text; wb int; a int; b int; pts int; ra jsonb; rb jsonb; res jsonb; w text;
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

-- A result only reaches the rating queue if every seated player consented.
create or replace function public.games_enqueue_rating() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  if new.status = 'final' and old.status <> 'final'
     and not exists (select 1 from public.game_players where game_id = new.id and accepted_at is null) then
    insert into public.rating_jobs (game_id) values (new.id) on conflict do nothing;
  end if;
  return new;
end $$;

-- Lobbies nobody finished joining are voided after 2 hours; started games after p_hours without activity.
create or replace function public.expire_stale_games(p_hours int default 24) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  with v as (
    update public.games set status = 'voided', state = jsonb_set(state, '{status}', '"voided"')
    where (status = 'lobby' and updated_at < now() - interval '2 hours')
       or (status in ('active', 'awaiting_final', 'disputed') and updated_at < now() - make_interval(hours => p_hours))
    returning 1)
  select count(*) into n from v;
  return n;
end $$;
revoke execute on function public.expire_stale_games(int) from public, anon, authenticated;

-- ================================================================ 2. deletion: keep name + ranked stats, scrub the account
alter table public.profiles drop constraint profiles_id_fkey; -- the profile outlives the login
alter table public.profiles alter column birth_year drop not null;
alter table public.profiles add column deleted_at timestamptz;
alter table public.profiles add column friend_code text;
create unique index profiles_friend_code_idx on public.profiles (friend_code);

create function public.gen_friend_code() returns text language plpgsql volatile as $$
declare alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; out text := ''; i int;
begin
  for i in 1..8 loop out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1); end loop;
  return out;
end $$;
alter table public.profiles alter column friend_code set default public.gen_friend_code();
update public.profiles set friend_code = public.gen_friend_code() where friend_code is null;
alter table public.profiles alter column friend_code set not null;

create function public.is_active_user() returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.profiles where id = auth.uid() and deleted_at is null)
$$;

-- Everything tied to the person goes; their name, seats, games and ranked history stay.
create function public.scrub_profile(p_user uuid, p_keep_name boolean default true) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  delete from public.check_ins where user_id = p_user;
  delete from public.runs where host_id = p_user; -- cascades run members and invites
  delete from public.run_members where user_id = p_user;
  delete from public.blocks where blocker_id = p_user;
  delete from public.court_confirmations where user_id = p_user;
  delete from public.tier_usage where user_id = p_user;
  delete from public.gold_ledger where user_id = p_user;
  delete from public.player_ratings_given where rater_id = p_user;
  delete from public.rating_events where user_id = p_user and kind in ('private_elo', 'casual_elo');
  delete from public.ratings where user_id = p_user and kind in ('private_elo', 'casual_elo');
  delete from public.friendships where requester_id = p_user or addressee_id = p_user;
  update public.reports set reporter_id = null where reporter_id = p_user;
  update public.profiles set
    display_name = case when p_keep_name then display_name else 'Deleted player' end,
    birth_year = null, avatar = null, casual_elo_opt_in = false, gold_earned = 0, gold_bought = 0,
    friend_code = public.gen_friend_code(), deleted_at = coalesce(deleted_at, now())
  where id = p_user; -- is_minor stays so a deleted minor is still never shown to adults
end $$;
revoke execute on function public.scrub_profile(uuid, boolean) from public, anon, authenticated;

drop function public.delete_my_account();
create function public.delete_my_account(p_keep_name boolean default true) returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if auth.uid() is null then raise exception 'not_authenticated'; end if;
  perform public.scrub_profile(auth.uid(), p_keep_name);
  delete from auth.users where id = auth.uid();
end $$;
revoke execute on function public.delete_my_account(boolean) from public, anon;
grant execute on function public.delete_my_account(boolean) to authenticated;

-- Deleting the login from the dashboard scrubs the profile too.
create function public.on_auth_user_deleted() returns trigger language plpgsql security definer set search_path = public, extensions as $$
begin
  perform public.scrub_profile(old.id, true);
  return old;
end $$;
create trigger auth_user_deleted after delete on auth.users for each row execute function public.on_auth_user_deleted();

drop policy profiles_select on public.profiles;
create policy profiles_select on public.profiles for select to authenticated
  using (public.can_see_user(id) and not (id = auth.uid() and deleted_at is not null));

create or replace function public.create_profile(p_display_name text, p_birth_date date)
returns public.profiles
language plpgsql security definer set search_path = public, extensions as $$
declare v_age int := extract(year from age(current_date, p_birth_date)); v_row public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_age < 13 then raise exception 'age_blocked'; end if;
  insert into public.profiles (id, display_name, birth_year, is_minor)
  values (auth.uid(), p_display_name, extract(year from p_birth_date)::int, v_age < 18)
  returning * into v_row;
  return v_row;
end $$;

-- ================================================================ 3. friends and invite-only private runs
create table public.friendships (
  id uuid primary key default gen_random_uuid(),
  requester_id uuid not null references public.profiles (id) on delete cascade,
  addressee_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  check (requester_id <> addressee_id)
);
create unique index friendships_pair_idx on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
alter table public.friendships enable row level security;
create policy friendships_select_own on public.friendships for select to authenticated using (requester_id = auth.uid() or addressee_id = auth.uid());
revoke insert, update, delete on public.friendships from authenticated, anon;

create function public.are_friends(a uuid, b uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  -- Only about yourself: otherwise anyone could map who is friends with whom (found by the security tests).
  select auth.uid() in (a, b) and exists (select 1 from public.friendships where status = 'accepted'
    and ((requester_id = a and addressee_id = b) or (requester_id = b and addressee_id = a)))
$$;

-- Friends are added by code, never by searching names: adults cannot find minors, and strangers cannot be enumerated.
create function public.send_friend_request(p_code text) returns uuid
language plpgsql security definer set search_path = public, extensions as $$
declare target uuid; existing public.friendships; fid uuid;
begin
  if not public.is_active_user() then raise exception 'not_authenticated'; end if;
  select id into target from public.profiles where friend_code = upper(trim(p_code)) and deleted_at is null;
  if target is null or target = auth.uid() or not public.can_see_user(target) then raise exception 'friend_not_found'; end if;
  select * into existing from public.friendships
    where (requester_id = auth.uid() and addressee_id = target) or (requester_id = target and addressee_id = auth.uid());
  if found then
    if existing.status = 'pending' and existing.addressee_id = auth.uid() then -- they already asked: accept
      update public.friendships set status = 'accepted' where id = existing.id;
      return existing.id;
    end if;
    raise exception 'already_friends_or_pending';
  end if;
  insert into public.friendships (requester_id, addressee_id) values (auth.uid(), target) returning id into fid;
  return fid;
end $$;

create function public.respond_friend_request(p_id uuid, p_accept boolean) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not exists (select 1 from public.friendships where id = p_id and addressee_id = auth.uid() and status = 'pending') then raise exception 'not_found'; end if;
  if p_accept then update public.friendships set status = 'accepted' where id = p_id;
  else delete from public.friendships where id = p_id; end if;
end $$;

create function public.remove_friend(p_user uuid) returns void language sql security definer set search_path = public, extensions as $$
  delete from public.friendships where (requester_id = auth.uid() and addressee_id = p_user) or (requester_id = p_user and addressee_id = auth.uid())
$$;

create function public.my_friend_code() returns text language sql stable security definer set search_path = public, extensions as $$
  select friend_code from public.profiles where id = auth.uid() and deleted_at is null
$$;

-- Friends, incoming/outgoing requests, and where accepted friends are right now (visible to friends only).
create function public.list_friends()
returns table (user_id uuid, display_name text, relation text, request_id uuid, court_id uuid, court_name text)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.display_name,
    case when f.status = 'accepted' then 'friend' when f.requester_id = auth.uid() then 'outgoing' else 'incoming' end,
    f.id,
    case when f.status = 'accepted' then ci.court_id end,
    case when f.status = 'accepted' then c.name end
  from public.friendships f
  join public.profiles p on p.id = case when f.requester_id = auth.uid() then f.addressee_id else f.requester_id end
  left join lateral (select court_id from public.check_ins where user_id = p.id and expires_at > now() order by created_at desc limit 1) ci on true
  left join public.courts c on c.id = ci.court_id
  where (f.requester_id = auth.uid() or f.addressee_id = auth.uid()) and p.deleted_at is null
    and not exists (select 1 from public.blocks b where (b.blocker_id = auth.uid() and b.blocked_id = p.id) or (b.blocker_id = p.id and b.blocked_id = auth.uid()))
  order by 3, p.display_name
$$;

create table public.run_invites (
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  invited_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (run_id, user_id)
);
alter table public.run_invites enable row level security;
create policy run_invites_select on public.run_invites for select to authenticated using (user_id = auth.uid() or invited_by = auth.uid());
revoke insert, update, delete on public.run_invites from authenticated, anon;

-- Who may see a run: public runs as before; private runs only the host, members and invitees.
create function public.can_see_run(p_run uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.runs r
    where r.id = p_run
      and public.can_see_user(r.host_id)
      and (not r.hidden or r.host_id = auth.uid())
      and (r.lane <> 'private' or r.host_id = auth.uid()
           or exists (select 1 from public.run_invites i where i.run_id = r.id and i.user_id = auth.uid())
           or exists (select 1 from public.run_members m where m.run_id = r.id and m.user_id = auth.uid()))
  )
$$;

create function public.invite_to_run(p_run uuid, p_user uuid) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_active_user() or not exists (select 1 from public.runs where id = p_run and host_id = auth.uid() and lane = 'private' and status = 'open') then raise exception 'not_your_private_run'; end if;
  if not public.are_friends(auth.uid(), p_user) then raise exception 'not_friends'; end if;
  insert into public.run_invites (run_id, user_id, invited_by) values (p_run, p_user, auth.uid()) on conflict do nothing;
end $$;

-- Row-level (not via can_see_run): INSERT ... RETURNING must be able to see the row it just wrote, and a helper
-- function that re-queries the table cannot see rows from the current statement.
create function public.is_invited_to(p_run uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.run_invites where run_id = p_run and user_id = auth.uid())
$$;
create function public.is_run_member(p_run uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.run_members where run_id = p_run and user_id = auth.uid())
$$;
revoke execute on function public.is_invited_to(uuid), public.is_run_member(uuid) from public, anon;
grant execute on function public.is_invited_to(uuid), public.is_run_member(uuid) to authenticated;

drop policy runs_select on public.runs;
create policy runs_select on public.runs for select to authenticated using (
  public.can_see_user(host_id)
  and (not hidden or host_id = auth.uid())
  and (lane <> 'private' or host_id = auth.uid() or public.is_invited_to(id) or public.is_run_member(id))
);
drop policy runs_insert on public.runs;
create policy runs_insert on public.runs for insert to authenticated with check (host_id = auth.uid() and public.is_active_user());
drop policy run_members_select on public.run_members;
create policy run_members_select on public.run_members for select to authenticated using (public.can_see_run(run_id) and public.can_see_user(user_id));
drop policy run_members_join on public.run_members;
create policy run_members_join on public.run_members for insert to authenticated
  with check (user_id = auth.uid() and public.is_active_user() and public.can_see_run(run_id)
              and exists (select 1 from public.runs r where r.id = run_id and r.status = 'open'));

-- ================================================================ 4. privacy of ratings, public leaderboard, stats
-- Casual Elo and Private Elo are private to their owner. Only ranked ratings are visible to others.
drop policy ratings_select on public.ratings;
create policy ratings_select on public.ratings for select to authenticated
  using (user_id = auth.uid() or (kind = 'ranked' and public.can_see_user(user_id)));

-- Public scoreboard: ranked only, adults only (minors never appear on any public surface), no longer provisional.
-- Display scale mirrors packages/core/src/rating.ts displayRating(): mu 25 = 1000, 20 points per mu.
create function public.leaderboard(p_tier int, p_limit int default 50)
returns table (rank int, display_name text, rating int, range int, games int, deleted boolean)
language sql stable security definer set search_path = public, extensions as $$
  select (row_number() over (order by round(1000 + (r.mu - 25) * 20) desc, r.games desc))::int,
    p.display_name, round(1000 + (r.mu - 25) * 20)::int, round(r.sigma * 20)::int, r.games, p.deleted_at is not null
  from public.ratings r join public.profiles p on p.id = r.user_id
  where r.kind = 'ranked' and r.tier = p_tier and not p.is_minor and r.games >= 10 and r.distinct_opponents >= 5
  order by 3 desc, r.games desc
  limit least(greatest(p_limit, 1), 200)
$$;
revoke execute on function public.leaderboard(int, int) from public;
grant execute on function public.leaderboard(int, int) to anon, authenticated;

-- Per-player history. Other people see ranked and casual results only; your own Private games are yours alone.
create function public.player_stats(p_user uuid)
returns table (tier int, lane text, games int, wins int)
language sql stable security definer set search_path = public, extensions as $$
  select g.tier, g.lane, count(*)::int,
    count(*) filter (where (gp.side = 'A') = (g.score_a > g.score_b))::int
  from public.game_players gp join public.games g on g.id = gp.game_id
  where gp.user_id = p_user and g.status = 'final'
    and (p_user = auth.uid() or (g.lane <> 'private' and public.can_see_user(p_user)))
    and not exists (select 1 from public.game_players x where x.game_id = g.id and x.accepted_at is null)
  group by g.tier, g.lane
  order by g.tier, g.lane
$$;
revoke execute on function public.player_stats(uuid) from public, anon;
grant execute on function public.player_stats(uuid) to authenticated;

-- ================================================================ a deleted account cannot act, even with a still-valid token
create or replace function public.check_in(p_court_id uuid, p_lat double precision, p_lng double precision, p_accuracy_m double precision default 0)
returns public.check_ins
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.courts; v_dist double precision; v_credit double precision := least(greatest(coalesce(p_accuracy_m, 0), 0), 50); v_row public.check_ins;
begin
  if auth.uid() is null or not public.is_active_user() then raise exception 'not authenticated'; end if;
  select * into c from public.courts where id = p_court_id and is_public;
  if not found then raise exception 'court_not_found'; end if;
  v_dist := st_distance(c.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography);
  if v_dist - v_credit > 100 then raise exception 'too_far'; end if;
  update public.check_ins set expires_at = now() where user_id = auth.uid() and expires_at > now();
  insert into public.check_ins (user_id, court_id, distance_m, expires_at) values (auth.uid(), p_court_id, v_dist, now() + interval '90 minutes') returning * into v_row;
  return v_row;
end $$;

create or replace function public.confirm_court_fit(p_court uuid) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare n int;
begin
  if not public.is_active_user() or not exists (select 1 from public.check_ins where user_id = auth.uid() and court_id = p_court and expires_at > now()) then raise exception 'not_checked_in'; end if;
  if not exists (select 1 from public.courts where id = p_court and court_type = 'full') then raise exception 'not_full_estimate'; end if;
  insert into public.court_confirmations (court_id, user_id) values (p_court, auth.uid()) on conflict do nothing;
  select count(*) into n from public.court_confirmations where court_id = p_court;
  update public.courts set fit_confirmations = n where id = p_court;
  return n;
end $$;

create or replace function public.rate_game(p_game uuid, p_stars int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_active_user() or not exists (select 1 from public.games where id = p_game and status = 'final') or not public.is_game_player(p_game) then raise exception 'not_allowed'; end if;
  update public.game_players set game_rating = p_stars where game_id = p_game and user_id = auth.uid();
end $$;

create or replace function public.rate_player(p_game uuid, p_ratee uuid, p_stars int) returns void
language plpgsql security definer set search_path = public, extensions as $$
begin
  if not public.is_active_user() or not exists (select 1 from public.games where id = p_game and status = 'final') or not public.is_game_player(p_game) then raise exception 'not_allowed'; end if;
  if not exists (select 1 from public.game_players where game_id = p_game and user_id = p_ratee) or p_ratee = auth.uid() then raise exception 'not_allowed'; end if;
  insert into public.player_ratings_given (game_id, rater_id, ratee_id, stars) values (p_game, auth.uid(), p_ratee, p_stars)
  on conflict (game_id, rater_id, ratee_id) do update set stars = excluded.stars;
end $$;

drop policy reports_insert_own on public.reports;
create policy reports_insert_own on public.reports for insert to authenticated with check (reporter_id = auth.uid() and public.is_active_user());
drop policy blocks_insert_own on public.blocks;
create policy blocks_insert_own on public.blocks for insert to authenticated with check (blocker_id = auth.uid() and public.is_active_user());

-- ================================================================ grants for the new RPCs
revoke execute on function public.accept_game(uuid), public.decline_game(uuid), public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean), public.remove_friend(uuid), public.my_friend_code(), public.list_friends(),
  public.invite_to_run(uuid, uuid), public.is_active_user(), public.are_friends(uuid, uuid), public.can_see_run(uuid) from public, anon;
grant execute on function public.accept_game(uuid), public.decline_game(uuid), public.send_friend_request(text),
  public.respond_friend_request(uuid, boolean), public.remove_friend(uuid), public.my_friend_code(), public.list_friends(),
  public.invite_to_run(uuid, uuid), public.is_active_user(), public.are_friends(uuid, uuid), public.can_see_run(uuid) to authenticated;
