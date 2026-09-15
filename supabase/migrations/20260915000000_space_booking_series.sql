-- Recurring weekly SGA Space bookings (issue #112).
--
-- A series is the pattern; every week of it stays an ordinary space_bookings row
-- that points back at the series. Nothing that reads space_bookings -- the
-- calendar, the room display, overlap and blackout checks, the blackout cascade,
-- the weekly hours limit -- has to learn about series, and a single week can
-- still be edited or cancelled on its own exactly as before.

-- ---------------------------------------------------------------------------
-- semesters.end_date
-- ---------------------------------------------------------------------------
-- A series may not run past the end of the active semester, and semesters only
-- had a name. Nullable with no backfill: nobody has entered these dates yet, and
-- guessing them from the name would allow booking into breaks. Recurring booking
-- is unavailable until Management sets the active semester's end.

alter table public.semesters
  add column if not exists end_date date;

comment on column public.semesters.end_date is
  'Last day of the semester. A recurring SGA Space booking may not run past the active semester''s end_date, and cannot be made while it is NULL.';

-- ---------------------------------------------------------------------------
-- space_booking_series
-- ---------------------------------------------------------------------------
-- The template a series edit changes. Weeks edited on their own diverge from it
-- until the next series edit, which overwrites every upcoming week back to it.
--
-- start_time/end_time are times of day in the same Boston wall-clock domain as
-- space_bookings. An end_time of 00:00 means midnight at the end of the day, as
-- it does in the booking modal, so there is deliberately no start < end check.
--
-- The weekday is starts_on's. Weeks skipped at creation because they conflicted
-- lie between starts_on and ends_on with no row, and stay skipped: a series edit
-- only moves the weeks that exist, and only extending ends_on creates new ones.

create table if not exists public.space_booking_series (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid not null references public.spaces(id) on delete cascade,
  creator_id   uuid not null references auth.users(id) on delete cascade,
  title        text not null,
  attendee_ids uuid[] not null default '{}',
  start_time   time not null,
  end_time     time not null,
  starts_on    date not null,
  ends_on      date not null,
  cancelled_at timestamptz,
  created_at   timestamptz not null default now(),
  constraint space_booking_series_range_check check (ends_on >= starts_on)
);

comment on table public.space_booking_series is
  'A recurring weekly SGA Space booking. Each week is a space_bookings row with series_id set.';

comment on column public.space_booking_series.cancelled_at is
  'Set when the series is cancelled. Its upcoming weeks are deleted; past weeks are kept, and the series can no longer be edited.';

alter table public.space_booking_series enable row level security;

-- Readable by any signed-in user, matching "space_bookings: authenticated read".
-- Every write goes through the service-role client in /api/spaces/series, which
-- enforces creator-or-admin itself, so there are deliberately no write policies.
drop policy if exists "space_booking_series: authenticated read" on public.space_booking_series;
create policy "space_booking_series: authenticated read"
  on public.space_booking_series
  for select
  to authenticated
  using (true);

-- ---------------------------------------------------------------------------
-- space_bookings.series_id
-- ---------------------------------------------------------------------------
-- ON DELETE SET NULL: removing a series record should never take its past weeks
-- with it. In practice the app never deletes a series; cancelling one only
-- deletes its upcoming weeks.

alter table public.space_bookings
  add column if not exists series_id uuid references public.space_booking_series(id) on delete set null;

comment on column public.space_bookings.series_id is
  'The recurring series this booking is one week of. NULL for a one-off booking.';

create index if not exists space_bookings_series_id_idx
  on public.space_bookings (series_id)
  where series_id is not null;
