-- Wrap direct auth.uid()/auth.jwt() calls in RLS policies as (select auth.uid())/(select auth.jwt())
-- so Postgres evaluates them once per query instead of once per row (auth_rls_initplan advisor).
-- No other policy logic (is_admin(), is_spaces_admin(), is_active, OR/AND structure) is changed.

-- audit_logs
alter policy "Admins can read audit logs" on public.audit_logs
  using ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true);

-- board_memberships
alter policy "memberships_select_own" on public.board_memberships
  using (user_id = (select auth.uid()));

-- event_tracking
alter policy "event_tracking_delete" on public.event_tracking
  using ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true);

alter policy "event_tracking_insert" on public.event_tracking
  with check (
    ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true)
    or ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'iems_role'::text) is not null)
  );

alter policy "event_tracking_select" on public.event_tracking
  using (
    ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true)
    or ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'iems_role'::text) is not null)
  );

alter policy "event_tracking_update" on public.event_tracking
  using (
    ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true)
    or ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'iems_role'::text) is not null)
  );

-- revision_requests
alter policy "Admins can update revision requests" on public.revision_requests
  using ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true);

alter policy "Users can insert their own revision requests" on public.revision_requests
  with check ((select auth.uid()) = requested_by);

alter policy "Users can view their own revision requests" on public.revision_requests
  using (
    ((select auth.uid()) = requested_by)
    or ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true)
  );

-- semesters
alter policy "Admins can create semesters" on public.semesters
  with check ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true);

alter policy "Admins can delete semesters" on public.semesters
  using ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true);

alter policy "Admins can update semesters" on public.semesters
  using ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true)
  with check ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true);

alter policy "Authenticated users can view semesters" on public.semesters
  using (
    (is_active = true)
    or ((((select auth.jwt()) -> 'app_metadata'::text) ->> 'is_admin'::text)::boolean = true)
  );

-- slack_connections
alter policy "slack_connections_select_own" on public.slack_connections
  using (chambers_user_id = (select auth.uid()));

-- space_bookings
alter policy "space_bookings: own insert" on public.space_bookings
  with check (creator_id = (select auth.uid()));

alter policy "space_bookings: own or admin delete" on public.space_bookings
  using ((creator_id = (select auth.uid())) or is_spaces_admin());

alter policy "space_bookings: own or admin update" on public.space_bookings
  using ((creator_id = (select auth.uid())) or is_spaces_admin());

-- space_weekly_limit_overrides
alter policy "space_weekly_limit_overrides: own or admin read" on public.space_weekly_limit_overrides
  using ((user_id = (select auth.uid())) or is_spaces_admin());

-- user_alerts
alter policy "users can read own alerts" on public.user_alerts
  using ((select auth.uid()) = user_id);

alter policy "users can update own alerts" on public.user_alerts
  using ((select auth.uid()) = user_id);

-- users
alter policy "users_select_own" on public.users
  using (id = (select auth.uid()));
