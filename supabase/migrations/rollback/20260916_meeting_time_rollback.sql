-- Rollback for 20260916005401_meeting_time.sql.
--
-- Drops all four columns. Any meeting times that had been set are lost, and
-- every booking falls back to reporting its start_time as the time it meets --
-- which is precisely what the app did before the migration, so nothing breaks.
-- The only visible effect is that a body which had set a meeting time distinct
-- from its reservation window goes back to being announced at the reservation
-- window.

alter table public.weekly_room_bookings
  drop column if exists meeting_time;

alter table public.weekly_room_occurrences
  drop column if exists meeting_time;

alter table public.one_time_room_bookings
  drop column if exists meeting_time;

alter table public.tabling_sessions
  drop column if exists meeting_time;
