-- Rollback for 20260915000000_space_booking_series.sql.
--
-- Every week of every series survives as an ordinary one-off booking: only the
-- link back to its series is dropped, so nothing disappears from the calendar.
-- What is lost is the ability to edit or cancel those weeks together, and every
-- semester end date Management had entered.

drop index if exists public.space_bookings_series_id_idx;

alter table public.space_bookings
  drop column if exists series_id;

drop table if exists public.space_booking_series;

alter table public.semesters
  drop column if exists end_date;
