-- Rollback for 20260917004809_space_external_attendees.sql.
--
-- External attendees are dropped from every booking and series. They keep any
-- invite already sent, and are not told the booking has changed afterwards.

alter table public.space_bookings
  drop column if exists external_attendees;

alter table public.space_booking_series
  drop column if exists external_attendees;
