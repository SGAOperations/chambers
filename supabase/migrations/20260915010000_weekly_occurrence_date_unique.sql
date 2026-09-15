-- One occurrence per week of a weekly room booking (issue #113).
--
-- The weekly PATCH handler used to delete every occurrence of a series and
-- reinsert it on each save, carrying values across on the date. Nothing outside
-- could point at a particular week, because its id changed whenever anyone
-- touched the booking -- which is why event_tracking, slack_meeting_reminders
-- and cancellation_requests.occurrence_date all had to key on the date instead,
-- and why a calendar integration had nothing stable to use as a UID.
--
-- The handler now upserts on (weekly_booking_id, occurrence_date): a week the
-- series still covers is updated in place and keeps its id, a week it newly
-- covers is inserted, and only a week it no longer covers is deleted. This
-- constraint is what the upsert's ON CONFLICT targets, and it states the rule
-- the regeneration only ever implied -- a series has at most one row per date.
--
-- Checked against production before writing: no (weekly_booking_id,
-- occurrence_date) pair currently appears twice, so this applies cleanly.
--
-- What still changes an id: moving a series to a different day of the week.
-- Every date then differs, so every week is a week the series no longer covers.
-- The date keys above behave the same way, so nothing becomes less stable than
-- it already was.

alter table public.weekly_room_occurrences
  drop constraint if exists weekly_room_occurrences_booking_date_key;

alter table public.weekly_room_occurrences
  add constraint weekly_room_occurrences_booking_date_key
  unique (weekly_booking_id, occurrence_date);
