-- Body types, and the Chambers Slack bot's weekly meeting reminders (issue #95).
--
-- Committees were distinguished from boards, teams and working groups by their
-- name and nothing else, so no query could ask for "the committees" without
-- pattern-matching a string. This gives bodies a type, and gives the one type
-- that needs it -- Committee -- a Slack channel to post meeting reminders to.

-- ---------------------------------------------------------------------------
-- bodies.body_type
-- ---------------------------------------------------------------------------

alter table public.bodies
  add column if not exists body_type text not null default 'Other';

alter table public.bodies
  drop constraint if exists bodies_body_type_check;

alter table public.bodies
  add constraint bodies_body_type_check
  check (body_type in ('Committee', 'Board', 'Advisory Board', 'Working Group', 'Team', 'Other'));

comment on column public.bodies.body_type is
  'What kind of body this is. Committee is the only type the Slack bot posts meeting reminders for.';

-- Backfill from the name, which is what has been carrying this distinction all
-- along. Order matters: 'Advisory Board' has to be tested before 'Board', or the
-- three advisory boards would come out as plain boards.
--
-- Checked against the 31 bodies live at the time of writing: 9 Committee,
-- 9 Board, 3 Advisory Board, 5 Team, 3 Working Group, and 2 that are genuinely
-- none of these -- Senate and SGA General -- which land on Other correctly
-- rather than as a failure to match. Management can change any of them.
update public.bodies set body_type = case
  when name ilike '%advisory board%' then 'Advisory Board'
  when name ilike '%committee%'      then 'Committee'
  when name ilike '%board%'          then 'Board'
  when name ilike '%working group%'  then 'Working Group'
  when name ilike '%team%'           then 'Team'
  else 'Other'
end;

-- ---------------------------------------------------------------------------
-- bodies: where the bot posts, and whether it may
-- ---------------------------------------------------------------------------

alter table public.bodies
  add column if not exists slack_channel_id text;

-- A channel id (C0123ABCDEF), not a name. Channels get renamed; ids do not, and
-- a reminder that silently stops posting because someone tidied up a channel
-- name is worse than no reminder at all.
comment on column public.bodies.slack_channel_id is
  'Slack channel id the bot posts this committee''s meeting reminders to. NULL means no channel is linked, and nothing is posted.';

alter table public.bodies
  add column if not exists slack_reminders_enabled boolean not null default true;

-- Leadership of the committee turns this off from inside its own channel, with
-- /chambers-reminders off. Defaults to true so that linking a channel is the
-- only step needed to start; there is nothing to post to until then anyway.
comment on column public.bodies.slack_reminders_enabled is
  'Whether the bot may post meeting reminders for this body. Toggled by Leadership of the body via /chambers-reminders in the linked channel, or by Management.';

-- ---------------------------------------------------------------------------
-- slack_meeting_reminders: what has already been posted
-- ---------------------------------------------------------------------------
-- The reminder job is scheduled from a GitHub Action, which may run several
-- times in the posting window (schedules there lag and are occasionally skipped,
-- so retries are the point). This table is what makes a repeat run a no-op
-- rather than a second ping.
--
-- Keyed on (weekly_booking_id, occurrence_date) rather than on an occurrence id.
-- The weekly PATCH handler regenerates its occurrences on every save -- it
-- deletes them all and reinserts, so their ids change -- and a foreign key to
-- weekly_room_occurrences(id) would forget every reminder the next time anyone
-- edited the booking, re-posting the lot. weekly_booking_id survives that
-- regeneration, and the date is the stable identifier within a series. This is
-- the same reasoning event_tracking already follows in
-- 20260829001000_occurrence_events.sql.
--
-- The pair, rather than the date alone, so a body running two weekly series that
-- both meet on a Tuesday gets a reminder for each.

create table if not exists public.slack_meeting_reminders (
  id uuid primary key default gen_random_uuid(),
  weekly_booking_id uuid not null references public.weekly_room_bookings(id) on delete cascade,
  occurrence_date date not null,
  channel_id text not null,
  posted_at timestamptz not null default now(),
  unique (weekly_booking_id, occurrence_date)
);

comment on table public.slack_meeting_reminders is
  'One row per meeting reminder the Slack bot has posted. Makes a repeated run of the reminder job a no-op.';

create index if not exists slack_meeting_reminders_date_idx
  on public.slack_meeting_reminders (occurrence_date);

alter table public.slack_meeting_reminders enable row level security;

-- Written only by the reminder job, which uses the service-role client and
-- bypasses RLS. Admins can read it to see what the bot has done; nobody else has
-- any reason to, and there is deliberately no INSERT or UPDATE policy.
drop policy if exists "slack_meeting_reminders_select_admin" on public.slack_meeting_reminders;
create policy "slack_meeting_reminders_select_admin"
  on public.slack_meeting_reminders
  for select
  to authenticated
  using (is_admin());
