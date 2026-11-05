begin;
select plan(29);

-- fixtures (as superuser)
insert into auth.users (id) values
  ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000a2'),
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000c1');
insert into public.profiles (id, display_name, birth_year, is_minor) values
  ('00000000-0000-0000-0000-0000000000a1', 'AdultOne', 1990, false),
  ('00000000-0000-0000-0000-0000000000a2', 'AdultTwo', 1991, false),
  ('00000000-0000-0000-0000-0000000000b1', 'MinorOne', 2010, true);
insert into public.courts (id, osm_type, osm_id, lat, lng, court_type, access) values
  ('10000000-0000-0000-0000-000000000001', 'way', 1, 34.0522, -118.2437, 'full', null),
  ('10000000-0000-0000-0000-000000000002', 'way', 2, 34.1000, -118.3000, 'half', 'private');
insert into public.check_ins (user_id, court_id, distance_m, expires_at) values
  ('00000000-0000-0000-0000-0000000000a2', '10000000-0000-0000-0000-000000000001', 5, now() + interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 5, now() + interval '30 minutes'),
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 5, now() - interval '1 minute'); -- expired
insert into public.runs (id, court_id, host_id, starts_at, tier, lane, preset_id) values
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000b1', now(), 2, 'casual', '11-1s-w1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-0000000000a2', now(), 2, 'casual', '11-1s-w1');

-- ---- as adult one
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);

select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000b1'), 0, 'adult cannot see a minor profile');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'), 1, 'adult can see another adult');
select is((select headcount from public.court_headcounts() where court_id = '10000000-0000-0000-0000-000000000001'), 1,
  'adult headcount excludes the minor and the expired check-in');
select is((select count(*)::int from public.runs), 1, 'adult sees only the adult-hosted run');
select is((select count(*)::int from public.courts), 1, 'private-access court is hidden');
select is((select count(*)::int from public.check_ins where user_id <> auth.uid()), 0, 'cannot read other users check-ins directly');

-- locked columns / server-only tables
select throws_ok($$update public.profiles set gold_earned = 999 where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'cannot self-award gold');
select throws_ok($$update public.profiles set is_minor = false where id = '00000000-0000-0000-0000-0000000000a1'$$, '42501', null, 'cannot edit minor flag');
select throws_ok($$insert into public.ratings (user_id, tier, kind) values ('00000000-0000-0000-0000-0000000000a1', 1, 'ranked')$$, '42501', null, 'cannot write ratings');
select throws_ok($$insert into public.courts (osm_type, osm_id, lat, lng) values ('node', 99, 1, 1)$$, '42501', null, 'cannot write courts');
select lives_ok($$update public.profiles set display_name = 'Renamed' where id = '00000000-0000-0000-0000-0000000000a1'$$, 'can rename self');

-- check-in
select throws_ok($$select public.check_in('10000000-0000-0000-0000-000000000001', 34.0600, -118.2437, 5)$$, 'P0001', 'too_far', 'check-in ~870 m away is refused');
select throws_ok($$select public.check_in('10000000-0000-0000-0000-000000000002', 34.1000, -118.3000, 5)$$, 'P0001', 'court_not_found', 'cannot check in at a hidden court');
select lives_ok($$select public.check_in('10000000-0000-0000-0000-000000000001', 34.0523, -118.2437, 5)$$, 'check-in ~11 m away succeeds');
select is((select count(*)::int from public.check_ins where expires_at > now()), 1, 'own live check-in is readable');
select is((select headcount from public.court_headcounts() where court_id = '10000000-0000-0000-0000-000000000001'), 2, 'headcount now 2 adults');
select lives_ok($$select public.check_in('10000000-0000-0000-0000-000000000001', 34.0523, -118.2437, 5)$$, 'second check-in replaces first');
select is((select headcount from public.court_headcounts() where court_id = '10000000-0000-0000-0000-000000000001'), 2, 'still one live check-in per user');

-- block hides the other adult
insert into public.blocks (blocker_id, blocked_id) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000a2');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'), 0, 'blocked user disappears');

-- reports
select lives_ok($$insert into public.reports (reporter_id, target_type, target_id, reason, safety_escalation) values ('00000000-0000-0000-0000-0000000000a1', 'user', 'x', 'unsafe', true)$$, 'can report');
select throws_ok($$insert into public.reports (reporter_id, target_type, target_id, reason) values ('00000000-0000-0000-0000-0000000000a2', 'user', 'x', 'spam')$$, '42501', null, 'cannot report as someone else');

-- ---- as the minor
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000a2'), 1, 'minor can see adults');

-- ---- age screen and deletion
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000c1', true);
select throws_ok($$select public.create_profile('Kiddo', (current_date - interval '8 years')::date)$$, 'P0001', 'age_blocked', 'under 13 refused');
select lives_ok($$select public.create_profile('Teen', (current_date - interval '16 years')::date)$$, '16 year old gets a minor profile');
select is((select is_minor from public.my_profile()), true, 'minor flag set');
select public.delete_my_account();
reset role;
select is((select display_name from public.profiles where id = '00000000-0000-0000-0000-0000000000c1'), 'Teen', 'deletion keeps the display name');
select is((select count(*)::int from public.profiles where id = '00000000-0000-0000-0000-0000000000c1' and birth_year is null and avatar is null and deleted_at is not null and is_minor), 1, 'but scrubs birth year and avatar, marks it deleted, and still counts as a minor');
select is((select count(*)::int from auth.users where id = '00000000-0000-0000-0000-0000000000c1'), 0, 'and the login is gone');
select is((select count(*)::int from public.check_ins where user_id = '00000000-0000-0000-0000-0000000000c1'), 0, 'and check-ins are gone');

select * from finish();
rollback;
