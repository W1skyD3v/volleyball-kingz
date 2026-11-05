begin;
select * from no_plan();

insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'), ('00000000-0000-0000-0000-0000000000a3'), ('00000000-0000-0000-0000-0000000000a4'), ('00000000-0000-0000-0000-0000000000a5');
insert into public.profiles (id, display_name, birth_year, is_minor) values
  ('00000000-0000-0000-0000-0000000000a1', 'One', 1990, false), ('00000000-0000-0000-0000-0000000000a2', 'Two', 1990, false),
  ('00000000-0000-0000-0000-0000000000a3', 'Three', 1990, false), ('00000000-0000-0000-0000-0000000000a4', 'Four', 1990, false),
  ('00000000-0000-0000-0000-0000000000a5', 'Five', 1990, false);
insert into public.courts (id, osm_type, osm_id, lat, lng, court_type) values ('10000000-0000-0000-0000-000000000001', 'way', 1, 34.0522, -118.2437, 'full');
insert into public.check_ins (user_id, court_id, distance_m, expires_at) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 1, now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 1, now() + interval '1 hour');

set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

-- live game to 7, ones only, win by 1 (ranked: both checked in)
select public.create_game('10000000-0000-0000-0000-000000000001', 'ranked', 1, '7-1s-w1', 'live', array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[]) \gset
create temp table gid as select (select id from public.games limit 1) as id;
grant all on gid to authenticated;

-- consent first: nothing can be scored until the other seated player accepts
select is((select status from public.games), 'lobby', 'a new game waits in the lobby');
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1}')$$, 'P0001', 'not_all_confirmed', 'no scoring before everyone accepts');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select is((select status from public.accept_game((select id from gid))), 'active', 'last acceptance starts the game');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":2}')$$, 'P0001', 'points_not_allowed', 'a 2 is refused in ones-only');
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"propose_final","score":{"A":7,"B":0}}')$$, 'P0001', 'quick_only', 'final proposals are quick-mode only');
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1}')$$, 'A claims a point');
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_point"}')$$, 'P0001', 'other_side_must_confirm', 'claimer cannot confirm their own point');
select is((select score_a from public.games), 0, 'unconfirmed point does not count');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_point"}')$$, 'P0001', 'game_not_found', 'outsiders cannot see or touch the game');

select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_point"}')$$, 'B confirms');
select is((select score_a from public.games), 1, 'confirmed point counts');

-- dispute freezes
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1}')$$, 'B claims');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"dispute","reason":"travelled"}')$$, 'A disputes');
select is((select status from public.games), 'disputed', 'game is frozen');
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1}')$$, 'P0001', 'not_active', 'no scoring while disputed');
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"resolve_dispute","score":{"A":1,"B":0}}')$$, 'A submits 1-0');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"resolve_dispute","score":{"A":1,"B":1}}')$$, 'B submits 1-1');
select is((select status from public.games), 'disputed', 'disagreement stays frozen');
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"resolve_dispute","score":{"A":6,"B":0}}')$$, 'B changes to 6-0');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"resolve_dispute","score":{"A":6,"B":0}}')$$, 'A agrees 6-0');
select is((select status from public.games), 'active', 'agreement resumes the game');
select is((select count(*)::int from (select 1 from public.games where state->>'pending' is null) q), 1, 'pending claim cleared');

-- play out the last point, both confirm final
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1}')$$, 'A claims point 7');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_point"}')$$, 'B confirms point 7');
select is((select status from public.games), 'awaiting_final', 'target reached');
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_final"}')$$, 'B confirms final');
select is((select status from public.games), 'awaiting_final', 'one confirmation is not enough');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_final"}')$$, 'A confirms final');
select is((select status from public.games), 'final', 'both confirmed: final');
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1}')$$, 'P0001', 'game_closed', 'final games are closed');
reset role;
select is((select count(*)::int from public.rating_jobs where processed_at is not null and error is null), 1, 'finalization created exactly one rating job and processed it in the same transaction');
select is((select count(*)::int from public.rating_events), 2, 'and both players got a rating event');

-- feedback only after final, only by players
set local role authenticated;
select lives_ok($$select public.rate_game((select id from gid), 5)$$, 'player rates the game');
select lives_ok($$select public.rate_player((select id from gid), '00000000-0000-0000-0000-0000000000a2', 4)$$, 'player rates an opponent');
select throws_ok($$select public.rate_player((select id from gid), '00000000-0000-0000-0000-0000000000a1', 5)$$, 'P0001', 'not_allowed', 'cannot rate yourself');
select throws_ok($$select public.rate_player((select id from gid), '00000000-0000-0000-0000-0000000000a5', 5)$$, 'P0001', 'not_allowed', 'cannot rate a non-participant');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
select throws_ok($$select public.rate_game((select id from gid), 1)$$, 'P0001', 'not_allowed', 'outsiders cannot rate');

-- quick mode: invalid finals refused, valid final needs the other side
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 1, '11-1s-w2', 'quick', array['00000000-0000-0000-0000-0000000000a1']::uuid[], array['00000000-0000-0000-0000-0000000000a2']::uuid[]) \gset
create temp table qid as select id from public.games where mode = 'quick';
grant all on qid to authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select public.accept_game((select id from qid));
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select throws_ok($$select public.game_apply_event((select id from qid), '{"type":"propose_final","score":{"A":12,"B":9}}')$$, 'P0001', 'invalid_final', '12-9 is unreachable under win-by-2 to 11');
select lives_ok($$select public.game_apply_event((select id from qid), '{"type":"propose_final","score":{"A":12,"B":10}}')$$, '12-10 is valid');
select throws_ok($$select public.game_apply_event((select id from qid), '{"type":"confirm_proposed"}')$$, 'P0001', 'other_side_must_confirm', 'proposer cannot confirm');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select lives_ok($$select public.game_apply_event((select id from qid), '{"type":"confirm_proposed"}')$$, 'other side confirms');
select is((select score_a from public.games where mode = 'quick'), 12, 'score stored');

-- check-out
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select is((select headcount from public.court_headcounts() where court_id = '10000000-0000-0000-0000-000000000001'), 2, 'two checked in');
select lives_ok($$select public.check_out()$$, 'check out');
select is((select headcount from public.court_headcounts() where court_id = '10000000-0000-0000-0000-000000000001'), 1, 'headcount drops after check-out');

-- confirm full court requires live check-in, counts once per user
select throws_ok($$select public.confirm_court_fit('10000000-0000-0000-0000-000000000001')$$, 'P0001', 'not_checked_in', 'must be checked in');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a2', true);
select is(public.confirm_court_fit('10000000-0000-0000-0000-000000000001'), 1, 'first confirmation');
select is(public.confirm_court_fit('10000000-0000-0000-0000-000000000001'), 1, 'same user cannot double count');

-- moderation: 3 distinct reporters hide a run; safety escalation hides at once
reset role;
insert into public.runs (id, court_id, host_id, starts_at, tier, lane, preset_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', now(), 2, 'casual', '11-1s-w1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a5', now(), 2, 'casual', '11-1s-w1');
insert into public.reports (reporter_id, target_type, target_id, reason) values
  ('00000000-0000-0000-0000-0000000000a1', 'run', '20000000-0000-0000-0000-000000000001', 'spam'),
  ('00000000-0000-0000-0000-0000000000a2', 'run', '20000000-0000-0000-0000-000000000001', 'spam');
select is((select hidden from public.runs where id = '20000000-0000-0000-0000-000000000001'), false, 'two reports do not hide');
insert into public.reports (reporter_id, target_type, target_id, reason) values ('00000000-0000-0000-0000-0000000000a3', 'run', '20000000-0000-0000-0000-000000000001', 'spam');
select is((select hidden from public.runs where id = '20000000-0000-0000-0000-000000000001'), true, 'three distinct reporters hide the run');
insert into public.reports (reporter_id, target_type, target_id, reason, safety_escalation) values ('00000000-0000-0000-0000-0000000000a1', 'run', '20000000-0000-0000-0000-000000000002', 'unsafe', true);
select is((select hidden from public.runs where id = '20000000-0000-0000-0000-000000000002'), true, 'safety escalation hides immediately');
select is((select safety_escalation from public.moderation_queue limit 1), true, 'escalations sort first in the moderation queue');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a3', true);
select is((select count(*)::int from public.runs), 0, 'hidden runs disappear for others');
select throws_ok($$select * from public.moderation_queue$$, '42501', null, 'moderation queue is not readable by clients');
reset role;

-- stale games are voided
insert into public.games (id, lane, tier, preset_id, mode, status, state, created_by, updated_at)
  values ('30000000-0000-0000-0000-0000000000f1', 'casual', 1, '7-1s-w1', 'live', 'disputed', '{"status":"disputed"}', '00000000-0000-0000-0000-0000000000a1', now() - interval '3 days');
select is(public.expire_stale_games(24), 1, 'stale disputed game expired');
select is((select status from public.games where id = '30000000-0000-0000-0000-0000000000f1'), 'voided', 'and voided');

select * from finish();
rollback;
