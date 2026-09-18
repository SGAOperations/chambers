-- Rollback for 20260918145019_dismissable_cancellations.sql.
--
-- Dismissed requests are folded into Done so the old constraint can be
-- restored. That loses the distinction between a request that cancelled its
-- booking and one that left it standing, but the bookings themselves are
-- unaffected: their statuses were already written when each request closed.

update public.cancellation_requests set status = 'Done' where status = 'Dismissed';

alter table public.cancellation_requests
  drop constraint if exists cancellation_requests_status_check;

alter table public.cancellation_requests
  add constraint cancellation_requests_status_check
  check (status = any (array['Pending'::text, 'Done'::text]));

alter table public.cancellation_requests
  drop column if exists previous_statuses;
