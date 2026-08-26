-- Multi-body bookings (issue #19) -- part 2 of 2: RLS helpers and policies.
--
-- Every existing policy resolves visibility through a single body id, via is_body_member(body_id)
-- / is_body_leadership(body_id). Divisional and multi bookings would therefore be invisible to
-- exactly the people the feature exists for. This file generalizes those predicates.
--
-- WHY SECURITY DEFINER IS SAFE HERE (this is the load-bearing assumption -- verified before
-- writing this migration, re-verify if the project's ownership model ever changes):
--   * Postgres applies RLS to tables referenced inside a policy expression -- that is what produces
--     "infinite recursion detected in policy for relation ...".
--   * Postgres does NOT apply RLS when the current role owns the table and the table is not marked
--     FORCE ROW LEVEL SECURITY.
--   * Every public table here is owned by `postgres`, and none has FORCE ROW LEVEL SECURITY
--     (checked: 0 rows with relforcerowsecurity).
-- Therefore a SECURITY DEFINER helper owned by postgres reads these tables with RLS off and can
-- never re-enter a policy. auth.uid() / auth.jwt() still work inside them -- they read the
-- request.jwt.claims GUC, which is session state, not role state.
--
-- Corollary, and the trap this file is written to avoid: if the `bookings` policy used an inline
-- EXISTS against booking_bodies AND the booking_bodies policy used an inline EXISTS against
-- bookings, that is genuine mutual recursion -- and it fails at query time, not at migration time.
-- A SECURITY DEFINER function on either side breaks the cycle; both sides use one here so neither
-- is load-bearing on its own.
--
-- Second corollary: SECURITY DEFINER functions are never inlined by the planner. So on `bookings`
-- and `room_requests`, where the row's own columns are in scope, the predicate is expressed over
-- those columns plus once-per-query array lookups, rather than a per-row function call. The
-- (select ...) wrapper makes them InitPlans, continuing the idiom from
-- 20260825000000_rls_auth_initplan_fix.sql.

-- ---------------------------------------------------------------------------
-- 0. Pin search_path on the existing helpers
-- ---------------------------------------------------------------------------
-- These are SECURITY DEFINER with a mutable search_path, which is a live Supabase security lint
-- (function_search_path_mutable) and a real privilege-escalation surface. They already reference
-- only public tables and schema-qualified auth.*, so this is a no-op behaviorally.

alter function public.is_admin()               set search_path = public, pg_temp;
alter function public.is_body_member(uuid)     set search_path = public, pg_temp;
alter function public.is_body_leadership(uuid) set search_path = public, pg_temp;

-- ---------------------------------------------------------------------------
-- 1. Identity helpers -- the caller's memberships as arrays
-- ---------------------------------------------------------------------------
-- Used as `body_id = any ((select public.my_body_ids())::uuid[])` these evaluate once per query as an
-- InitPlan, replacing N per-row is_body_member() calls.

create or replace function public.my_body_ids()
returns uuid[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(m.body_id), '{}'::uuid[])
  from public.board_memberships m
  where m.user_id = auth.uid();
$$;

create or replace function public.my_leadership_body_ids()
returns uuid[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(m.body_id), '{}'::uuid[])
  from public.board_memberships m
  where m.user_id = auth.uid() and m.role = 'Leadership';
$$;

create or replace function public.my_divisions()
returns text[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct b.division), '{}'::text[])
  from public.board_memberships m
  join public.bodies b on b.id = m.body_id
  where m.user_id = auth.uid();
$$;

create or replace function public.my_leadership_divisions()
returns text[]
language sql stable security definer set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct b.division), '{}'::text[])
  from public.board_memberships m
  join public.bodies b on b.id = m.body_id
  where m.user_id = auth.uid() and m.role = 'Leadership';
$$;

-- ---------------------------------------------------------------------------
-- 2. Per-booking predicates -- for child tables, where the parent row is not in scope
-- ---------------------------------------------------------------------------

create or replace function public.booking_body_is_member(p_booking_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.booking_bodies bb
    where bb.booking_id = p_booking_id
      and bb.body_id = any (public.my_body_ids()::uuid[])
  );
$$;

create or replace function public.booking_body_is_leadership(p_booking_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.booking_bodies bb
    where bb.booking_id = p_booking_id
      and bb.body_id = any (public.my_leadership_body_ids()::uuid[])
  );
$$;

-- The single definition of "can this user see this booking". Every child-table policy delegates
-- here so the rule cannot drift between tables.
create or replace function public.booking_is_visible(p_booking_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and ( b.body_id = any (public.my_body_ids()::uuid[])
         or (b.scope = 'divisional' and b.division = any (public.my_divisions()::text[]))
         or (b.scope = 'multi' and public.booking_body_is_member(b.id)) )
  );
$$;

create or replace function public.booking_is_manageable(p_booking_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.bookings b
    where b.id = p_booking_id
      and ( b.body_id = any (public.my_leadership_body_ids()::uuid[])
         or (b.scope = 'divisional' and b.division = any (public.my_leadership_divisions()::text[]))
         or (b.scope = 'multi' and public.booking_body_is_leadership(b.id)) )
  );
$$;

-- One-level-deeper wrappers, so the grandchild policies stay a single call.
create or replace function public.weekly_booking_is_visible(p_weekly_booking_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.booking_is_visible(
    (select w.booking_id from public.weekly_room_bookings w where w.id = p_weekly_booking_id));
$$;

create or replace function public.tabling_booking_is_visible(p_tabling_booking_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select public.booking_is_visible(
    (select t.booking_id from public.tabling_bookings t where t.id = p_tabling_booking_id));
$$;

-- ---------------------------------------------------------------------------
-- 3. Per-request predicates
-- ---------------------------------------------------------------------------

create or replace function public.request_body_is_member(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.room_request_bodies rb
    where rb.request_id = p_request_id
      and rb.body_id = any (public.my_body_ids()::uuid[])
  );
$$;

create or replace function public.request_is_visible(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.room_requests r
    where r.id = p_request_id
      and ( r.body_id = any (public.my_body_ids()::uuid[])
         or (r.scope = 'divisional' and r.division = any (public.my_divisions()::text[]))
         or (r.scope = 'multi' and public.request_body_is_member(r.id)) )
  );
$$;

-- Deliberately the ORIGINATING body's leadership, not a general "manageable": only the body that
-- opened the request may attach detail rows to it. Otherwise leadership of any body that merely
-- appears on a multi request could mutate it.
create or replace function public.request_owner_is_leadership(p_request_id uuid)
returns boolean
language sql stable security definer set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.room_requests r
    where r.id = p_request_id and public.is_body_leadership(r.body_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- 4. Policy rewrites
-- ---------------------------------------------------------------------------
-- Each stays a SINGLE policy per table/command/role, preserving the intent of
-- 20260825010000_consolidate_multiple_permissive_policies.sql.
--
-- Behavioral note on the child tables: today their policies do an inline
-- `exists (select 1 from bookings ...)`, and that subquery has bookings' own RLS applied to it --
-- so each child policy is implicitly "AND the parent booking is visible". Delegating to
-- booking_is_visible() removes that implicit coupling. The net result is identical because
-- booking_is_visible() encodes the same rule; the safety now comes from there being exactly one
-- definition, used by every table.

-- bookings: SELECT. Cheap column tests gate the expensive branch; the array lookups are InitPlans.
drop policy "bookings_select_admin_or_member" on public.bookings;
create policy "bookings_select_admin_or_member" on public.bookings
  for select to authenticated
  using (
    is_admin()
    or body_id = any ((select public.my_body_ids())::uuid[])
    or (scope = 'divisional' and division = any ((select public.my_divisions())::text[]))
    or (scope = 'multi' and public.booking_body_is_member(id))
  );

-- bookings INSERT/UPDATE/DELETE (admin-only) and anon_select_bookings_count are unchanged.

-- one_time_room_bookings / weekly_room_bookings / tabling_bookings: SELECT
drop policy "one_time_select_admin_or_member" on public.one_time_room_bookings;
create policy "one_time_select_admin_or_member" on public.one_time_room_bookings
  for select to authenticated
  using (is_admin() or public.booking_is_visible(booking_id));

drop policy "weekly_select_admin_or_member" on public.weekly_room_bookings;
create policy "weekly_select_admin_or_member" on public.weekly_room_bookings
  for select to authenticated
  using (is_admin() or public.booking_is_visible(booking_id));

drop policy "tabling_select_admin_or_member" on public.tabling_bookings;
create policy "tabling_select_admin_or_member" on public.tabling_bookings
  for select to authenticated
  using (is_admin() or public.booking_is_visible(booking_id));

-- weekly_room_occurrences / tabling_sessions: SELECT (one level deeper)
drop policy "occurrences_select_admin_or_member" on public.weekly_room_occurrences;
create policy "occurrences_select_admin_or_member" on public.weekly_room_occurrences
  for select to authenticated
  using (is_admin() or public.weekly_booking_is_visible(weekly_booking_id));

drop policy "tabling_sessions_select_admin_or_member" on public.tabling_sessions;
create policy "tabling_sessions_select_admin_or_member" on public.tabling_sessions
  for select to authenticated
  using (is_admin() or public.tabling_booking_is_visible(tabling_booking_id));

-- cancellation_requests
drop policy "cancel_requests_select_admin_or_member" on public.cancellation_requests;
create policy "cancel_requests_select_admin_or_member" on public.cancellation_requests
  for select to authenticated
  using (is_admin() or public.booking_is_visible(booking_id));

drop policy "cancel_requests_insert_admin_or_leadership" on public.cancellation_requests;
create policy "cancel_requests_insert_admin_or_leadership" on public.cancellation_requests
  for insert to authenticated
  with check (is_admin() or public.booking_is_manageable(booking_id));

-- cancel_requests_update_admin is unchanged.

-- room_requests: SELECT
drop policy "requests_select_admin_or_member" on public.room_requests;
create policy "requests_select_admin_or_member" on public.room_requests
  for select to authenticated
  using (
    is_admin()
    or body_id = any ((select public.my_body_ids())::uuid[])
    or (scope = 'divisional' and division = any ((select public.my_divisions())::text[]))
    or (scope = 'multi' and public.request_body_is_member(id))
  );

-- room_requests: INSERT -- the spec's leadership rule, in SQL.
--   * leadership of the originating body is always required
--   * 'multi' adds no restriction on the other bodies (any leadership may request any combination)
--   * 'divisional' additionally requires leadership somewhere in that division
-- The "multi has >= 2 bodies" rule cannot live here: the child rows do not exist yet at insert
-- time. It is enforced in validateScopeSelection().
drop policy "requests_insert_admin_or_leadership" on public.room_requests;
create policy "requests_insert_admin_or_leadership" on public.room_requests
  for insert to authenticated
  with check (
    is_admin()
    or ( is_body_leadership(body_id)
         and ( scope <> 'divisional'
               or division = any ((select public.my_leadership_divisions())::text[]) ) )
  );

-- requests_update_admin / requests_delete_admin are unchanged.

-- room_request_details / tabling_request_sessions
drop policy "request_details_select_admin_or_member" on public.room_request_details;
create policy "request_details_select_admin_or_member" on public.room_request_details
  for select to authenticated
  using (is_admin() or public.request_is_visible(request_id));

drop policy "request_details_insert_admin_or_leadership" on public.room_request_details;
create policy "request_details_insert_admin_or_leadership" on public.room_request_details
  for insert to authenticated
  with check (is_admin() or public.request_owner_is_leadership(request_id));

drop policy "tabling_req_sessions_select_admin_or_member" on public.tabling_request_sessions;
create policy "tabling_req_sessions_select_admin_or_member" on public.tabling_request_sessions
  for select to authenticated
  using (is_admin() or public.request_is_visible(request_id));

drop policy "tabling_req_sessions_insert_admin_or_leadership" on public.tabling_request_sessions;
create policy "tabling_req_sessions_insert_admin_or_leadership" on public.tabling_request_sessions
  for insert to authenticated
  with check (is_admin() or public.request_owner_is_leadership(request_id));

-- ---------------------------------------------------------------------------
-- 5. Policies for the new join tables
-- ---------------------------------------------------------------------------
-- App writes go through the service-role client and bypass RLS regardless; these exist so the
-- tables are not open holes and so the rls_disabled_in_public advisor stays quiet. No anon policy,
-- so anon is default-deny (unlike bookings, which has a pre-existing anon count policy).

create policy "booking_bodies_select_admin_or_member" on public.booking_bodies
  for select to authenticated
  using (is_admin() or public.booking_is_visible(booking_id));

create policy "booking_bodies_insert_admin" on public.booking_bodies
  for insert to authenticated
  with check (is_admin());

create policy "booking_bodies_delete_admin" on public.booking_bodies
  for delete to authenticated
  using (is_admin());

create policy "room_request_bodies_select_admin_or_member" on public.room_request_bodies
  for select to authenticated
  using (is_admin() or public.request_is_visible(request_id));

create policy "room_request_bodies_insert_admin_or_leadership" on public.room_request_bodies
  for insert to authenticated
  with check (is_admin() or public.request_owner_is_leadership(request_id));

create policy "room_request_bodies_delete_admin" on public.room_request_bodies
  for delete to authenticated
  using (is_admin());

-- bodies and board_memberships policies are unchanged.
