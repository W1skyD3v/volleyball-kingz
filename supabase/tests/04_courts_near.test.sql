begin;
select * from no_plan();
insert into auth.users (id) values ('00000000-0000-0000-0000-0000000000a1'), ('00000000-0000-0000-0000-0000000000b1');
insert into public.profiles (id, display_name, birth_year, is_minor) values
  ('00000000-0000-0000-0000-0000000000a1', 'Adult', 1990, false), ('00000000-0000-0000-0000-0000000000b1', 'Minor', 2010, true);
insert into public.courts (id, osm_type, osm_id, name, lat, lng, court_type, access, member_count) values
  ('10000000-0000-0000-0000-000000000001', 'way', 1, 'Near', 34.0522, -118.2437, 'full', null, 2),
  ('10000000-0000-0000-0000-000000000002', 'way', 2, 'Mid', 34.0700, -118.2437, 'half', null, 1),
  ('10000000-0000-0000-0000-000000000003', 'way', 3, 'Far', 35.0000, -118.2437, 'half', null, 1),
  ('10000000-0000-0000-0000-000000000004', 'way', 4, 'Private', 34.0523, -118.2437, 'half', 'private', 1);
insert into public.check_ins (user_id, court_id, distance_m, expires_at) values
  ('00000000-0000-0000-0000-0000000000a1', '10000000-0000-0000-0000-000000000001', 1, now() + interval '1 hour'),
  ('00000000-0000-0000-0000-0000000000b1', '10000000-0000-0000-0000-000000000001', 1, now() + interval '1 hour');
set local role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000a1', true);
select is((select array_agg(name order by distance_m) from public.courts_near(34.0520, -118.2437, 15000, 10)), array['Near', 'Mid'], 'nearest public courts, sorted, radius respected, private hidden');
select is((select distance_m from public.courts_near(34.0520, -118.2437) where name = 'Near'), 22, 'distance in metres');
select is((select headcount from public.courts_near(34.0520, -118.2437) where name = 'Near'), 1, 'adult headcount excludes the minor');
select is((select member_count from public.courts_near(34.0520, -118.2437) where name = 'Near'), 2, 'site member count is exposed');
select is((select count(*)::int from public.courts_near(34.0520, -118.2437, 15000, 1)), 1, 'limit honoured');
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-0000000000b1', true);
select is((select headcount from public.courts_near(34.0520, -118.2437) where name = 'Near'), 2, 'minor viewer counts everyone');
select * from finish();
rollback;
