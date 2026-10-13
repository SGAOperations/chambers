-- The Sunday reminder to cancel unused weekly rooms.
--
-- app/api/cron/weekly-cancel-reminder posts one message to a leadership channel
-- each Sunday when the coming week has weekly rooms held in the active semester.
--
-- Where it posts is a setting, not a constant: the channel is SGA's to move, and
-- moving it should not take a deploy. It lives on app_settings beside the other
-- knobs the Management page edits. Null switches the reminder off.
--
-- Seeded with #1-leadership (C0821FJE50F), the channel it was asked for.
--
-- slack_weekly_cancel_reminders is what stops Sunday's repeat runs posting twice,
-- the same job slack_meeting_reminders does for the daily reminder: a row is
-- written only after Slack accepts the message, so a refused post is retried by
-- the next run rather than recorded as delivered. Keyed on the channel as well as
-- the week, so pointing the setting at a new channel mid-Sunday still posts there.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** -- a new column and a new table are both invisible to PostgREST until
-- it does (db/neon/README.md).
--
-- To undo:
--   drop table if exists public.slack_weekly_cancel_reminders;
--   alter table public.app_settings drop column if exists cancel_reminder_channel_id;

alter table public.app_settings
  add column if not exists cancel_reminder_channel_id text;

comment on column public.app_settings.cancel_reminder_channel_id is
  'Slack channel id the Sunday weekly-room cancellation reminder posts to. Null turns the reminder off.';

update public.app_settings
  set cancel_reminder_channel_id = 'C0821FJE50F'
  where id = 1 and cancel_reminder_channel_id is null;

create table if not exists public.slack_weekly_cancel_reminders (
  week_start date not null,
  channel_id text not null,
  posted_at timestamp with time zone not null default now(),
  constraint slack_weekly_cancel_reminders_pkey primary key (week_start, channel_id)
);

comment on table public.slack_weekly_cancel_reminders is
  'One row per Sunday cancellation reminder actually posted: the Monday of the week it covered and the channel it went to. Written only after Slack accepts the message.';

alter table public.slack_weekly_cancel_reminders enable row level security;

grant select, insert, update, delete on public.slack_weekly_cancel_reminders to chambers_server;
