-- Court sites (clustered OSM pitches) and a PostGIS "courts near me" query.
alter table public.courts add column member_count int not null default 1;
alter table public.courts add column member_osm_ids text[] not null default '{}';

-- Nearest public courts with live headcount. Headcount follows the same minors rule as court_headcounts().
create function public.courts_near(p_lat double precision, p_lng double precision, p_radius_m int default 15000, p_limit int default 50)
returns table (id uuid, name text, lat double precision, lng double precision, court_type text, type_source text,
               fit_confirmations int, member_count int, distance_m int, headcount int)
language sql stable security definer set search_path = public, extensions as $$
  with me as (select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g),
  near as (
    select c.*, st_distance(c.geog, me.g) as d from public.courts c, me
    where c.is_public and st_dwithin(c.geog, me.g, least(greatest(p_radius_m, 100), 50000))
    order by c.geog <-> me.g limit least(greatest(p_limit, 1), 100)
  )
  select n.id, n.name, n.lat, n.lng, n.court_type, n.type_source, n.fit_confirmations, n.member_count, n.d::int,
    coalesce((select h.headcount from public.court_headcounts() h where h.court_id = n.id), 0)
  from near n order by n.d
$$;
revoke execute on function public.courts_near(double precision, double precision, int, int) from public, anon;
grant execute on function public.courts_near(double precision, double precision, int, int) to authenticated;
