-- One reminder row per channel, so a shared booking can remind more than one.
--
-- Issue #212. slack_meeting_reminders is the record that stops the morning's
-- repeat runs posting a meeting twice (app/api/cron/slack-reminders), and it was
-- unique on (weekly_booking_id, occurrence_date) because a reminder only ever
-- went to one place: the owning body's channel.
--
-- A divisional booking is not one body's. The Campus Affairs co-working session
-- is filed by Sustainability Committee and is for the whole division, so it now
-- posts to every channel in that division -- and with the old key the first
-- channel to be posted would record the *booking* as done for the day, leaving
-- the rest of the division silent on the next run. Worse on a partial failure:
-- one channel refusing would be papered over by another succeeding.
--
-- channel_id has been on the table since the baseline and has always been
-- written, so this only widens the key. Every existing row satisfies it -- there
-- is at most one per (booking, date) today -- and nothing is deleted.
--
-- No Data API schema cache refresh is needed: Postgres enforces this itself and
-- no column has changed, so there is nothing new for PostgREST to see
-- (db/neon/README.md).
--
-- Apply with scripts/neon/apply-file.mjs.
--
-- To undo, after removing any rows that would collide:
--   alter table public.slack_meeting_reminders
--     drop constraint if exists slack_meeting_reminders_booking_date_channel_key;
--   alter table public.slack_meeting_reminders
--     add constraint slack_meeting_reminders_weekly_booking_id_occurrence_date_key
--     unique (weekly_booking_id, occurrence_date);

alter table public.slack_meeting_reminders
  drop constraint if exists slack_meeting_reminders_weekly_booking_id_occurrence_date_key;

do $$
begin
  alter table public.slack_meeting_reminders
    add constraint slack_meeting_reminders_booking_date_channel_key
    unique (weekly_booking_id, occurrence_date, channel_id);
exception
  when duplicate_table then null;
  when duplicate_object then null;
end
$$;

comment on table public.slack_meeting_reminders is
  'One row per reminder actually posted: a meeting, a date and the channel it went to. Written only after Slack accepts the message, so a refused post is retried by the next run of the morning rather than recorded as delivered. Unique per channel rather than per booking (issue #212), because a divisional or multi-body booking reminds every channel in its audience and each has to be tracked on its own.';
