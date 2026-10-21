-- The private Slack channel SGAssist opens for each event.
--
-- When an admin marks a booking as an event -- the Event switch on a one-time
-- booking, is_event on one week of a weekly series, or "this is an event" when
-- fulfilling a request -- lib/event-channels.ts creates a private channel named
-- event-<purpose>, invites the VP of Operational Affairs, the Comptroller, the
-- VP of External Affairs and the body's Leadership, and posts who is there and
-- why.
--
-- This table is what stops marking the same event twice making two channels.
-- A row is a claim, written *before* Slack is asked: the first request inserts
-- it and goes on to create the channel; a second request (a double click, or
-- un-marking and re-marking) hits the unique key and stops. channel_id is null
-- while the claim is in flight, and the claim is deleted again if Slack refuses,
-- so a failed attempt is retried by the next mark rather than locked out.
--
-- One row per one-time booking (booking_id) or per weekly occurrence
-- (occurrence_id), never both: a weekly event is marked on the week it happens,
-- and each marked week gets its own channel. Both unique keys allow many nulls,
-- so each one only constrains the rows of its own kind.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** -- a new table is invisible to PostgREST until it does
-- (db/neon/README.md).
--
-- To undo:
--   drop table if exists public.event_slack_channels;

create table if not exists public.event_slack_channels (
  id uuid not null default gen_random_uuid(),
  booking_id uuid references public.bookings(id) on delete cascade,
  occurrence_id uuid references public.weekly_room_occurrences(id) on delete cascade,
  channel_id text,
  channel_name text,
  created_at timestamp with time zone not null default now(),
  constraint event_slack_channels_pkey primary key (id),
  constraint event_slack_channels_booking_id_key unique (booking_id),
  constraint event_slack_channels_occurrence_id_key unique (occurrence_id),
  constraint event_slack_channels_one_target_check
    check ((booking_id is null) <> (occurrence_id is null))
);

comment on table public.event_slack_channels is
  'The Slack channel created for an event: one per one-time booking or per weekly occurrence. channel_id is null while creation is in flight.';

alter table public.event_slack_channels enable row level security;

grant select, insert, update, delete on public.event_slack_channels to chambers_server;

drop policy if exists chambers_server_all on public.event_slack_channels;
create policy chambers_server_all on public.event_slack_channels
  for all to chambers_server using (true) with check (true);
