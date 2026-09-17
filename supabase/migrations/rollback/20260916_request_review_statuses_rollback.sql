-- Rollback for 20260916000000_request_review_statuses.sql.
--
-- Both open statuses fold back into 'Pending'. Whether a request had been passed
-- to CSC is lost. 'Awaiting CSC' notifications already sent stay in user_alerts;
-- the old notification bell renders them as a generic update.

alter table public.room_requests
  drop constraint if exists room_requests_status_check;
alter table public.revision_requests
  drop constraint if exists revision_requests_status_check;

update public.room_requests set status = 'Pending' where status in ('Ops Review', 'Awaiting CSC');
update public.revision_requests set status = 'Pending' where status in ('Ops Review', 'Awaiting CSC');

alter table public.room_requests
  alter column status set default 'Pending';
alter table public.revision_requests
  alter column status set default 'Pending';

alter table public.room_requests
  add constraint room_requests_status_check
  check (status = any (array['Pending'::text, 'Fulfilled'::text, 'Denied'::text]));

alter table public.revision_requests
  add constraint revision_requests_status_check
  check (status = any (array['Pending'::text, 'Done'::text, 'Denied'::text]));
