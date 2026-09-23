-- Biweekly recurring SGA Space bookings (issue #173).
--
-- A recurring space booking (issue #112) has always been weekly: the create and
-- edit routes step seven days at a time and nothing records anything else. A body
-- that meets every other week had to book each meeting on its own, or book weekly
-- and cancel half the weeks -- which holds the room for meetings that are not
-- happening, and shows up against the booker's weekly hours limit.
--
-- The cadence becomes a property of the series. Everything below it is unchanged:
-- each occurrence is still an ordinary space_bookings row pointing at the series,
-- so the calendar, the room display, overlap and blackout checks, the blackout
-- cascade and the weekly hours limit go on working without knowing that series
-- have a cadence at all.
--
-- Stored as a name rather than a number of weeks. 'weekly' and 'biweekly' are
-- what the UI offers and what the emails say, and a check constraint keeps the
-- column to those two -- an interval column would have invited 'every 3 weeks',
-- which nothing in the scheduling rules has been thought through for.
--
-- NOT NULL with a default of 'weekly', which is what every existing series is.
-- Backfilling is therefore exact rather than a guess, and no read path has to
-- handle the column being absent.
--
-- The cadence is fixed once a series exists: the edit route reads it and keeps
-- it. Changing weekly to biweekly would have to delete every other upcoming
-- week, which is a cancellation wearing an edit's clothes, and the people on
-- those weeks would learn about it from a calendar that quietly emptied.
-- Cancelling the series and making a new one says the same thing out loud.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see the column until then,
-- and every request touching it fails (db/neon/README.md).
--
-- To undo:
--   alter table public.space_booking_series
--     drop constraint if exists space_booking_series_frequency_check,
--     drop column if exists frequency;
-- Any biweekly series becomes indistinguishable from a weekly one, and editing
-- it will fill in the weeks it was skipping.

alter table public.space_booking_series
  add column if not exists frequency text not null default 'weekly';

alter table public.space_booking_series
  drop constraint if exists space_booking_series_frequency_check;

alter table public.space_booking_series
  add constraint space_booking_series_frequency_check
  check (frequency in ('weekly', 'biweekly'));

comment on column public.space_booking_series.frequency is
  'How often the series repeats: every week, or every other week. Counted from starts_on, and fixed for the life of the series.';
