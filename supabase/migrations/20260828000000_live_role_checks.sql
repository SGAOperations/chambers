-- Role checks read the users table, not the JWT.
--
-- is_admin() answered from the access token:
--
--   return coalesce((auth.jwt() -> 'app_metadata' ->> 'is_admin')::boolean, false)
--
-- app_metadata is a copy stamped into the token when it was issued. Granting or
-- revoking a role writes the users row and the auth metadata; neither touches a
-- token already sitting in a browser. So a revoked admin kept passing every RLS
-- policy built on is_admin() until their token expired -- an hour by default, and
-- longer if the tab kept refreshing it. The same applied to the raw
-- app_metadata expressions inlined into the semesters and event_tracking
-- policies, and to iems_role.
--
-- The fix is to ask the table. my_body_ids() and my_divisions() already work this
-- way -- they resolve board_memberships through auth.uid() on every call, which
-- is why membership changes take effect immediately and role changes did not.
-- is_admin() was the outlier.
--
-- Verified before writing this: for every current user,
--   (admin_role is not null and is_active)
-- equals the token's is_admin claim, so this is the same answer from the
-- authoritative side rather than a new rule. What changes is when it updates.
--
-- SECURITY DEFINER matters twice over. It lets the function read users while the
-- caller cannot, and it stops the users_select_admin_or_own policy -- which calls
-- is_admin() -- from recursing into itself, because the definer's query is not
-- subject to RLS. This is exactly how my_body_ids() already reads
-- board_memberships from inside the bookings policies.
--
-- is_active is folded in deliberately: deactivating someone should revoke their
-- admin rights, not just hide the UI.

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.users
    where id = (select auth.uid())
      and admin_role is not null
      and is_active
  );
$$;

-- The IEMS counterpart. Previously only ever expressed inline, as
-- (auth.jwt() -> 'app_metadata' ->> 'iems_role') is not null.
create or replace function public.is_iems()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from public.users
    where id = (select auth.uid())
      and iems_role is not null
      and is_active
  );
$$;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_iems() to authenticated;

-- ---------------------------------------------------------------------------
-- Policies that inlined the JWT expression instead of calling is_admin()
-- ---------------------------------------------------------------------------
-- These were written before is_admin() existed and never migrated onto it, so
-- redefining the function alone would have left them reading the stale claim.
--
-- Each is recreated with its original role grant and its original
-- USING / WITH CHECK split. Both are easy to drop by accident: the semesters
-- policies are granted TO authenticated, and a create policy with no `to` clause
-- silently defaults to PUBLIC; and an INSERT policy's rule lives in WITH CHECK,
-- so reading only pg_policies.qual makes event_tracking_insert look like it has
-- no rule at all.

-- semesters (TO authenticated)
drop policy if exists "Authenticated users can view semesters" on public.semesters;
create policy "Authenticated users can view semesters"
  on public.semesters for select to authenticated
  using (is_active = true or public.is_admin());

drop policy if exists "Admins can create semesters" on public.semesters;
create policy "Admins can create semesters"
  on public.semesters for insert to authenticated
  with check (public.is_admin());

drop policy if exists "Admins can update semesters" on public.semesters;
create policy "Admins can update semesters"
  on public.semesters for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

drop policy if exists "Admins can delete semesters" on public.semesters;
create policy "Admins can delete semesters"
  on public.semesters for delete to authenticated
  using (public.is_admin());

-- event_tracking (TO public)
drop policy if exists event_tracking_select on public.event_tracking;
create policy event_tracking_select
  on public.event_tracking for select to public
  using (public.is_admin() or public.is_iems());

drop policy if exists event_tracking_insert on public.event_tracking;
create policy event_tracking_insert
  on public.event_tracking for insert to public
  with check (public.is_admin() or public.is_iems());

drop policy if exists event_tracking_update on public.event_tracking;
create policy event_tracking_update
  on public.event_tracking for update to public
  using (public.is_admin() or public.is_iems());

drop policy if exists event_tracking_delete on public.event_tracking;
create policy event_tracking_delete
  on public.event_tracking for delete to public
  using (public.is_admin());
