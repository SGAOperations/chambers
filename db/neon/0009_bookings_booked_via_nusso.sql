-- Whether Chambers itself created this booking's reservation in NUSSO.
--
-- The NUSSO Cancellation action needs to know which bookings it may release in
-- EMS, and reservation_code cannot answer that. A code on a booking means only
-- "an EMS reservation exists" -- and most of them were typed in by hand, by an
-- admin recording a reservation Operational Affairs had already made on the
-- phone or through the NUSSO web UI. On the preview branch 23 of 25 one-time
-- bookings carry a code and only three of those came from Browse/Book.
--
-- Gating an irreversible call to Northeastern's calendar on "has a code" would
-- therefore point it at reservations Chambers did not make and does not model:
-- a weekly series whose single code covers an entire semester of meetings, or a
-- booking whose EMS event name and window were never the ones Chambers holds.
-- The safe question is not "is there a reservation?" but "did we make it?", and
-- only the code that made it can answer that.
--
-- So provenance is recorded at creation, by lib/nusso/record-booking.ts, and
-- nothing else sets it. Default false, no backfill: every booking that exists
-- today keeps the manual cancellation path it has always had, which is the
-- answer that cannot cause harm if it is wrong. Bookings genuinely made through
-- Browse/Book before this column existed are a handful of test reservations; if
-- any needs the automatic path it can be flagged by hand, deliberately, one row
-- at a time.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see this column until then,
-- and /api/my-rooms and the NUSSO cancel route both select it
-- (db/neon/README.md).
--
-- To undo:
--   alter table public.bookings drop column if exists booked_via_nusso;

alter table public.bookings
  add column if not exists booked_via_nusso boolean not null default false;

comment on column public.bookings.booked_via_nusso is
  'True only when Chambers created this booking''s reservation through Browse/Book NUSSO, and so holds the EMS reservation it can release. Set by lib/nusso/record-booking.ts at creation and by nothing else. A reservation_code does NOT imply this: most codes are entered by hand for reservations made outside Chambers, which must keep the manual cancellation path.';
