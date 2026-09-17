-- Split "Pending" into "Ops Review" and "Awaiting CSC" (issue #128).
--
-- Room requests and revision requests were Pending until they closed, which hid
-- where the wait was. Much of it is with CSC Operations rather than SGA, and both
-- admins and requesters should be able to see that. An open request is now either
-- with Operational Affairs ('Ops Review') or passed on to CSC ('Awaiting CSC').
--
-- 'Pending' is renamed rather than kept alongside: every open request today is in
-- Ops Review, and leaving the old value valid would let a stale caller write a
-- status nothing reads.
--
-- Deploy with the matching application code. Code from before this migration
-- inserts 'Pending', which the new constraints refuse.

alter table public.room_requests
  drop constraint if exists room_requests_status_check;
alter table public.revision_requests
  drop constraint if exists revision_requests_status_check;

update public.room_requests set status = 'Ops Review' where status = 'Pending';
update public.revision_requests set status = 'Ops Review' where status = 'Pending';

alter table public.room_requests
  alter column status set default 'Ops Review';
alter table public.revision_requests
  alter column status set default 'Ops Review';

alter table public.room_requests
  add constraint room_requests_status_check
  check (status = any (array['Ops Review'::text, 'Awaiting CSC'::text, 'Fulfilled'::text, 'Denied'::text]));

alter table public.revision_requests
  add constraint revision_requests_status_check
  check (status = any (array['Ops Review'::text, 'Awaiting CSC'::text, 'Done'::text, 'Denied'::text]));
