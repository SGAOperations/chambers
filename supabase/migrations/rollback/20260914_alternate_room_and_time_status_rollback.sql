-- Rollback for 20260914000000_alternate_room_and_time_status.sql.
--
-- Rows already using the new status have to go somewhere before the old
-- constraints go back, or adding them fails on those rows. They become
-- 'Alternate Room': the room is the part of the change a member acts on when
-- they walk to it, so it is the less misleading half to keep. That the time
-- also moved is lost.

update public.one_time_room_bookings set status = 'Alternate Room' where status = 'Alternate Room and Time';
update public.weekly_room_bookings set status = 'Alternate Room' where status = 'Alternate Room and Time';
update public.weekly_room_occurrences set status = 'Alternate Room' where status = 'Alternate Room and Time';
update public.tabling_sessions set status = 'Alternate Room' where status = 'Alternate Room and Time';

alter table public.one_time_room_bookings
  drop constraint if exists one_time_room_bookings_status_check;
alter table public.one_time_room_bookings
  add constraint one_time_room_bookings_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));

alter table public.weekly_room_bookings
  drop constraint if exists weekly_room_bookings_status_check;
alter table public.weekly_room_bookings
  add constraint weekly_room_bookings_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));

alter table public.weekly_room_occurrences
  drop constraint if exists weekly_room_occurrences_status_check;
alter table public.weekly_room_occurrences
  add constraint weekly_room_occurrences_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));

alter table public.tabling_sessions
  drop constraint if exists tabling_sessions_status_check;
alter table public.tabling_sessions
  add constraint tabling_sessions_status_check
  check (status = any (array['Reserved'::text, 'Alternate Room'::text, 'Alternate Time'::text, 'Waitlisted'::text, 'Unavailable'::text, 'Pending Cancellation'::text, 'Cancelled'::text, 'Virtual'::text, 'Missed'::text, 'Repurposed'::text, 'Tentative'::text]));
