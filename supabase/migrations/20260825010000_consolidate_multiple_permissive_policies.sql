-- Consolidate pairs of permissive RLS policies (same table/command/role) into a single
-- policy per pair, OR-ing their conditions together. Postgres already combines multiple
-- permissive policies for the same command with OR, so this is behavior-preserving --
-- it just avoids evaluating two separate policy expressions per row on every query.
-- Addresses the `multiple_permissive_policies` performance advisor warnings.

-- board_memberships: SELECT
drop policy "memberships_select_admin" on public.board_memberships;
drop policy "memberships_select_own" on public.board_memberships;
create policy "memberships_select_admin_or_own" on public.board_memberships
  for select to authenticated
  using (is_admin() or (user_id = (select auth.uid())));

-- bookings: SELECT
drop policy "bookings_select_admin" on public.bookings;
drop policy "bookings_select_member" on public.bookings;
create policy "bookings_select_admin_or_member" on public.bookings
  for select to authenticated
  using (is_admin() or is_body_member(body_id));

-- cancellation_requests: INSERT
drop policy "cancel_requests_insert_admin" on public.cancellation_requests;
drop policy "cancel_requests_insert_leadership" on public.cancellation_requests;
create policy "cancel_requests_insert_admin_or_leadership" on public.cancellation_requests
  for insert to authenticated
  with check (
    is_admin()
    or exists (
      select 1 from bookings
      where bookings.id = cancellation_requests.booking_id
        and is_body_leadership(bookings.body_id)
    )
  );

-- cancellation_requests: SELECT
drop policy "cancel_requests_select_admin" on public.cancellation_requests;
drop policy "cancel_requests_select_member" on public.cancellation_requests;
create policy "cancel_requests_select_admin_or_member" on public.cancellation_requests
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from bookings
      where bookings.id = cancellation_requests.booking_id
        and is_body_member(bookings.body_id)
    )
  );

-- one_time_room_bookings: SELECT
drop policy "one_time_select_admin" on public.one_time_room_bookings;
drop policy "one_time_select_member" on public.one_time_room_bookings;
create policy "one_time_select_admin_or_member" on public.one_time_room_bookings
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from bookings
      where bookings.id = one_time_room_bookings.booking_id
        and is_body_member(bookings.body_id)
    )
  );

-- room_request_details: INSERT
drop policy "request_details_insert_admin" on public.room_request_details;
drop policy "request_details_insert_leadership" on public.room_request_details;
create policy "request_details_insert_admin_or_leadership" on public.room_request_details
  for insert to authenticated
  with check (
    is_admin()
    or exists (
      select 1 from room_requests
      where room_requests.id = room_request_details.request_id
        and is_body_leadership(room_requests.body_id)
    )
  );

-- room_request_details: SELECT
drop policy "request_details_select_admin" on public.room_request_details;
drop policy "request_details_select_member" on public.room_request_details;
create policy "request_details_select_admin_or_member" on public.room_request_details
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from room_requests
      where room_requests.id = room_request_details.request_id
        and is_body_member(room_requests.body_id)
    )
  );

-- room_requests: INSERT
drop policy "requests_insert_admin" on public.room_requests;
drop policy "requests_insert_leadership" on public.room_requests;
create policy "requests_insert_admin_or_leadership" on public.room_requests
  for insert to authenticated
  with check (is_admin() or is_body_leadership(body_id));

-- room_requests: SELECT
drop policy "requests_select_admin" on public.room_requests;
drop policy "requests_select_member" on public.room_requests;
create policy "requests_select_admin_or_member" on public.room_requests
  for select to authenticated
  using (is_admin() or is_body_member(body_id));

-- slack_connections: SELECT (role: public, matches original which also targeted public)
drop policy "slack_connections_select_admin" on public.slack_connections;
drop policy "slack_connections_select_own" on public.slack_connections;
create policy "slack_connections_select_admin_or_own" on public.slack_connections
  for select
  using (is_admin() or (chambers_user_id = (select auth.uid())));

-- tabling_bookings: SELECT
drop policy "tabling_select_admin" on public.tabling_bookings;
drop policy "tabling_select_member" on public.tabling_bookings;
create policy "tabling_select_admin_or_member" on public.tabling_bookings
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from bookings
      where bookings.id = tabling_bookings.booking_id
        and is_body_member(bookings.body_id)
    )
  );

-- tabling_request_sessions: INSERT
drop policy "tabling_req_sessions_insert_admin" on public.tabling_request_sessions;
drop policy "tabling_req_sessions_insert_leadership" on public.tabling_request_sessions;
create policy "tabling_req_sessions_insert_admin_or_leadership" on public.tabling_request_sessions
  for insert to authenticated
  with check (
    is_admin()
    or exists (
      select 1 from room_requests
      where room_requests.id = tabling_request_sessions.request_id
        and is_body_leadership(room_requests.body_id)
    )
  );

-- tabling_request_sessions: SELECT
drop policy "tabling_req_sessions_select_admin" on public.tabling_request_sessions;
drop policy "tabling_req_sessions_select_member" on public.tabling_request_sessions;
create policy "tabling_req_sessions_select_admin_or_member" on public.tabling_request_sessions
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from room_requests
      where room_requests.id = tabling_request_sessions.request_id
        and is_body_member(room_requests.body_id)
    )
  );

-- tabling_sessions: SELECT
drop policy "tabling_sessions_select_admin" on public.tabling_sessions;
drop policy "tabling_sessions_select_member" on public.tabling_sessions;
create policy "tabling_sessions_select_admin_or_member" on public.tabling_sessions
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from tabling_bookings
      join bookings on bookings.id = tabling_bookings.booking_id
      where tabling_bookings.id = tabling_sessions.tabling_booking_id
        and is_body_member(bookings.body_id)
    )
  );

-- users: SELECT
drop policy "users_select_admin" on public.users;
drop policy "users_select_own" on public.users;
create policy "users_select_admin_or_own" on public.users
  for select to authenticated
  using (is_admin() or (id = (select auth.uid())));

-- weekly_room_bookings: SELECT
drop policy "weekly_select_admin" on public.weekly_room_bookings;
drop policy "weekly_select_member" on public.weekly_room_bookings;
create policy "weekly_select_admin_or_member" on public.weekly_room_bookings
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from bookings
      where bookings.id = weekly_room_bookings.booking_id
        and is_body_member(bookings.body_id)
    )
  );

-- weekly_room_occurrences: SELECT
drop policy "occurrences_select_admin" on public.weekly_room_occurrences;
drop policy "occurrences_select_member" on public.weekly_room_occurrences;
create policy "occurrences_select_admin_or_member" on public.weekly_room_occurrences
  for select to authenticated
  using (
    is_admin()
    or exists (
      select 1 from weekly_room_bookings
      join bookings on bookings.id = weekly_room_bookings.booking_id
      where weekly_room_bookings.id = weekly_room_occurrences.weekly_booking_id
        and is_body_member(bookings.body_id)
    )
  );
