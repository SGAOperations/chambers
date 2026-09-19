-- Drop cancellation_requests.previous_statuses (issue #139).
--
-- 20260918145019_dismissable_cancellations.sql added this column so that
-- dismissing a request could put back the statuses the request had overwritten.
-- That was the wrong behaviour: dismissing a request should leave its booking
-- at Pending Cancellation, for an administrator to set to whatever fits in the
-- booking editor. Nothing reads or writes the column any more.
--
-- It never held data: the code that wrote it was not deployed, and every row
-- was NULL when this ran. The 'Dismissed' status from that migration stays.

alter table public.cancellation_requests
  drop column if exists previous_statuses;
