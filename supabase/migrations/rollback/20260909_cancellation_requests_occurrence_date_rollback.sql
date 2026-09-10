-- Rollback for 20260909010000_cancellation_requests_occurrence_date.sql.
--
-- Drops the column, which returns cancellation requests to being identified only
-- by an occurrence_id that does not survive an edit to a weekly booking. Any
-- dates recorded since the migration are lost, so requests created in between
-- become orphaned in exactly the way the migration was written to stop.

drop index if exists public.cancellation_requests_booking_date_idx;

alter table public.cancellation_requests
  drop column if exists occurrence_date;
