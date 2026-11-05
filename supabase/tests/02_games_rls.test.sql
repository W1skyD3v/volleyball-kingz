begin;
select * from no_plan();

insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000a3'),
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
insert into public.profiles (id, display_name, birth_year, is_minor) values
  ('00000000-0000-0000-0000-0000000000a1', 'AdultOne', 1990, false),
  ('00000000-0000-0000-0000-0000000000a2', 'AdultTwo', 1991, false),
  ('00000000-0000-0000-0000-0000000000a3', 'AdultThree', 1992, false),
  ('00000000-0000-0000-0000-0000000000b1', 'MinorOne', 2010, true),
  ('00000000-0000-0000-0000-0000000000b2', 'MinorTwo', 2010, true);
insert into public.courts (id, osm_type, osm_id, lat, lng, court_type, full_confirmations) values
  ('10000000-0000-0000-0000-000000000001', 'way', 1, 34.0522, -118.2437, 'full', 1),
  ('10000000-0000-0000-0000-000000000002', 'way', 2, 34.0600, -118.2437, 'half', 0),
  ('10000000-0000-0000-0000-000000000003', 'way', 3, 34.0700, -118.2437, 'full', 0);

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select throws_ok($$insert into public.games (court_id, lane, tier, preset_id, mode, state, created_by) values (null, 'casual', 1, '11-1s-w2', 'live', '{}', '00000000-0000-0000-0000-0000000000a1')$$, '42501', null, 'clients cannot insert games directly');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '11-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a2']::uuid[], array['00000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'P0001', 'creator_must_captain_a', 'creator must lead side A');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '11-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'P0001', 'bad_roster', 'a minor is invisible to an adult, so cannot be seated');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'ranked', 1, '11-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[])$$, 'P0001', 'ranked_requires_check_in', 'ranked needs live check-ins');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 2, '11-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[])$$, 'P0001', 'bad_roster', 'roster size must equal tier');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '12-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[])$$, 'P0001', 'bad_preset', 'unknown preset refused');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000002', 'casual', 5, '11-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a5']::uuid[], array['00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-0000000000a9','00000000-0000-0000-0000-0000000000aa']::uuid[])$$, 'P0001', 'five_on_five_needs_full_court', '5v5 refused on a half court');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000003', 'casual', 5, '11-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a1','00000000-0000-0000-0000-0000000000a2','00000000-0000-0000-0000-0000000000a3','00000000-0000-0000-0000-0000000000a4','00000000-0000-0000-0000-0000000000a5']::uuid[], array['00000000-0000-0000-0000-0000000000a6','00000000-0000-0000-0000-0000000000a7','00000000-0000-0000-0000-0000000000a8','00000000-0000-0000-0000-0000000000a9','00000000-0000-0000-0000-0000000000aa']::uuid[])$$, 'P0001', 'five_on_five_needs_full_court', '5v5 refused on an unconfirmed full court');
select lives_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '11-1s-w2', 'live', array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[])$$, 'adult game is created');
select is((select count(*)::int from public.games), 1, 'creator sees the game');
select is((select count(*)::int from public.tier_usage), 1, 'tier usage logged for the creator');

-- minors play only with minors
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select lives_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '7-1s-w1', 'quick', array['00000000-0000-0000-0000-0000000000b1']::uuid[], array['00000000-0000-0000-0000-0000000000b2']::uuid[])$$, 'minor vs minor game is created');
select throws_ok($$select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '7-1s-w1', 'quick', array['00000000-0000-0000-0000-0000000000b1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[])$$, 'P0001', 'age_mix', 'minors and adults never share a game');

-- non-participants see nothing
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
select is((select count(*)::int from public.games), 0, 'non-participant cannot see games');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select is((select count(*)::int from public.games), 1, 'participant sees only their game');
reset role;
select is((select count(*)::int from public.tier_usage), 4, 'tier usage logged for every player, no limit enforced');

select * from finish();
rollback;
