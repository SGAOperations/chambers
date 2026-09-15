-- Rollback for 20260915010000_weekly_occurrence_date_unique.sql.
--
-- Roll the application back first. The weekly PATCH handler's upsert names this
-- constraint as its conflict target, and every edit to a weekly booking fails
-- without it.

alter table public.weekly_room_occurrences
  drop constraint if exists weekly_room_occurrences_booking_date_key;
