begin;
select * from no_plan();
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set a2 '00000000-0000-0000-0000-0000000000a2'
\set a3 '00000000-0000-0000-0000-0000000000a3'
insert into auth.users (id) values (:'a1'), (:'a2'), (:'a3');
insert into public.profiles (id, display_name, birth_year, is_minor, friend_code, gold_earned) values
  (:'a1', 'Ana', 1990, false, 'ANAANA11', 50), (:'a2', 'Bo', 1985, false, 'BOBOBO22', 70), (:'a3', 'Cy', 1992, false, 'CYCYCY33', 0);
insert into public.courts (id, osm_type, osm_id, name, lat, lng, court_type) values
  ('10000000-0000-0000-0000-000000000001', 'way', 1, 'LA court', 34.0522, -118.2437, 'full'),
  ('10000000-0000-0000-0000-000000000002', 'way', 2, 'SF court', 37.7749, -122.4194, 'full');

-- ---------------------------------------------------------------- profiles: other people see a name and an avatar, nothing else
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
select is((select display_name from public.profiles where id = :'a2'), 'Bo', 'others can still see a display name');
select throws_ok($$select birth_year from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'$$, '42501', null, 'birth year is not readable');
select throws_ok($$select friend_code from public.profiles$$, '42501', null, 'friend codes cannot be harvested');
select throws_ok($$select gold_earned from public.profiles$$, '42501', null, 'Gold balance is not readable');
select throws_ok($$select casual_elo_opt_in from public.profiles$$, '42501', null, 'opt-in settings are not readable');
select throws_ok($$select * from public.profiles$$, '42501', null, 'select * is refused');
select is((select birth_year from public.my_profile()), 1990, 'my own row is available through my_profile()');
select is((select friend_code from public.my_profile()), 'ANAANA11', 'including my friend code');
select lives_ok($$update public.profiles set display_name = 'Ana2' where id = '00000000-0000-0000-0000-0000000000a1'$$, 'I can still rename myself');
select throws_ok($$update public.profiles set friend_code = 'HACKED' where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'but not change my friend code');

-- ---------------------------------------------------------------- friend-code guessing is throttled
select set_config('request.jwt.claim.sub', :'a3', true);
select is((select count(*) from (select public.send_friend_request('GUESS' || g::text) from generate_series(1, 10) g) q), 10::bigint, 'ten wrong guesses are answered');
select is(public.send_friend_request('GUESS11'), 'rate_limited', 'the eleventh is refused');
select is(public.send_friend_request('ANAANA11'), 'rate_limited', 'even a correct code is refused while throttled');
reset role;
update public.friend_lookup_failures set at = now() - interval '2 hours';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a3', true);
select is(public.send_friend_request('ANAANA11'), 'sent', 'the throttle expires after an hour');

-- ---------------------------------------------------------------- impossible travel is flagged, not blocked
reset role;
insert into public.check_ins (user_id, court_id, distance_m, created_at, expires_at)
  values (:'a1', '10000000-0000-0000-0000-000000000001', 1, now() - interval '10 minutes', now() + interval '80 minutes');
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
select lives_ok($$select public.check_in('10000000-0000-0000-0000-000000000002', 37.7749, -122.4194, 5)$$, 'check-in 560 km away 10 minutes later still succeeds');
reset role;
select is((select count(*)::int from public.integrity_flags where user_id = :'a1' and kind = 'impossible_travel'), 1, 'but raises an impossible_travel flag');

-- ---------------------------------------------------------------- void needs both captains once play has started
insert into public.check_ins (user_id, court_id, distance_m, expires_at) values
  (:'a2', '10000000-0000-0000-0000-000000000002', 1, now() + interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
select public.create_game('10000000-0000-0000-0000-000000000002', 'casual', 1, '7-1s-w1', 'live', array[:'a1']::uuid[], array[:'a2']::uuid[]) \gset
create temp table g as select id from public.games limit 1;
grant all on g to authenticated;
select set_config('request.jwt.claim.sub', :'a2', true);
select public.accept_game((select id from g));
-- 0-0: either captain may void at once
select set_config('request.jwt.claim.sub', :'a1', true);
select public.game_apply_event((select id from g), '{"type":"claim_point","points":1}');
select set_config('request.jwt.claim.sub', :'a2', true);
select public.game_apply_event((select id from g), '{"type":"confirm_point"}');
-- now 1-0 to A: B (losing) tries to bail out
select is((select status from public.game_apply_event((select id from g), '{"type":"void"}')), 'active', 'the losing side cannot void alone');
select is((select state->'voidRequest'->>'by' from public.games), 'B', 'it only records a request');
select is((select status from public.game_apply_event((select id from g), '{"type":"void"}')), 'active', 'asking twice does not void it');
select set_config('request.jwt.claim.sub', :'a1', true);
select is((select status from public.game_apply_event((select id from g), '{"type":"void"}')), 'voided', 'the other captain agreeing voids it');
reset role;
select is((select count(*)::int from public.rating_jobs), 0, 'and a voided game is never rated');

-- a game that dies while disputed flags whoever raised the dispute
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
select public.create_game('10000000-0000-0000-0000-000000000002', 'casual', 1, '7-1s-w1', 'live', array[:'a1']::uuid[], array[:'a2']::uuid[]) \gset
create temp table g2 as select id from public.games where status = 'lobby';
grant all on g2 to authenticated;
select set_config('request.jwt.claim.sub', :'a2', true);
select public.accept_game((select id from g2));
select public.game_apply_event((select id from g2), '{"type":"claim_point","points":1}');
select set_config('request.jwt.claim.sub', :'a1', true);
select public.game_apply_event((select id from g2), '{"type":"dispute","reason":"nope"}');
reset role;
alter table public.games disable trigger games_touch;
update public.games set updated_at = now() - interval '3 days' where id = (select id from g2);
alter table public.games enable trigger games_touch;
select is(public.expire_stale_games(24), 1, 'a stale disputed game is voided');
select is((select user_id from public.integrity_flags where kind = 'dispute_void'), :'a1'::uuid, 'and the player who raised the dispute is flagged');

select * from finish();
rollback;
