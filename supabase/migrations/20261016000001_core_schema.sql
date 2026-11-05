-- Volleyball Kingz: Phase 1 draft schema. Needs PostGIS. RLS on every table.
-- PostGIS lives in its own schema, never in public: PostgREST exposes public, and ~750 PostGIS functions would otherwise be callable as /rpc endpoints.
create schema if not exists extensions;
create extension if not exists postgis with schema extensions;
set search_path = public, extensions;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (char_length(display_name) between 2 and 24),
  birth_year int not null check (birth_year between 1900 and 2100),
  is_minor boolean not null,
  casual_elo_opt_in boolean not null default false,
  avatar jsonb,
  gold_earned int not null default 0 check (gold_earned >= 0),
  gold_bought int not null default 0 check (gold_bought >= 0), -- stub: nothing credits this in the draft
  created_at timestamptz not null default now()
);

-- Neutral age screen: only birth year + minor flag are stored, never the full date. Under 13 is refused.
-- The server decides what "today" is: a client-supplied date would let an 8-year-old claim to be an adult (found by the security tests).
create function public.create_profile(p_display_name text, p_birth_date date)
returns public.profiles
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_age int := extract(year from age(current_date, p_birth_date));
  v_row public.profiles;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if v_age < 13 then raise exception 'age_blocked'; end if;
  insert into public.profiles (id, display_name, birth_year, is_minor)
  values (auth.uid(), p_display_name, extract(year from p_birth_date)::int, v_age < 18)
  returning * into v_row;
  return v_row;
end $$;

create function public.viewer_is_minor() returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select coalesce((select is_minor from public.profiles where id = auth.uid()), true)
$$;

-- ---------------------------------------------------------------- courts
create table public.courts (
  id uuid primary key default gen_random_uuid(),
  osm_type text not null check (osm_type in ('node', 'way', 'relation')),
  osm_id bigint not null,
  name text,
  lat double precision not null,
  lng double precision not null,
  geog geography(point, 4326) generated always as (st_setsrid(st_makepoint(lng, lat), 4326)::geography) stored,
  court_type text not null default 'unknown' check (court_type in ('full', 'half', 'unknown')),
  type_source text not null default 'none' check (type_source in ('geometry', 'bounds', 'tag', 'none')),
  hoops int,
  area_m2 int,
  access text,
  is_public boolean generated always as (coalesce(access, 'yes') not in ('private', 'no', 'customers', 'permit')) stored,
  full_confirmations int not null default 0,
  unique (osm_type, osm_id)
);
create index courts_geog_idx on public.courts using gist (geog);

-- blocks
create table public.blocks (
  blocker_id uuid not null references public.profiles (id) on delete cascade,
  blocked_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);

-- ---------------------------------------------------------------- check-ins (no raw coordinates stored)
create table public.check_ins (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  court_id uuid not null references public.courts (id) on delete cascade,
  distance_m real not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index check_ins_active_idx on public.check_ins (court_id, expires_at);

create function public.check_in(p_court_id uuid, p_lat double precision, p_lng double precision, p_accuracy_m double precision default 0)
returns public.check_ins
language plpgsql security definer set search_path = public, extensions as $$
declare
  c public.courts;
  v_dist double precision;
  v_credit double precision := least(greatest(coalesce(p_accuracy_m, 0), 0), 50);
  v_row public.check_ins;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into c from public.courts where id = p_court_id and is_public;
  if not found then raise exception 'court_not_found'; end if;
  v_dist := st_distance(c.geog, st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography);
  if v_dist - v_credit > 100 then raise exception 'too_far'; end if;
  -- one live check-in per user
  update public.check_ins set expires_at = now() where user_id = auth.uid() and expires_at > now();
  insert into public.check_ins (user_id, court_id, distance_m, expires_at)
  values (auth.uid(), p_court_id, v_dist, now() + interval '90 minutes')
  returning * into v_row;
  return v_row;
end $$;

-- Headcount per court. Adults never see minors (not even in the count). Minors see everyone.
create function public.court_headcounts()
returns table (court_id uuid, headcount int)
language sql stable security definer set search_path = public, extensions as $$
  select ci.court_id, count(*)::int
  from public.check_ins ci
  join public.profiles p on p.id = ci.user_id
  where ci.expires_at > now()
    and (public.viewer_is_minor() or not p.is_minor)
    and not exists (select 1 from public.blocks b
      where (b.blocker_id = auth.uid() and b.blocked_id = ci.user_id) or (b.blocker_id = ci.user_id and b.blocked_id = auth.uid()))
  group by ci.court_id
$$;

-- ---------------------------------------------------------------- blocks and reports
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid references public.profiles (id) on delete set null,
  target_type text not null check (target_type in ('post', 'user', 'game', 'run')),
  target_id text not null,
  reason text not null check (reason in ('harassment', 'unsafe', 'cheating', 'spam', 'inappropriate', 'other')),
  details text check (char_length(details) <= 1000),
  safety_escalation boolean not null default false, -- hidden after-game alert: routes to a human reviewer
  status text not null default 'open' check (status in ('open', 'reviewing', 'closed')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- runs (run board)
create table public.runs (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id) on delete cascade,
  host_id uuid not null references public.profiles (id) on delete cascade,
  starts_at timestamptz not null,
  tier int not null check (tier between 1 and 5),
  lane text not null check (lane in ('casual', 'private', 'ranked')),
  preset_id text not null,
  note text check (char_length(note) <= 200),
  status text not null default 'open' check (status in ('open', 'cancelled', 'done')),
  created_at timestamptz not null default now()
);
create table public.run_members (
  run_id uuid not null references public.runs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (run_id, user_id)
);

-- ---------------------------------------------------------------- games
create table public.games (
  id uuid primary key default gen_random_uuid(),
  court_id uuid references public.courts (id) on delete set null,
  run_id uuid references public.runs (id) on delete set null,
  lane text not null check (lane in ('casual', 'private', 'ranked')),
  tier int not null check (tier between 1 and 5),
  preset_id text not null,
  mode text not null check (mode in ('live', 'quick')),
  status text not null default 'active' check (status in ('active', 'awaiting_final', 'disputed', 'final', 'voided')),
  state jsonb not null, -- scoring reducer state from @vk/core
  score_a int not null default 0,
  score_b int not null default 0,
  created_by uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  finalized_at timestamptz
);
create table public.game_players (
  game_id uuid not null references public.games (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  side text not null check (side in ('A', 'B')),
  game_rating int check (game_rating between 1 and 5),
  primary key (game_id, user_id)
);
create table public.player_ratings_given (
  game_id uuid not null references public.games (id) on delete cascade,
  rater_id uuid not null references public.profiles (id) on delete cascade,
  ratee_id uuid not null references public.profiles (id) on delete cascade,
  stars int not null check (stars between 1 and 5),
  primary key (game_id, rater_id, ratee_id),
  check (rater_id <> ratee_id)
);

create function public.is_game_player(p_game uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select exists (select 1 from public.game_players where game_id = p_game and user_id = auth.uid())
$$;

-- Ranked needs every player checked in at the game's court (live check-in).
create function public.ranked_eligible(p_game uuid) returns boolean
language sql stable security definer set search_path = public, extensions as $$
  select not exists (
    select 1 from public.game_players gp
    join public.games g on g.id = gp.game_id
    where gp.game_id = p_game
      and not exists (select 1 from public.check_ins ci
        where ci.user_id = gp.user_id and ci.court_id = g.court_id and ci.expires_at > now())
  )
$$;

-- ---------------------------------------------------------------- ratings (server-written only)
create table public.ratings (
  user_id uuid not null references public.profiles (id) on delete cascade,
  tier int not null check (tier between 1 and 5),
  kind text not null check (kind in ('ranked', 'casual_elo', 'private_elo')),
  mu double precision not null default 25,
  sigma double precision not null default 8.333333333333334,
  elo double precision not null default 1200,
  games int not null default 0,
  distinct_opponents int not null default 0,
  primary key (user_id, tier, kind)
);
create table public.rating_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  game_id uuid not null references public.games (id) on delete cascade,
  tier int not null,
  kind text not null,
  before_rating int not null,
  after_rating int not null,
  reason text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- tier usage log (no limit enforced in the draft)
create table public.tier_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  lane text not null,
  tier int not null,
  created_at timestamptz not null default now()
);
create function public.log_tier_usage() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
begin
  insert into public.tier_usage (user_id, lane, tier)
  select new.user_id, g.lane, g.tier from public.games g where g.id = new.game_id;
  return new;
end $$;
create trigger game_players_tier_usage after insert on public.game_players
  for each row execute function public.log_tier_usage();

-- ---------------------------------------------------------------- gold ledger (earn-only in the draft)
create table public.gold_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  wallet text not null check (wallet in ('earned', 'bought')),
  amount int not null,
  reason text not null,
  game_id uuid references public.games (id) on delete set null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- account deletion
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = public, auth, extensions as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  delete from auth.users where id = auth.uid(); -- cascades to profiles and everything owned
end $$;
