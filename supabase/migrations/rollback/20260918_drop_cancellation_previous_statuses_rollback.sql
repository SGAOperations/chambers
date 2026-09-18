-- Rollback for the drop_cancellation_previous_statuses migration.
--
-- Re-adds the column empty. It held no data when it was dropped, so nothing is
-- lost either way, and no code reads it.

alter table public.cancellation_requests
  add column if not exists previous_statuses jsonb;
