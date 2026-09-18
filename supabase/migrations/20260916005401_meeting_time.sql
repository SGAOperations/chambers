-- Meeting Time, distinct from the reserved start and end times (issue #126).
--
-- start_time and end_time describe the *reservation*: the window the room is
-- held for, which is what CSC is told and what the calendar draws. They are not
-- the same thing as when the meeting actually begins, and a body that reserves
-- 6:00–9:00 so it can set up may well tell its members to arrive at 6:30.
-- Until now the only time anyone could be shown was the reservation window, so
-- every member-facing surface reported the wrong answer to "when do we meet?".
--
-- Meeting Time is a `time`, not free text, so it sorts, formats through the same
-- helpers as the other two, and cannot drift into "6ish".
--
-- ---------------------------------------------------------------------------
-- Why every column is nullable, and what NULL means
-- ---------------------------------------------------------------------------
-- NULL means inherit, resolving in the end to start_time. That is exactly the
-- convention weekly_room_occurrences already uses for room_name, start_time,
-- end_time and status, and that 20260829000000_occurrence_purpose_and_hidden.sql
-- extended to purpose and hidden.
--
-- Two things follow from it, both deliberate:
--
--   * No backfill is needed. Every existing row keeps behaving exactly as it
--     does today -- a booking with no meeting time set reads as meeting at its
--     start time, which is the assumption the whole app made before this column
--     existed. Nothing has to be migrated, and nothing changes for a body that
--     never sets one.
--
--   * No insert path can break. A NOT NULL column would have had to be supplied
--     by six write paths across three booking types, and any one of them missed
--     is a 500 in production rather than a field left blank.
--
-- The cost is that a weekly occurrence cannot say "this week, meet at the start
-- time" while its series says otherwise -- NULL there means inherit, so the
-- series value wins. Setting the occurrence's meeting time explicitly to the
-- start time expresses the same thing, which is why this is not worth the third
-- state that `hidden` needed. (`hidden` had no such escape: a boolean has only
-- two values and both were already spoken for.)
--
-- ---------------------------------------------------------------------------
-- Why these four tables and not `bookings`
-- ---------------------------------------------------------------------------
-- The issue asks for the field on "every booking, session, and occurrence".
-- Those three map onto the tables that own functional times, and `bookings` is
-- not one of them -- it carries purpose, scope and visibility, and has never
-- held a time of any kind:
--
--   booking    -> weekly_room_bookings      (the series; the weekly base value)
--   session    -> one_time_room_bookings    (one row per date of a one-time booking)
--              -> tabling_sessions          (one row per date of a tabling booking)
--   occurrence -> weekly_room_occurrences   (per-week override of the series)
--
-- One-time and tabling sessions each carry their own date and their own start
-- and end times, so each is independently overridable by definition and has no
-- parent time to inherit from. Only the weekly series/occurrence pair needs two
-- levels, and it gets them.

-- ---------------------------------------------------------------------------
-- Weekly: the series value, and the per-week override of it
-- ---------------------------------------------------------------------------

alter table public.weekly_room_bookings
  add column if not exists meeting_time time;

comment on column public.weekly_room_bookings.meeting_time is
  'When the meeting itself starts, as opposed to when the room reservation does. NULL inherits start_time.';

alter table public.weekly_room_occurrences
  add column if not exists meeting_time time;

comment on column public.weekly_room_occurrences.meeting_time is
  'Overrides weekly_room_bookings.meeting_time for this week. NULL inherits, resolving to the series meeting_time and then to start_time.';

-- ---------------------------------------------------------------------------
-- One-time and tabling: per-session, with nothing above them to inherit from
-- ---------------------------------------------------------------------------

alter table public.one_time_room_bookings
  add column if not exists meeting_time time;

comment on column public.one_time_room_bookings.meeting_time is
  'When the meeting itself starts, as opposed to when the room reservation does. NULL inherits this session''s start_time.';

alter table public.tabling_sessions
  add column if not exists meeting_time time;

comment on column public.tabling_sessions.meeting_time is
  'When the session itself starts, as opposed to when the table reservation does. NULL inherits this session''s start_time.';
