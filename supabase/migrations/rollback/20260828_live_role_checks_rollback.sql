-- Rollback for 20260828000000_live_role_checks.sql.
--
-- Restores the JWT-claim versions of is_admin() and the policies that inlined the
-- claim, and drops is_iems(). Note this reinstates the staleness the migration
-- removed: a revoked admin keeps admin rights until their access token expires.

create or replace function public.is_admin()
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  return coalesce(
    (auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean,
    false
  );
end;
$$;

drop policy if exists "Authenticated users can view semesters" on public.semesters;
create policy "Authenticated users can view semesters"
  on public.semesters for select to authenticated
  using (
    is_active = true
    or ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true)
  );

drop policy if exists "Admins can create semesters" on public.semesters;
create policy "Admins can create semesters"
  on public.semesters for insert to authenticated
  with check ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true);

drop policy if exists "Admins can update semesters" on public.semesters;
create policy "Admins can update semesters"
  on public.semesters for update to authenticated
  using ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true)
  with check ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true);

drop policy if exists "Admins can delete semesters" on public.semesters;
create policy "Admins can delete semesters"
  on public.semesters for delete to authenticated
  using ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true);

drop policy if exists event_tracking_select on public.event_tracking;
create policy event_tracking_select
  on public.event_tracking for select to public
  using (
    ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true)
    or (((select auth.jwt()) -> 'app_metadata' ->> 'iems_role') is not null)
  );

drop policy if exists event_tracking_insert on public.event_tracking;
create policy event_tracking_insert
  on public.event_tracking for insert to public
  with check (
    ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true)
    or (((select auth.jwt()) -> 'app_metadata' ->> 'iems_role') is not null)
  );

drop policy if exists event_tracking_update on public.event_tracking;
create policy event_tracking_update
  on public.event_tracking for update to public
  using (
    ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true)
    or (((select auth.jwt()) -> 'app_metadata' ->> 'iems_role') is not null)
  );

drop policy if exists event_tracking_delete on public.event_tracking;
create policy event_tracking_delete
  on public.event_tracking for delete to public
  using ((((select auth.jwt()) -> 'app_metadata' ->> 'is_admin'))::boolean = true);

drop function if exists public.is_iems();
