begin;
select * from no_plan();
\set a1 '00000000-0000-0000-0000-0000000000a1'
\set b1 '00000000-0000-0000-0000-0000000000b1'
\set b2 '00000000-0000-0000-0000-0000000000b2'
insert into auth.users (id) values (:'a1'), (:'b1'), (:'b2');
insert into public.profiles (id, display_name, birth_year, is_minor) values (:'a1', 'Adult', 1990, false), (:'b1', 'TeenOne', 2010, true), (:'b2', 'TeenTwo', 2010, true);
insert into public.courts (id, osm_type, osm_id, lat, lng, court_type) values ('10000000-0000-0000-0000-000000000001', 'way', 1, 34.05, -118.24, 'full');
insert into public.runs (id, court_id, host_id, starts_at, tier, lane, preset_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', :'a1', now(), 1, 'casual', '7-1s-w1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', :'b1', now(), 1, 'casual', '7-1s-w1');
set local role authenticated;
select set_config('request.jwt.claim.sub', :'b2', true);
select is((select array_agg(id::text) from public.runs), array['20000000-0000-0000-0000-000000000002'], 'a minor sees only minor-hosted runs');
select throws_ok($$insert into public.run_members (run_id, user_id) values ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b2')$$, '42501', null, 'a minor cannot join an adult run');
select lives_ok($$insert into public.run_members (run_id, user_id) values ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-0000000000b2')$$, 'a minor can join a minor run');
select set_config('request.jwt.claim.sub', :'a1', true);
select is((select array_agg(id::text) from public.runs), array['20000000-0000-0000-0000-000000000001'], 'an adult sees only adult-hosted runs');
select is((select count(*)::int from public.run_members), 0, 'and cannot see which minors joined anything');
select * from finish();
rollback;
