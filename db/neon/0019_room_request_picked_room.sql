-- Which room a one-time request's session picked, not only what it is called.
--
-- Request a Booking can now fill a session's Preferred Room from the Browse/Book
-- Rooms timeline, which knows the room as a NUSSO room id or a 25Live space id.
-- room_name keeps the text people read; these two keep the identity, so
-- Operational Affairs can act on the exact room later -- book a NUSSO pick
-- without retyping it -- instead of matching a name by eye.
--
-- Both NULL when the room was typed by hand, which is every row that predates
-- this file, and every weekly request: the picker covers one day, and a weekly
-- request spans a term. Together or not at all, so a source never comes without
-- the id it names.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see these columns until then,
-- and submitting a one-time request fails until it does (db/neon/README.md).
--
-- To undo:
--   alter table public.room_request_details
--     drop constraint if exists room_request_details_picked_room_check,
--     drop column if exists room_ref,
--     drop column if exists room_source;

alter table public.room_request_details
  add column if not exists room_source text,
  add column if not exists room_ref integer;

alter table public.room_request_details
  drop constraint if exists room_request_details_picked_room_check;

alter table public.room_request_details
  add constraint room_request_details_picked_room_check check (
    (room_source is null and room_ref is null)
    or (room_source in ('nusso', 'registrar') and room_ref is not null)
  );

comment on column public.room_request_details.room_source is
  'Where a picked Preferred Room came from: ''nusso'' (EMS room id) or ''registrar'' (25Live space id). NULL when typed by hand.';

comment on column public.room_request_details.room_ref is
  'The picked room''s id in room_source''s system. NULL when typed by hand.';
