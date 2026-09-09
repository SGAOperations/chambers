-- Let a revision request be denied (issue #77).
--
-- revision_requests.status was constrained to 'Pending' or 'Done', and 'Done' is
-- only ever set as a side effect of an admin editing the booking -- see the
-- "Resolve any pending revision request" block in each of the three
-- /api/administrator/bookings routes. So the only way to clear a revision
-- request was to grant it.
--
-- That is fine until the change being asked for cannot be made: the room is
-- taken, the time is outside CSC hours, the series has already ended. There was
-- no way to say no, and because lib/pending-actions.ts builds its revision
-- pending-actions from `status = 'Pending'`, the request stayed on the
-- Administrator's list as a danger row indefinitely, with no action that could
-- remove it.
--
-- 'Denied' is the third state. Nothing else needs to change to make the pending
-- action disappear -- the existing `.eq('status', 'Pending')` filter stops
-- matching the row the moment it is denied.

alter table public.revision_requests
  drop constraint if exists revision_requests_status_check;

alter table public.revision_requests
  add constraint revision_requests_status_check
  check (status = any (array['Pending'::text, 'Done'::text, 'Denied'::text]));

-- Recorded on the request rather than only on the notification sent to the
-- requester, so the reason survives the user dismissing that notification and is
-- still there if the denial is ever questioned.
alter table public.revision_requests
  add column if not exists denial_reason text;

comment on column public.revision_requests.denial_reason is
  'Why an admin denied this revision. NULL for Pending and Done rows, and for a denial given without a reason -- the reason field is optional, matching room request denials.';
