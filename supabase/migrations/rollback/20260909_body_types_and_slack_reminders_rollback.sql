-- Rollback for 20260909000000_body_types_and_slack_reminders.sql.
--
-- Drops the reminder log and the three columns on bodies. Any types Management
-- had corrected by hand after the backfill are lost, as is every channel link
-- and every "Leadership turned this off" decision -- so re-applying the
-- migration will re-infer types from names and re-enable reminders for every
-- committee whose channel is linked again.

drop table if exists public.slack_meeting_reminders;

alter table public.bodies
  drop column if exists slack_reminders_enabled;

alter table public.bodies
  drop column if exists slack_channel_id;

alter table public.bodies
  drop constraint if exists bodies_body_type_check;

alter table public.bodies
  drop column if exists body_type;
