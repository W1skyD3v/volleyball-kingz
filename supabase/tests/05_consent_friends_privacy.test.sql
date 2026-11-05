begin;
select * from no_plan();
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set a2 '00000000-0000-0000-0000-0000000000a2'
\set a3 '00000000-0000-0000-0000-0000000000a3'
\set b1 '00000000-0000-0000-0000-0000000000b1'
\set b2 '00000000-0000-0000-0000-0000000000b2'

insert into auth.users (id) values (:'a1'), (:'a2'), (:'a3'), (:'b1'), (:'b2');
insert into public.profiles (id, display_name, birth_year, is_minor, friend_code) values
  (:'a1', 'Ana', 1990, false, 'ANAANA11'), (:'a2', 'Bo', 1991, false, 'BOBOBO22'), (:'a3', 'Cy', 1992, false, 'CYCYCY33'),
  (:'b1', 'TeenOne', 2010, true, 'TEEN0001'), (:'b2', 'TeenTwo', 2010, true, 'TEEN0002');
insert into public.courts (id, osm_type, osm_id, name, lat, lng, court_type) values ('10000000-0000-0000-0000-000000000001', 'way', 1, 'Court', 34.0522, -118.2437, 'full');
insert into public.check_ins (user_id, court_id, distance_m, expires_at) values
  (:'a1', '10000000-0000-0000-0000-000000000001', 1, now() + interval '1 hour'),
  (:'a2', '10000000-0000-0000-0000-000000000001', 1, now() + interval '1 hour');

-- ---------------------------------------------------------------- consent
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
select public.create_game('10000000-0000-0000-0000-000000000001', 'ranked', 1, '7-1s-w1', 'quick', array[:'a1']::uuid[], array[:'a2']::uuid[]) \gset
create temp table g as select id from public.games limit 1;
grant all on g to authenticated;
select is((select status from public.games), 'lobby', 'game starts as a lobby');
select is((select count(*)::int from public.game_players where accepted_at is not null), 1, 'only the creator has accepted');
select throws_ok($$select public.game_apply_event((select id from g), '{"type":"propose_final","score":{"A":7,"B":0}}')$$, 'P0001', 'not_all_confirmed', 'cannot score a lobby');
select set_config('request.jwt.claim.sub', :'a3', true);
select throws_ok($$select public.accept_game((select id from g))$$, 'P0001', 'game_not_found', 'outsiders cannot accept');
select set_config('request.jwt.claim.sub', :'a2', true);
reset role;
update public.check_ins set expires_at = now() - interval '1 minute' where user_id = :'a2';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a2', true);
select throws_ok($$select public.accept_game((select id from g))$$, 'P0001', 'ranked_requires_check_in', 'ranked re-checks check-ins when the last player accepts');
select is((select status from public.games), 'lobby', 'and the game stays a lobby');
reset role;
update public.check_ins set expires_at = now() + interval '1 hour' where user_id = :'a2';
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a2', true);
select is((select status from public.accept_game((select id from g))), 'active', 'accepting with a valid check-in starts the game');
select throws_ok($$select public.decline_game((select id from g))$$, 'P0001', 'already_started', 'cannot decline after kick-off');

-- decline voids a lobby
select set_config('request.jwt.claim.sub', :'a1', true);
select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '7-1s-w1', 'quick', array[:'a1']::uuid[], array[:'a2']::uuid[]) \gset
select set_config('request.jwt.claim.sub', :'a2', true);
select is((select status from public.decline_game((select id from public.games where status = 'lobby'))), 'voided', 'declining a lobby voids the game');

-- an unaccepted game never reaches the rating queue even if forced final
reset role;
insert into public.games (id, lane, tier, preset_id, mode, status, state, created_by) values ('30000000-0000-0000-0000-0000000000e1', 'casual', 1, '7-1s-w1', 'quick', 'active', '{}', :'a1');
insert into public.game_players (game_id, user_id, side, accepted_at) values ('30000000-0000-0000-0000-0000000000e1', :'a1', 'A', now()), ('30000000-0000-0000-0000-0000000000e1', :'a2', 'B', null);
update public.games set status = 'final' where id = '30000000-0000-0000-0000-0000000000e1';
select is((select count(*)::int from public.rating_jobs where game_id = '30000000-0000-0000-0000-0000000000e1'), 0, 'no rating job without everyone''s consent');
-- stale lobbies are voided after 2 hours
insert into public.games (id, lane, tier, preset_id, mode, status, state, created_by, updated_at) values ('30000000-0000-0000-0000-0000000000e2', 'casual', 1, '7-1s-w1', 'quick', 'lobby', '{"status":"lobby"}', :'a1', now() - interval '3 hours');
select is(public.expire_stale_games(24), 1, 'a 3-hour-old lobby expires');

-- ---------------------------------------------------------------- friends (by code only)
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
select is(public.my_friend_code(), 'ANAANA11', 'my friend code');
select is(public.send_friend_request('NOSUCHCD'), 'friend_not_found', 'unknown code');
select is(public.send_friend_request('TEEN0001'), 'friend_not_found', 'adults cannot friend a minor (same answer as unknown)');
select is(public.send_friend_request('ANAANA11'), 'friend_not_found', 'cannot friend yourself');
select is(public.send_friend_request(' boboBo22 '), 'sent', 'code is trimmed and case-insensitive');
select is(public.send_friend_request('BOBOBO22'), 'already_friends_or_pending', 'no duplicates');
select is((select relation from public.list_friends() where display_name = 'Bo'), 'outgoing', 'sender sees an outgoing request');
select set_config('request.jwt.claim.sub', :'a2', true);
select is((select relation from public.list_friends() where display_name = 'Ana'), 'incoming', 'receiver sees an incoming request');
select is((select court_name from public.list_friends() where display_name = 'Ana'), null, 'no location until accepted');
select lives_ok($$select public.respond_friend_request((select request_id from public.list_friends() where display_name = 'Ana'), true)$$, 'accept');
select is((select court_name from public.list_friends() where display_name = 'Ana'), 'Court', 'friends see where each other is checked in');
select set_config('request.jwt.claim.sub', :'a3', true);
select is((select count(*)::int from public.list_friends()), 0, 'strangers see nobody');
select set_config('request.jwt.claim.sub', :'b1', true);
select is(public.send_friend_request('TEEN0002'), 'sent', 'minors can friend minors');

-- ---------------------------------------------------------------- invite-only private runs
select set_config('request.jwt.claim.sub', :'a1', true);
reset role;
insert into public.runs (id, court_id, host_id, starts_at, tier, lane, preset_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', :'a1', now(), 1, 'private', '7-1s-w1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', :'a1', now(), 1, 'casual', '7-1s-w1');
insert into public.run_members (run_id, user_id) values ('20000000-0000-0000-0000-000000000001', :'a1');
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a3', true);
select is((select count(*)::int from public.runs), 1, 'strangers see the public run only');
select set_config('request.jwt.claim.sub', :'a2', true);
select is((select count(*)::int from public.runs), 1, 'a friend who is not invited still sees only the public run');
select throws_ok($$insert into public.run_members (run_id, user_id) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2')$$, '42501', null, 'cannot join a private run uninvited');
select set_config('request.jwt.claim.sub', :'a1', true);
select throws_ok($$select public.invite_to_run('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a3')$$, 'P0001', 'not_friends', 'only friends can be invited');
select throws_ok($$select public.invite_to_run('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000a2')$$, 'P0001', 'not_your_private_run', 'only private runs take invites');
select lives_ok($$select public.invite_to_run('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2')$$, 'host invites a friend');
select set_config('request.jwt.claim.sub', :'a2', true);
select is((select count(*)::int from public.runs), 2, 'the invited friend now sees the private run');
select lives_ok($$insert into public.run_members (run_id, user_id) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2')$$, 'and can join it');
select set_config('request.jwt.claim.sub', :'a3', true);
select is((select count(*)::int from public.runs), 1, 'strangers still cannot see it');

-- ---------------------------------------------------------------- private stats stay private
reset role;
insert into public.ratings (user_id, tier, kind, elo, games) values (:'a1', 1, 'private_elo', 1300, 3), (:'a1', 1, 'casual_elo', 1250, 2), (:'a1', 1, 'ranked', 1, 1);
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a2', true);
select is((select count(*)::int from public.ratings where user_id = :'a1'), 1, 'others see only the ranked rating row');
select set_config('request.jwt.claim.sub', :'a1', true);
select is((select count(*)::int from public.ratings where user_id = :'a1'), 3, 'owner sees all of their own');

reset role;
-- finals: one ranked, one private, both fully accepted
insert into public.games (id, lane, tier, preset_id, mode, status, state, created_by, score_a, score_b) values
  ('30000000-0000-0000-0000-0000000000f1', 'ranked', 1, '7-1s-w1', 'quick', 'final', '{}', :'a1', 7, 2),
  ('30000000-0000-0000-0000-0000000000f2', 'private', 1, '7-1s-w1', 'quick', 'final', '{}', :'a1', 7, 3);
insert into public.game_players (game_id, user_id, side, accepted_at) values
  ('30000000-0000-0000-0000-0000000000f1', :'a1', 'A', now()), ('30000000-0000-0000-0000-0000000000f1', :'a2', 'B', now()),
  ('30000000-0000-0000-0000-0000000000f2', :'a1', 'A', now()), ('30000000-0000-0000-0000-0000000000f2', :'a2', 'B', now());
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
select is((select sum(games)::int from public.player_stats(:'a1')), 2, 'you see your private games in your own history');
select set_config('request.jwt.claim.sub', :'a2', true);
select is((select sum(games)::int from public.player_stats(:'a1')), 1, 'others never see your private games');
select is((select wins from public.player_stats(:'a1') where lane = 'ranked'), 1, 'wins counted from the right side');
select set_config('request.jwt.claim.sub', :'a3', true);
select is((select count(*)::int from public.player_stats(:'b1')), 0, 'adults see no stats for minors');

-- ---------------------------------------------------------------- leaderboard
reset role;
insert into public.ratings (user_id, tier, kind, mu, sigma, games, distinct_opponents) values
  (:'a2', 1, 'ranked', 30, 3, 12, 6), (:'a3', 1, 'ranked', 26, 3, 12, 6), (:'b1', 1, 'ranked', 40, 3, 50, 20);
update public.ratings set games = 12, distinct_opponents = 6, mu = 28, sigma = 3 where user_id = :'a1' and kind = 'ranked';
set local role anon;
select is((select array_agg(display_name order by rank) from public.leaderboard(1, 10)), array['Bo', 'Ana', 'Cy'], 'public leaderboard: ranked, adults only, ordered');
select is((select rating from public.leaderboard(1, 10) where display_name = 'Bo'), 1320, 'rating on the display scale (30 -> 1320)');
select is((select count(*)::int from public.leaderboard(1, 10) where display_name like 'Teen%'), 0, 'minors never appear on the public leaderboard');
reset role;
update public.ratings set games = 4 where user_id = :'a3';
set local role anon;
select is((select count(*)::int from public.leaderboard(1, 10) where display_name = 'Cy'), 0, 'provisional players are not listed');

-- ---------------------------------------------------------------- deletion keeps name + ranked stats, scrubs the rest
reset role;
insert into public.gold_ledger (user_id, wallet, amount, reason) values (:'a2', 'earned', 10, 'game');
update public.profiles set gold_earned = 10, avatar = '{"seed":"s","jersey":{"style":"classic","primary":"#f5b301","secondary":"#1b1b1b","number":7},"shorts":{"color":"#1b1b1b"},"shoes":{"style":"low","color":"#ffffff"}}' where id = :'a2';
insert into public.ratings (user_id, tier, kind, elo, games) values (:'a2', 1, 'private_elo', 1250, 2);
insert into public.blocks (blocker_id, blocked_id) values (:'a2', :'a3');
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a2', true);
select public.delete_my_account(true);
reset role;
select is((select display_name from public.profiles where id = :'a2'), 'Bo', 'name kept');
select is((select count(*)::int from public.ratings where user_id = :'a2' and kind = 'ranked'), 1, 'ranked stats kept');
select is((select count(*)::int from public.ratings where user_id = :'a2' and kind <> 'ranked'), 0, 'private/casual ratings removed');
select is((select count(*)::int from public.game_players where user_id = :'a2'), 5, 'game seats kept');
select is((select count(*)::int from public.gold_ledger where user_id = :'a2'), 0, 'gold ledger removed');
select is((select count(*)::int from public.blocks where blocker_id = :'a2'), 0, 'blocks removed');
select is((select count(*)::int from public.friendships where requester_id = :'a2' or addressee_id = :'a2'), 0, 'friendships removed');
select is((select count(*)::int from public.profiles where id = :'a2' and avatar is null and birth_year is null and gold_earned = 0 and deleted_at is not null), 1, 'avatar, birth year and gold scrubbed');
set local role anon;
select is((select deleted from public.leaderboard(1, 10) where display_name = 'Bo'), true, 'deleted player still shows on the leaderboard, flagged');
reset role;
select public.scrub_profile(:'a3', false);
select is((select display_name from public.profiles where id = :'a3'), 'Deleted player', 'full erasure option replaces the name');

select * from finish();
rollback;
