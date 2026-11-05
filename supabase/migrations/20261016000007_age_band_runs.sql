-- Runs are separated by age band: minors see and join only minor-hosted runs, adults only adult-hosted runs.
-- Before this, a minor could join an adult's run (the adult could not see them, and could not start a game with them).
create function public.same_age_band(p_user uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select p_user = auth.uid()
      or coalesce((select is_minor from public.profiles where id = p_user), true) = public.viewer_is_minor()
$$;
revoke execute on function public.same_age_band(uuid) from public, anon;
grant execute on function public.same_age_band(uuid) to authenticated;

create or replace function public.can_see_run(p_run uuid) returns boolean language sql stable security definer set search_path = public, extensions as $$
  select exists (
    select 1 from public.runs r
    where r.id = p_run
      and public.can_see_user(r.host_id)
      and public.same_age_band(r.host_id)
      and (not r.hidden or r.host_id = auth.uid())
      and (r.lane <> 'private' or r.host_id = auth.uid()
           or exists (select 1 from public.run_invites i where i.run_id = r.id and i.user_id = auth.uid())
           or exists (select 1 from public.run_members m where m.run_id = r.id and m.user_id = auth.uid()))
  )
$$;

drop policy runs_select on public.runs;
create policy runs_select on public.runs for select to authenticated using (
  public.can_see_user(host_id)
  and public.same_age_band(host_id)
  and (not hidden or host_id = auth.uid())
  and (lane <> 'private' or host_id = auth.uid() or public.is_invited_to(id) or public.is_run_member(id))
);
