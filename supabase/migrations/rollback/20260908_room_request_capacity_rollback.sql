-- Rollback for 20260908010000_room_request_capacity.sql.
--
-- Drops the column and its constraint. Any capacities that had been submitted
-- are lost, and admins go back to asking the requester how many people are
-- coming.

alter table public.room_requests
  drop constraint if exists room_requests_capacity_check;

alter table public.room_requests
  drop column if exists capacity;
