-- Ratings, Gold and integrity flags are now computed INSIDE Postgres when a game becomes final.
-- Why: the only backend is then Supabase. No worker to host, no scheduler to pay for (a GitHub Actions cron every 10 minutes would
-- burn ~4,300 of the 2,000 free private-repo minutes a month), and finalization and rating are one atomic step.
-- The math mirrors packages/core/src/rating.ts; scripts/test-math-parity.ts fuzzes the two against each other.

-- ---------------------------------------------------------------- pure helpers (immutable, mirror TypeScript)
create function public.vk_display_rating(p_mu double precision) returns int language sql immutable as $$
  select floor(1200 + (p_mu - 25) * 24 + 0.5)::int   -- JS Math.round semantics (half up), not Postgres' half-even
$$;

create function public.vk_repeat_weight(p_opp int, p_mate int) returns double precision language sql immutable as $$
  -- double precision on purpose: bare literals are exact numerics in Postgres (0.85 * 0.85 = 0.7225) but IEEE doubles give 0.72249...,
  -- and the TypeScript the app displays uses doubles. Parity is pinned by scripts/test-math-parity.ts.
  select floor(greatest(0.25::double precision, 1::double precision - 0.15::double precision * greatest(0, p_opp)::double precision)
             * greatest(0.25::double precision, 1::double precision - 0.15::double precision * greatest(0, p_mate)::double precision)
             * 1000::double precision + 0.5::double precision) / 1000::double precision
$$;

create function public.vk_elo_update(p_rating double precision, p_games int, p_own_avg double precision, p_opp_avg double precision, p_won boolean, p_weight double precision)
returns table (new_rating double precision, delta double precision, reason text) language plpgsql immutable as $$
declare k int := case when p_games < 10 then 32 else 20 end; ex double precision; raw double precision; d double precision;
begin
  ex := 1 / (1 + power(10::double precision, (p_opp_avg - p_own_avg) / 400));
  raw := k * ((case when p_won then 1 else 0 end) - ex) * p_weight;
  d := floor(raw * 10 + 0.5) / 10;
  new_rating := floor((p_rating + d) * 10 + 0.5) / 10;
  delta := d;
  reason := case when p_weight = 0 then 'No change: result is on hold'
    else (case when p_won then 'Win' else 'Loss' end) || ' vs a side you were ' || floor(ex * 100 + 0.5)::int || '% to beat'
         || (case when p_weight < 1 then ' (reduced: repeat opponents/teammates)' else '' end) end;
  return next;
end $$;

-- OpenSkill Plackett-Luce for two teams (winner first). Defaults: mu 25, sigma 25/3, beta sigma/2, epsilon 1e-4, no tau.
create function public.vk_rate_two_teams(p_mu double precision[], p_sigma double precision[], p_side text[], p_winner text)
returns table (idx int, new_mu double precision, new_sigma double precision) language plpgsql immutable as $$
declare
  beta_sq double precision := power(25.0 / 3 / 2, 2);
  mu_a double precision := 0; mu_b double precision := 0; sq_a double precision := 0; sq_b double precision := 0;
  c double precision; mu_w double precision; mu_l double precision; ew double precision; el double precision; p double precision;
  i int; team_sq double precision; omega double precision; delta double precision; gamma double precision; i_omega double precision; i_delta double precision;
  won boolean;
begin
  for i in 1..cardinality(p_mu) loop
    if p_side[i] = 'A' then mu_a := mu_a + p_mu[i]; sq_a := sq_a + p_sigma[i] ^ 2; else mu_b := mu_b + p_mu[i]; sq_b := sq_b + p_sigma[i] ^ 2; end if;
  end loop;
  c := sqrt(sq_a + sq_b + 2 * beta_sq);
  mu_w := case when p_winner = 'A' then mu_a else mu_b end;
  mu_l := case when p_winner = 'A' then mu_b else mu_a end;
  ew := exp(mu_w / c); el := exp(mu_l / c);
  p := ew / (ew + el);
  for i in 1..cardinality(p_mu) loop
    won := p_side[i] = p_winner;
    team_sq := case when p_side[i] = 'A' then sq_a else sq_b end;
    omega := case when won then 1 - p else -(1 - p) end;
    delta := p * (1 - p);
    gamma := sqrt(team_sq) / c;
    i_omega := omega * (team_sq / c);
    i_delta := gamma * delta * (team_sq / (c ^ 2));
    idx := i;
    new_mu := p_mu[i] + (p_sigma[i] ^ 2 / team_sq) * i_omega;
    new_sigma := p_sigma[i] * sqrt(greatest(1 - (p_sigma[i] ^ 2 / team_sq) * i_delta, 1e-4));
    return next;
  end loop;
end $$;

-- ---------------------------------------------------------------- cold-start prior (mirror of priorFor in packages/core/src/rating.ts)
-- A player's first ranked game in a new tier starts from their other tiers: games-weighted mean mu (weight = min(games, 30)),
-- sigma = 1.5 x the weighted mean sigma kept between 5 and the default 25/3. No history: the default rating.
create function public.vk_prior_from(p_mu double precision[], p_sigma double precision[], p_games int[]) returns table (mu double precision, sigma double precision)
language plpgsql immutable set search_path = public, extensions as $$
declare i int; w double precision; total double precision := 0; sm double precision := 0; ss double precision := 0;
begin
  for i in 1..coalesce(cardinality(p_mu), 0) loop
    if p_games[i] > 0 then
      w := least(p_games[i], 30)::double precision;
      total := total + w; sm := sm + w * p_mu[i]; ss := ss + w * p_sigma[i];
    end if;
  end loop;
  if total = 0 then
    mu := 25; sigma := 25.0::double precision / 3;
  else
    mu := sm / total;
    sigma := least(25.0::double precision / 3, greatest(5::double precision, 1.5::double precision * (ss / total)));
  end if;
  return next;
end $$;

-- ---------------------------------------------------------------- Gold (mirror of goldBreakdown in packages/core/src/gold.ts)
-- Base 10 (15 ranked), +10 first confirmed game of the UTC day, +50 once per UTC week on the 3rd distinct play day.
-- Each piece is limited by what is left of the 100/day earn cap. Spending (negative rows) never lowers today's earnings.
create function public.award_game_gold(p_game uuid, p_user uuid, p_lane text, p_now timestamptz default now()) returns int
language plpgsql security definer set search_path = public, extensions as $$
declare
  day_start timestamptz := date_trunc('day', p_now at time zone 'utc') at time zone 'utc';
  week_start timestamptz := date_trunc('week', p_now at time zone 'utc') at time zone 'utc';
  today int;
  left_ int;
  got int;
  total int := 0;
  first_of_day boolean;
  days_this_week int;
  weekly_paid boolean;
begin
  select coalesce(sum(amount) filter (where amount > 0), 0)::int into today
    from public.gold_ledger where user_id = p_user and wallet = 'earned' and created_at >= day_start and created_at < day_start + interval '1 day';
  left_ := greatest(0, 100 - today);
  select not exists (select 1 from public.gold_ledger where user_id = p_user and reason = 'game' and created_at >= day_start and created_at < day_start + interval '1 day') into first_of_day;

  got := least(case when p_lane = 'ranked' then 15 else 10 end, left_);
  if got > 0 then
    insert into public.gold_ledger (user_id, wallet, amount, reason, game_id, created_at) values (p_user, 'earned', got, 'game', p_game, p_now);
    left_ := left_ - got; total := total + got;
  end if;
  if first_of_day then
    got := least(10, left_);
    if got > 0 then
      insert into public.gold_ledger (user_id, wallet, amount, reason, game_id, created_at) values (p_user, 'earned', got, 'first_game_bonus', p_game, p_now);
      left_ := left_ - got; total := total + got;
    end if;
    select count(distinct (created_at at time zone 'utc')::date)::int into days_this_week
      from public.gold_ledger where user_id = p_user and reason = 'game' and created_at >= week_start and created_at < week_start + interval '7 days';
    select exists (select 1 from public.gold_ledger where user_id = p_user and reason = 'weekly_goal' and created_at >= week_start and created_at < week_start + interval '7 days') into weekly_paid;
    if days_this_week >= 3 and not weekly_paid then
      got := least(50, left_);
      if got > 0 then
        insert into public.gold_ledger (user_id, wallet, amount, reason, game_id, created_at) values (p_user, 'earned', got, 'weekly_goal', p_game, p_now);
        total := total + got;
      end if;
    end if;
  end if;
  if total > 0 then update public.profiles set gold_earned = gold_earned + total where id = p_user; end if;
  return total;
end $$;
revoke execute on function public.award_game_gold(uuid, uuid, text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------- the pipeline for one finished game
create function public.process_game_result(p_game uuid) returns text
language plpgsql security definer set search_path = public, extensions as $$
declare
  g public.games;
  pl record; me record;
  ids uuid[]; sides text[]; mus double precision[]; sigmas double precision[]; elos double precision[]; gms int[]; opt boolean[];
  n int; i int; win text; v_kind text; won boolean;
  n_opp int; n_mate int; w double precision;
  rmu double precision; rsigma double precision; rgames int; relo double precision; rdist int;
  new_mu double precision; new_sigma double precision; bmu double precision; bsigma double precision;
  d int; reason text;
  avg_a double precision; avg_b double precision; own_avg double precision; opp_avg double precision;
  e record; today int; amt int; base int; pair record;
begin
  select * into g from public.games where id = p_game;
  if not found then return 'game missing'; end if;
  if g.status <> 'final' then return 'not final (' || g.status || ')'; end if;
  if exists (select 1 from public.game_players where game_id = p_game and accepted_at is null) then
    return 'consent missing: not rated'; -- defence in depth: the trigger already refuses to enqueue these
  end if;
  win := case when g.score_a > g.score_b then 'A' else 'B' end;

  select array_agg(gp.user_id order by gp.side, gp.is_captain desc, gp.user_id), array_agg(gp.side order by gp.side, gp.is_captain desc, gp.user_id),
         array_agg(p.casual_elo_opt_in order by gp.side, gp.is_captain desc, gp.user_id)
    into ids, sides, opt
  from public.game_players gp join public.profiles p on p.id = gp.user_id where gp.game_id = p_game;
  n := cardinality(ids);

  -- helper: repeat counts (30 days) against / with the other players in this game, before this game
  -- (inline per player below)

  if g.lane = 'ranked' then
    mus := array[]::double precision[]; sigmas := array[]::double precision[]; gms := array[]::int[];
    for i in 1..n loop
      select r.mu, r.sigma, r.games into rmu, rsigma, rgames from public.ratings r where r.user_id = ids[i] and r.tier = g.tier and r.kind = 'ranked';
      if not found then
        select pr.mu, pr.sigma into rmu, rsigma from public.vk_prior_from(
          (select coalesce(array_agg(r2.mu), array[]::double precision[]) from public.ratings r2 where r2.user_id = ids[i] and r2.kind = 'ranked' and r2.tier <> g.tier),
          (select coalesce(array_agg(r2.sigma), array[]::double precision[]) from public.ratings r2 where r2.user_id = ids[i] and r2.kind = 'ranked' and r2.tier <> g.tier),
          (select coalesce(array_agg(r2.games), array[]::int[]) from public.ratings r2 where r2.user_id = ids[i] and r2.kind = 'ranked' and r2.tier <> g.tier)) pr;
        rgames := 0;
      end if;
      mus := mus || rmu; sigmas := sigmas || rsigma; gms := gms || rgames;
    end loop;
    for e in select * from public.vk_rate_two_teams(mus, sigmas, sides, win) loop
      i := e.idx;
      select coalesce(max(cnt), 0) into n_opp from (select count(*) cnt from public.game_players m join public.game_players o on o.game_id = m.game_id and o.user_id <> m.user_id
        join public.games g2 on g2.id = m.game_id where m.user_id = ids[i] and o.user_id = any (ids) and o.side <> m.side and g2.id <> p_game and g2.status = 'final'
        and g2.lane = g.lane and g2.finalized_at > now() - interval '30 days' group by o.user_id) q;
      select coalesce(max(cnt), 0) into n_mate from (select count(*) cnt from public.game_players m join public.game_players o on o.game_id = m.game_id and o.user_id <> m.user_id
        join public.games g2 on g2.id = m.game_id where m.user_id = ids[i] and o.user_id = any (ids) and o.side = m.side and g2.id <> p_game and g2.status = 'final'
        and g2.lane = g.lane and g2.finalized_at > now() - interval '30 days' group by o.user_id) q;
      w := public.vk_repeat_weight(n_opp, n_mate);
      bmu := mus[i] + (e.new_mu - mus[i]) * w;
      bsigma := sigmas[i] + (e.new_sigma - sigmas[i]) * w;
      won := sides[i] = win;
      d := public.vk_display_rating(bmu) - public.vk_display_rating(mus[i]);
      reason := case when w = 0 then 'No change: result is on hold'
        else (case when won then 'Win' else 'Loss' end) || ': ' || (case when d >= 0 then '+' else '' end) || d || (case when w < 1 then ' (reduced: repeat opponents/teammates)' else '' end) end;
      select count(distinct o.user_id)::int into rdist from public.game_players m join public.game_players o on o.game_id = m.game_id and o.side <> m.side
        join public.games g2 on g2.id = m.game_id where m.user_id = ids[i] and g2.status = 'final' and g2.lane = 'ranked' and g2.tier = g.tier;
      insert into public.ratings (user_id, tier, kind, mu, sigma, games, distinct_opponents) values (ids[i], g.tier, 'ranked', bmu, bsigma, gms[i] + 1, rdist)
        on conflict (user_id, tier, kind) do update set mu = excluded.mu, sigma = excluded.sigma, games = excluded.games, distinct_opponents = excluded.distinct_opponents;
      insert into public.rating_events (user_id, game_id, tier, kind, before_rating, after_rating, reason)
        values (ids[i], p_game, g.tier, 'ranked', public.vk_display_rating(mus[i]), public.vk_display_rating(bmu), reason);
    end loop;

  elsif g.lane in ('private', 'casual') then
    v_kind := case g.lane when 'private' then 'private_elo' else 'casual_elo' end;
    elos := array[]::double precision[]; gms := array[]::int[];
    for i in 1..n loop
      select r.elo, r.games into relo, rgames from public.ratings r where r.user_id = ids[i] and r.tier = g.tier and r.kind = v_kind;
      if not found then relo := 1200; rgames := 0; end if;
      elos := elos || relo; gms := gms || rgames;
    end loop;
    select avg(elos[k]) into avg_a from generate_subscripts(elos, 1) k where sides[k] = 'A';
    select avg(elos[k]) into avg_b from generate_subscripts(elos, 1) k where sides[k] = 'B';
    for i in 1..n loop
      if g.lane = 'casual' and not opt[i] then continue; end if;
      select coalesce(max(cnt), 0) into n_opp from (select count(*) cnt from public.game_players m join public.game_players o on o.game_id = m.game_id and o.user_id <> m.user_id
        join public.games g2 on g2.id = m.game_id where m.user_id = ids[i] and o.user_id = any (ids) and o.side <> m.side and g2.id <> p_game and g2.status = 'final'
        and g2.lane = g.lane and g2.finalized_at > now() - interval '30 days' group by o.user_id) q;
      select coalesce(max(cnt), 0) into n_mate from (select count(*) cnt from public.game_players m join public.game_players o on o.game_id = m.game_id and o.user_id <> m.user_id
        join public.games g2 on g2.id = m.game_id where m.user_id = ids[i] and o.user_id = any (ids) and o.side = m.side and g2.id <> p_game and g2.status = 'final'
        and g2.lane = g.lane and g2.finalized_at > now() - interval '30 days' group by o.user_id) q;
      w := public.vk_repeat_weight(n_opp, n_mate);
      own_avg := case when sides[i] = 'A' then avg_a else avg_b end;
      opp_avg := case when sides[i] = 'A' then avg_b else avg_a end;
      select * into me from public.vk_elo_update(elos[i], gms[i], own_avg, opp_avg, sides[i] = win, w);
      insert into public.ratings (user_id, tier, kind, elo, games) values (ids[i], g.tier, v_kind, me.new_rating, gms[i] + 1)
        on conflict (user_id, tier, kind) do update set elo = excluded.elo, games = excluded.games;
      insert into public.rating_events (user_id, game_id, tier, kind, before_rating, after_rating, reason)
        values (ids[i], p_game, g.tier, v_kind, floor(elos[i] + 0.5)::int, floor(me.new_rating + 0.5)::int, me.reason);
    end loop;
  end if;

  -- Gold: earned wallet only, capped per day, never read by rating code.
  for i in 1..n loop
    perform public.award_game_gold(p_game, ids[i], g.lane);
  end loop;

  -- Integrity: the same pair meeting again and again in ranked is the signature of win trading.
  if g.lane = 'ranked' then
    for pair in
      select m.user_id a, o.user_id b, count(*) filter (where g2.finalized_at > now() - interval '7 days')::int week
      from public.game_players m join public.game_players o on o.game_id = m.game_id and o.user_id <> m.user_id join public.games g2 on g2.id = m.game_id
      where m.user_id < o.user_id and m.side <> o.side and m.user_id = any (ids) and o.user_id = any (ids) and g2.id <> p_game and g2.status = 'final' and g2.lane = 'ranked'
      group by m.user_id, o.user_id
      having count(*) filter (where g2.finalized_at > now() - interval '7 days') + 1 >= 5
    loop
      insert into public.integrity_flags (user_id, game_id, kind, detail) values
        (pair.a, p_game, 'repeat_pairing', (pair.week + 1) || ' ranked games between the same two players in 7 days'),
        (pair.b, p_game, 'repeat_pairing', (pair.week + 1) || ' ranked games between the same two players in 7 days');
    end loop;
  end if;
  return 'ok';
end $$;
revoke execute on function public.process_game_result(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------- run it when a game becomes final
create or replace function public.games_enqueue_rating() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare r text;
begin
  if new.status = 'final' and old.status <> 'final' and not exists (select 1 from public.game_players where game_id = new.id and accepted_at is null) then
    insert into public.rating_jobs (game_id) values (new.id) on conflict do nothing;
    begin
      r := public.process_game_result(new.id);
      update public.rating_jobs set processed_at = now(), error = case when r = 'ok' then null else r end where game_id = new.id;
    exception when others then
      -- A rating bug must never block finalizing a game. The sub-transaction rolled back any partial writes; keep the job for a retry.
      update public.rating_jobs set error = sqlerrm where game_id = new.id;
    end;
  end if;
  return new;
end $$;
revoke execute on function public.games_enqueue_rating() from public, anon, authenticated;

-- Retry anything that failed or was left unprocessed (cron or manual; not callable by clients).
create function public.retry_rating_jobs() returns int language plpgsql security definer set search_path = public, extensions as $$
declare j record; r text; n int := 0;
begin
  for j in select game_id from public.rating_jobs where processed_at is null order by created_at for update skip locked loop
    begin
      r := public.process_game_result(j.game_id);
      update public.rating_jobs set processed_at = now(), error = case when r = 'ok' then null else r end where game_id = j.game_id;
      n := n + 1;
    exception when others then
      update public.rating_jobs set error = sqlerrm where game_id = j.game_id;
    end;
  end loop;
  return n;
end $$;
revoke execute on function public.retry_rating_jobs() from public, anon, authenticated;

-- ---------------------------------------------------------------- scheduling without any external service
-- pg_cron ships with Supabase (including the free plan). Plain Postgres in tests may not have it, so this is conditional.
do $$ begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('vk-expire-stale-games', '*/15 * * * *', 'select public.expire_stale_games(24)');
    perform cron.schedule('vk-retry-rating-jobs', '*/30 * * * *', 'select public.retry_rating_jobs()');
  end if;
exception when others then
  -- Scheduling is a convenience: if the host does not allow it from a migration, enable pg_cron in the dashboard and run the two
  -- cron.schedule calls once by hand. A scheduling problem must never stop the database from being created.
  raise notice 'pg_cron scheduling skipped: %', sqlerrm;
end $$;
