begin;
select * from no_plan();
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set a2 '00000000-0000-0000-0000-0000000000a2'
\set a3 '00000000-0000-0000-0000-0000000000a3'
\set a4 '00000000-0000-0000-0000-0000000000a4'
insert into auth.users (id) values (:'a1'), (:'a2'), (:'a3'), (:'a4');
insert into public.profiles (id, display_name, birth_year, is_minor) values (:'a1', 'One', 1990, false), (:'a2', 'Two', 1990, false), (:'a3', 'Three', 1990, false), (:'a4', 'Four', 1990, false);
insert into public.courts (id, osm_type, osm_id, lat, lng, court_type) values ('10000000-0000-0000-0000-000000000001', 'way', 1, 34.0522, -118.2437, 'full');
set local role authenticated;
select set_config('request.jwt.claim.sub', :'a1', true);
-- 2v2: A = One (captain) + Three, B = Two (captain) + Four
select public.create_game('10000000-0000-0000-0000-000000000001', 'casual', 2, '7-1s-w1', 'live', array[:'a1', :'a3']::uuid[], array[:'a2', :'a4']::uuid[]) \gset
create temp table gid as select (select id from public.games limit 1) as id;
grant all on gid to authenticated;
select set_config('request.jwt.claim.sub', :'a2', true); select public.accept_game((select id from gid));
select set_config('request.jwt.claim.sub', :'a3', true); select public.accept_game((select id from gid));
select set_config('request.jwt.claim.sub', :'a4', true); select public.accept_game((select id from gid));
select set_config('request.jwt.claim.sub', :'a1', true);

select is((select state->'shots' from public.games), '[]'::jsonb, 'a new game has no shots');
select throws_ok(format($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1,"scorer":"%s"}')$$, :'a2'), 'P0001', 'bad_scorer', 'cannot credit a player from the other side');
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1,"scorer":"not-a-uuid"}')$$, 'P0001', 'bad_scorer', 'garbage scorer is refused');
select throws_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1,"scorer":"00000000-0000-0000-0000-0000000000a9"}')$$, 'P0001', 'bad_scorer', 'a stranger cannot be credited');
select lives_ok(format($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1,"scorer":"%s"}')$$, :'a3'), 'a teammate can be credited');
select set_config('request.jwt.claim.sub', :'a2', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_point"}')$$, 'the other side confirms');
select is((select state->'shots'->0->>'scorer' from public.games), :'a3', 'the shot records who scored');
select is((select state->'shots'->0->>'side' from public.games), 'A', 'and which side');
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"claim_point","points":1}')$$, 'an unattributed claim by the other side');
select set_config('request.jwt.claim.sub', :'a1', true);
select lives_ok($$select public.game_apply_event((select id from gid), '{"type":"confirm_point"}')$$, 'confirmed');
select is((select jsonb_array_length(state->'shots') from public.games), 2, 'two shots recorded in order');
select is((select state->'shots'->1 from public.games), '{"side": "B", "points": 1}'::jsonb, 'an unattributed shot has no scorer (never guessed)');
select * from finish();
rollback;
