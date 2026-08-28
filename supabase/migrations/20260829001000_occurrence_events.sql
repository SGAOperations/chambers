-- Weekly events are marked on the occurrence, not the booking (issue #55).
--
-- Separate from 20260829000000 so that migration can be applied independently;
-- this one does more than add a column.
--
-- `is_event` here is NOT NULL DEFAULT false, unlike the purpose/hidden overrides
-- in the previous migration, because it is not an override. A weekly series is
-- not "an event" that individual weeks opt out of -- one particular week is the
-- event. So the occurrence is authoritative and inherits nothing.
--
-- Nothing needs backfilling: every booking currently flagged is_event is a
-- One-Time Room, and the Administrator UI has never offered the Mark Event
-- control on weekly bookings at all (only a badge). Booking-level is_event stays
-- exactly as it is for one-time and tabling bookings.

alter table public.weekly_room_occurrences
  add column if not exists is_event boolean not null default false;

comment on column public.weekly_room_occurrences.is_event is
  'Marks this single occurrence as an event. Authoritative, not an override: weekly events are marked per occurrence, never on the parent booking.';

-- ---------------------------------------------------------------------------
-- event_tracking: one checklist per event, where an event may now be one week
-- ---------------------------------------------------------------------------
-- booking_id was the primary key, so a booking had exactly one checklist. With
-- two occurrences of the same series flagged, ticking a form on one would tick
-- it on the other.
--
-- The new target is (booking_id, occurrence_date), with a NULL occurrence_date
-- meaning "the booking itself" -- which is what one-time and tabling events keep
-- using, so their existing rows stay valid untouched.
--
-- Keyed on occurrence_date rather than an occurrence id on purpose. The weekly
-- PATCH handler regenerates its occurrences on every save -- it deletes them all
-- and reinserts, so their ids change -- and values survive only by being carried
-- across on the date. A foreign key to weekly_room_occurrences(id) would
-- therefore drop every checklist the next time anyone edited the booking. The
-- date is the stable identifier that write model actually preserves.
--
-- UNIQUE NULLS NOT DISTINCT (Postgres 15+) is what makes the booking-level row
-- work: by default NULLs compare distinct, so a plain unique constraint would
-- happily admit several booking-level rows for the same booking and the upsert
-- would insert a new one every time instead of updating.

alter table public.event_tracking
  add column if not exists occurrence_date date;

alter table public.event_tracking
  add column if not exists id uuid not null default gen_random_uuid();

alter table public.event_tracking drop constraint if exists event_tracking_pkey;
alter table public.event_tracking add constraint event_tracking_pkey primary key (id);

alter table public.event_tracking drop constraint if exists event_tracking_target_key;
alter table public.event_tracking add constraint event_tracking_target_key
  unique nulls not distinct (booking_id, occurrence_date);

comment on column public.event_tracking.occurrence_date is
  'Which weekly occurrence this checklist belongs to. NULL means the booking itself, which is how one-time and tabling events are tracked.';
