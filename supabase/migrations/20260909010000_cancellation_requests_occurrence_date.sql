-- Cancellation requests remember the date, not just the row id (issue #96).
--
-- cancellation_requests.occurrence_id names the dated row a request is about.
-- For a weekly booking that row does not survive an edit: the weekly PATCH
-- handler deletes every occurrence and reinserts it on each save, so the ids
-- change while the values are carried across on the date. The request is left
-- pointing at nothing.
--
-- Every cancellation_requests row in production is currently in that state --
-- all four of them, including the one still Pending. The consequences are worse
-- than they look:
--
--   * Marking a request Done could not find the reservation it was about, so it
--     closed the request and changed no booking status. That is the reported bug.
--   * Auto-Cancel finds those reservations anyway, because it scans by status
--     rather than by request -- but it cannot attribute them back to a request,
--     so it loses the cancellation_type and falls back to 'Cancelled'. A request
--     that asked to go Virtual would have cancelled the meeting outright.
--
-- The date is the stable identifier the write model actually preserves, which is
-- the same conclusion 20260829001000_occurrence_events.sql reached for
-- event_tracking, and the same one issue #69 reached for calendar UIDs. This
-- follows it: occurrence_id stays for the rows that still resolve, and
-- occurrence_date becomes the key that survives a regeneration.

alter table public.cancellation_requests
  add column if not exists occurrence_date date;

comment on column public.cancellation_requests.occurrence_date is
  'The date of the reservation this request is about, for occurrence-scoped requests. The stable key: occurrence_id does not survive an edit to a weekly booking, because the PATCH handler regenerates every occurrence row. NULL for series-scoped requests, and for occurrence-scoped ones created before this column existed whose row had already been regenerated.';

-- Backfill from occurrence_id wherever it still resolves. This sets nothing in
-- production, where every row has already been orphaned -- there is no record
-- anywhere of which date those requests named, so they cannot be recovered and
-- are deliberately left NULL rather than guessed at. It is written for the
-- environments where the rows are still intact, and so that applying this
-- migration to a restored backup does the right thing.

update public.cancellation_requests r
set occurrence_date = o.occurrence_date
from public.weekly_room_occurrences o
where r.occurrence_id = o.id
  and r.occurrence_date is null;

update public.cancellation_requests r
set occurrence_date = s.booking_date
from public.one_time_room_bookings s
where r.occurrence_id = s.id
  and r.occurrence_date is null;

update public.cancellation_requests r
set occurrence_date = t.session_date
from public.tabling_sessions t
where r.occurrence_id = t.id
  and r.occurrence_date is null;

-- Pending requests are looked up by (booking_id, occurrence_date) on every
-- Auto-Cancel preview and every Cancellations tab load.
create index if not exists cancellation_requests_booking_date_idx
  on public.cancellation_requests (booking_id, occurrence_date);
