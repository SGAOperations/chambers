-- Separate advance-notice minimums for NUSSO (nuevents.neu.edu) bookings.
--
-- The Browse/Book NUSSO tab has a Book mode that must stop someone picking a date
-- too soon to actually reserve through NUSSO. NUSSO's own cutoff is not exposed
-- in any field we can read, and Chambers' existing min_days_advance_room /
-- min_days_advance_tabling are the SGA request-workflow lead times, which are a
-- different policy and the wrong number here. So NUSSO gets its own pair, managed
-- the same way (Management -> Booking Settings), read by the NUSSO tab to set the
-- earliest bookable date.
--
-- Default 0: no guessed cutoff. Book mode still forbids past dates (min = today);
-- an admin sets the real lead time in Management. Non-negative integer days, like
-- the columns they sit beside.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see these columns until then,
-- and every settings read touching them fails (db/neon/README.md).
--
-- To undo:
--   alter table public.app_settings
--     drop column if exists nusso_min_days_advance_room,
--     drop column if exists nusso_min_days_advance_tabling;

alter table public.app_settings
  add column if not exists nusso_min_days_advance_room integer not null default 0;

alter table public.app_settings
  add column if not exists nusso_min_days_advance_tabling integer not null default 0;

comment on column public.app_settings.nusso_min_days_advance_room is
  'Minimum days ahead a NUSSO room request may be booked from the Browse/Book NUSSO tab. Separate from min_days_advance_room (the SGA request lead time). 0 means only past dates are blocked.';

comment on column public.app_settings.nusso_min_days_advance_tabling is
  'Minimum days ahead a NUSSO tabling reservation may be booked from the Browse/Book NUSSO tab. Separate from min_days_advance_tabling. 0 means only past dates are blocked.';
