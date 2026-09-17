-- Attendees without a Chambers account on SGA Space bookings (issue #132).
--
-- attendee_ids can only name Chambers users, so someone from outside -- an
-- interview candidate, a guest from another office -- could not be put on a
-- booking or sent its invite. Their addresses are stored beside the ids, on each
-- booking and on the series that creates weekly ones.
--
-- The API holds every address to @northeastern.edu and caps the list; the
-- constraint here only bounds its size.
--
-- Additive: code from before this migration never reads or writes the column.

alter table public.space_bookings
  add column if not exists external_attendees text[] not null default '{}';

alter table public.space_booking_series
  add column if not exists external_attendees text[] not null default '{}';

alter table public.space_bookings
  add constraint space_bookings_external_attendees_size
  check (cardinality(external_attendees) <= 25);

alter table public.space_booking_series
  add constraint space_booking_series_external_attendees_size
  check (cardinality(external_attendees) <= 25);

comment on column public.space_bookings.external_attendees is
  'Attendees without a Chambers account, by @northeastern.edu address (issue #132). Sent the same invites as attendee_ids.';
comment on column public.space_booking_series.external_attendees is
  'External attendees every week of the series is created with (issue #132).';
