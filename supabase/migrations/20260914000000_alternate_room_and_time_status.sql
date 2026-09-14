-- Add 'Alternate Room and Time' as a booking status (issue #105).
--
-- A booking could be marked as having an alternate room or an alternate time,
-- but not both, even though CSC hands out both at once. Picking either one
-- misdescribed the booking, and the Slack reminder (issue #104) needs to know
-- which of the two lines to call out.
--
-- The same vocabulary is enforced on all four tables that carry a booking
-- status, so all four constraints are replaced together. The list is otherwise
-- unchanged, and in the order the forms present it. This must be applied before
-- the release that offers the status, or saving a booking with it fails the
-- check.

alter table public.one_time_room_bookings
  drop constraint if exists one_time_room_bookings_status_check;
alter table public.one_time_room_bookings
  add constraint one_time_room_bookings_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Alternate Room and Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));

alter table public.weekly_room_bookings
  drop constraint if exists weekly_room_bookings_status_check;
alter table public.weekly_room_bookings
  add constraint weekly_room_bookings_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Alternate Room and Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));

alter table public.weekly_room_occurrences
  drop constraint if exists weekly_room_occurrences_status_check;
alter table public.weekly_room_occurrences
  add constraint weekly_room_occurrences_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Alternate Room and Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));

alter table public.tabling_sessions
  drop constraint if exists tabling_sessions_status_check;
alter table public.tabling_sessions
  add constraint tabling_sessions_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Alternate Room and Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));
