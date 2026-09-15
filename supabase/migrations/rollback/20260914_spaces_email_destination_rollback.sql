-- Rollback for 20260914010000_spaces_email_destination.sql.
--
-- Drops the inbox list on bodies and each person's choice. Every SGA Spaces
-- email goes back to users.email. Any inboxes Management had corrected by hand
-- are lost, so re-applying the migration re-runs the backfill from issue #109.

alter table public.users
  drop column if exists spaces_sga_email;

alter table public.users
  drop constraint if exists users_spaces_email_destination_check;

alter table public.users
  drop column if exists spaces_email_destination;

alter table public.bodies
  drop column if exists sga_emails;
