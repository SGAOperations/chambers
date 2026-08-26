-- ROLLBACK for the multi-body bookings migrations (issue #19).
--
-- NOT a migration -- this file lives outside the numbered sequence deliberately so the Supabase
-- CLI never applies it. Run it by hand only if the multi-body RLS rewrite has to be undone.
--
-- The policy definitions below were captured verbatim from pg_policies on the live project
-- immediately before 20260826001000_multi_body_bookings_rls.sql was applied, so this restores the
-- exact prior behavior rather than a reconstruction from memory.
--
-- ORDER MATTERS: restore the policies first, then drop the helper functions they stop referencing,
-- and only then drop the columns/tables. Dropping a function that a live policy still calls fails.

begin;

-- ---------------------------------------------------------------------------
-- 1. Restore the original policies
-- ---------------------------------------------------------------------------

drop policy if exists "bookings_select_admin_or_member" on public.bookings;
create policy bookings_select_admin_or_member on public.bookings
  for select to authenticated using ((is_admin() OR is_body_member(body_id)));

drop policy if exists "one_time_select_admin_or_member" on public.one_time_room_bookings;
create policy one_time_select_admin_or_member on public.one_time_room_bookings
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM bookings
  WHERE ((bookings.id = one_time_room_bookings.booking_id) AND is_body_member(bookings.body_id))))));

drop policy if exists "weekly_select_admin_or_member" on public.weekly_room_bookings;
create policy weekly_select_admin_or_member on public.weekly_room_bookings
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM bookings
  WHERE ((bookings.id = weekly_room_bookings.booking_id) AND is_body_member(bookings.body_id))))));

drop policy if exists "tabling_select_admin_or_member" on public.tabling_bookings;
create policy tabling_select_admin_or_member on public.tabling_bookings
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM bookings
  WHERE ((bookings.id = tabling_bookings.booking_id) AND is_body_member(bookings.body_id))))));

drop policy if exists "occurrences_select_admin_or_member" on public.weekly_room_occurrences;
create policy occurrences_select_admin_or_member on public.weekly_room_occurrences
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM (weekly_room_bookings
     JOIN bookings ON ((bookings.id = weekly_room_bookings.booking_id)))
  WHERE ((weekly_room_bookings.id = weekly_room_occurrences.weekly_booking_id) AND is_body_member(bookings.body_id))))));

drop policy if exists "tabling_sessions_select_admin_or_member" on public.tabling_sessions;
create policy tabling_sessions_select_admin_or_member on public.tabling_sessions
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM (tabling_bookings
     JOIN bookings ON ((bookings.id = tabling_bookings.booking_id)))
  WHERE ((tabling_bookings.id = tabling_sessions.tabling_booking_id) AND is_body_member(bookings.body_id))))));

drop policy if exists "cancel_requests_select_admin_or_member" on public.cancellation_requests;
create policy cancel_requests_select_admin_or_member on public.cancellation_requests
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM bookings
  WHERE ((bookings.id = cancellation_requests.booking_id) AND is_body_member(bookings.body_id))))));

drop policy if exists "cancel_requests_insert_admin_or_leadership" on public.cancellation_requests;
create policy cancel_requests_insert_admin_or_leadership on public.cancellation_requests
  for insert to authenticated with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM bookings
  WHERE ((bookings.id = cancellation_requests.booking_id) AND is_body_leadership(bookings.body_id))))));

drop policy if exists "requests_select_admin_or_member" on public.room_requests;
create policy requests_select_admin_or_member on public.room_requests
  for select to authenticated using ((is_admin() OR is_body_member(body_id)));

drop policy if exists "requests_insert_admin_or_leadership" on public.room_requests;
create policy requests_insert_admin_or_leadership on public.room_requests
  for insert to authenticated with check ((is_admin() OR is_body_leadership(body_id)));

drop policy if exists "request_details_select_admin_or_member" on public.room_request_details;
create policy request_details_select_admin_or_member on public.room_request_details
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM room_requests
  WHERE ((room_requests.id = room_request_details.request_id) AND is_body_member(room_requests.body_id))))));

drop policy if exists "request_details_insert_admin_or_leadership" on public.room_request_details;
create policy request_details_insert_admin_or_leadership on public.room_request_details
  for insert to authenticated with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM room_requests
  WHERE ((room_requests.id = room_request_details.request_id) AND is_body_leadership(room_requests.body_id))))));

drop policy if exists "tabling_req_sessions_select_admin_or_member" on public.tabling_request_sessions;
create policy tabling_req_sessions_select_admin_or_member on public.tabling_request_sessions
  for select to authenticated using ((is_admin() OR (EXISTS ( SELECT 1
   FROM room_requests
  WHERE ((room_requests.id = tabling_request_sessions.request_id) AND is_body_member(room_requests.body_id))))));

drop policy if exists "tabling_req_sessions_insert_admin_or_leadership" on public.tabling_request_sessions;
create policy tabling_req_sessions_insert_admin_or_leadership on public.tabling_request_sessions
  for insert to authenticated with check ((is_admin() OR (EXISTS ( SELECT 1
   FROM room_requests
  WHERE ((room_requests.id = tabling_request_sessions.request_id) AND is_body_leadership(room_requests.body_id))))));

-- ---------------------------------------------------------------------------
-- 2. Drop the helper functions added by the RLS migration
-- ---------------------------------------------------------------------------
-- The pinned search_path on is_admin / is_body_member / is_body_leadership is deliberately NOT
-- reverted: it is a security fix, independent of this feature, and reverting it would reintroduce
-- the function_search_path_mutable finding.

drop function if exists public.booking_is_visible(uuid);
drop function if exists public.booking_is_manageable(uuid);
drop function if exists public.booking_body_is_member(uuid);
drop function if exists public.booking_body_is_leadership(uuid);
drop function if exists public.weekly_booking_is_visible(uuid);
drop function if exists public.tabling_booking_is_visible(uuid);
drop function if exists public.request_is_visible(uuid);
drop function if exists public.request_body_is_member(uuid);
drop function if exists public.request_owner_is_leadership(uuid);
drop function if exists public.my_body_ids();
drop function if exists public.my_leadership_body_ids();
drop function if exists public.my_divisions();
drop function if exists public.my_leadership_divisions();

-- ---------------------------------------------------------------------------
-- 3. Drop the schema additions
-- ---------------------------------------------------------------------------
-- DESTRUCTIVE: this discards which bodies every multi-body booking was shared with. If any
-- non-single bookings exist, export them before running this section:
--   select b.id, b.scope, b.division, array_agg(bb.body_id) from bookings b
--   left join booking_bodies bb on bb.booking_id = b.id
--   where b.scope <> 'single' group by b.id;

drop table if exists public.booking_bodies;
drop table if exists public.room_request_bodies;

drop index if exists public.bookings_divisional_idx;
drop index if exists public.room_requests_divisional_idx;

alter table public.bookings
  drop constraint if exists bookings_scope_check,
  drop constraint if exists bookings_division_check,
  drop constraint if exists bookings_division_required_check,
  drop column if exists scope,
  drop column if exists division;

alter table public.room_requests
  drop constraint if exists room_requests_scope_check,
  drop constraint if exists room_requests_division_check,
  drop constraint if exists room_requests_division_required_check,
  drop column if exists scope,
  drop column if exists division;

-- body_id was NOT NULL-able before this feature only incidentally (it had no nulls). Restoring
-- nullability is optional; uncomment if you want the exact prior column definition back.
-- alter table public.bookings alter column body_id drop not null;
-- alter table public.room_requests alter column body_id drop not null;

commit;
