-- Rollback for 20260908000000_deniable_revision_requests.sql.
--
-- Any already-denied requests have to go somewhere before the constraint is put
-- back, or adding it fails on those rows. They become 'Done': it is the existing
-- terminal state, and it keeps them off the Administrator's pending list, which
-- is the outcome the denial was reaching for. The distinction between "granted"
-- and "refused" is lost, along with the reasons.

update public.revision_requests set status = 'Done' where status = 'Denied';

alter table public.revision_requests
  drop constraint if exists revision_requests_status_check;

alter table public.revision_requests
  add constraint revision_requests_status_check
  check (status = any (array['Pending'::text, 'Done'::text]));

alter table public.revision_requests
  drop column if exists denial_reason;
