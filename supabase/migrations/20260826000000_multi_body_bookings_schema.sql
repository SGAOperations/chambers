-- Multi-body bookings (issue #19) -- part 1 of 2: schema.
--
-- A booking (and the room_request that may precede it) gains a `scope`:
--   'single'     -- one body. The existing behavior, and the default for every existing row.
--   'divisional' -- owned by `body_id` but visible/manageable across `division`.
--   'multi'      -- owned by `body_id`, shared with the bodies listed in `booking_bodies`.
--
-- `body_id` stays populated in all three cases as the originating/owning body, so existing rows
-- stay valid untouched and attribution for audit_logs and notification emails is preserved.
--
-- Part 2 (…_multi_body_bookings_rls.sql) generalizes the RLS policies that currently resolve
-- visibility through a single `body_id`. This file is deliberately additive and separate so the
-- policy rewrite can be reverted without reverting the schema.

-- ---------------------------------------------------------------------------
-- bookings
-- ---------------------------------------------------------------------------

alter table public.bookings
  add column scope text not null default 'single',
  add column division text;

alter table public.bookings
  add constraint bookings_scope_check
    check (scope in ('single', 'divisional', 'multi')),
  -- Mirrors bodies_division_check. See the note at the foot of this file about the duplication.
  add constraint bookings_division_check
    check (division is null or division = any (array[
      'Office of the President'::text, 'Academic Affairs'::text, 'Campus Affairs'::text,
      'DEI'::text, 'Student Success'::text, 'Operational Affairs'::text,
      'External Affairs'::text, 'Student Involvement'::text, 'Senate'::text,
      'Non-Divisional'::text])),
  -- division is present if and only if the booking is divisional
  add constraint bookings_division_required_check
    check ((scope = 'divisional') = (division is not null));

-- Verified 0 rows with a null body_id before writing this. The FK is already RESTRICT, so this
-- narrows the type without changing any delete behavior.
alter table public.bookings alter column body_id set not null;

-- ---------------------------------------------------------------------------
-- room_requests -- same shape, so a request can carry its scope through fulfillment
-- ---------------------------------------------------------------------------

alter table public.room_requests
  add column scope text not null default 'single',
  add column division text;

alter table public.room_requests
  add constraint room_requests_scope_check
    check (scope in ('single', 'divisional', 'multi')),
  add constraint room_requests_division_check
    check (division is null or division = any (array[
      'Office of the President'::text, 'Academic Affairs'::text, 'Campus Affairs'::text,
      'DEI'::text, 'Student Success'::text, 'Operational Affairs'::text,
      'External Affairs'::text, 'Student Involvement'::text, 'Senate'::text,
      'Non-Divisional'::text])),
  add constraint room_requests_division_required_check
    check ((scope = 'divisional') = (division is not null));

alter table public.room_requests alter column body_id set not null;

-- ---------------------------------------------------------------------------
-- Join tables for 'multi' scope
-- ---------------------------------------------------------------------------

-- Invariant (enforced in lib/booking-scope.ts, not here -- see the note below):
--   scope='multi'  -> contains every participating body, INCLUDING bookings.body_id, count >= 2
--   scope<>'multi' -> empty
--
-- body_id is ON DELETE RESTRICT rather than CASCADE on purpose: bookings.body_id is already
-- RESTRICT, and cascading here would silently shrink a booking's audience with no trace.
create table public.booking_bodies (
  booking_id uuid not null references public.bookings(id) on delete cascade,
  body_id    uuid not null references public.bodies(id)   on delete restrict,
  created_at timestamptz not null default now(),
  primary key (booking_id, body_id)
);

-- The PK covers booking_id -> bodies; this covers the reverse lookup my-rooms needs.
create index booking_bodies_body_id_idx on public.booking_bodies (body_id);

alter table public.booking_bodies enable row level security;

create table public.room_request_bodies (
  request_id uuid not null references public.room_requests(id) on delete cascade,
  body_id    uuid not null references public.bodies(id)        on delete restrict,
  created_at timestamptz not null default now(),
  primary key (request_id, body_id)
);

create index room_request_bodies_body_id_idx on public.room_request_bodies (body_id);

alter table public.room_request_bodies enable row level security;

-- ---------------------------------------------------------------------------
-- Indexes for the divisional visibility path
-- ---------------------------------------------------------------------------

create index bookings_divisional_idx
  on public.bookings (division) where scope = 'divisional';

create index room_requests_divisional_idx
  on public.room_requests (division) where scope = 'divisional';

-- ---------------------------------------------------------------------------
-- Assert the implicit backfill
-- ---------------------------------------------------------------------------

-- No backfill statement is needed: Postgres applies a non-volatile DEFAULT to existing rows
-- without a table rewrite, so every pre-existing booking/request is already ('single', null).
-- This asserts that actually happened rather than trusting it.
do $$
begin
  if exists (select 1 from public.bookings
             where scope <> 'single' or division is not null)
     or exists (select 1 from public.room_requests
                where scope <> 'single' or division is not null)
  then
    raise exception 'multi-body migration: pre-existing rows are not all single-scope';
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Notes
-- ---------------------------------------------------------------------------
--
-- 1. The "multi has >= 2 bodies including the owner" invariant is NOT a constraint trigger.
--    supabase-js writes the parent row and the join rows as two separate HTTP requests, i.e. two
--    transactions, so even a DEFERRABLE INITIALLY DEFERRED trigger fires while booking_bodies is
--    still empty and every multi insert would fail. It is enforced in validateScopeSelection().
--    Standing integrity check for ops:
--
--      select b.id, b.scope, count(bb.body_id) as linked
--      from public.bookings b
--      left join public.booking_bodies bb on bb.booking_id = b.id
--      group by b.id, b.scope
--      having (b.scope = 'multi'
--              and (count(bb.body_id) < 2 or not bool_or(bb.body_id = b.body_id)))
--          or (b.scope <> 'multi' and count(bb.body_id) > 0);
--
-- 2. The division list now appears in three CHECK constraints plus DIVISIONS in
--    lib/booking-scope.ts. The right fix is a public.divisions lookup table with real FKs, which
--    would also make the bodies-tab dropdown DB-driven -- but that means replacing
--    bodies_division_check, a wider blast radius than this issue warrants. Tracked as follow-up.
--
-- 3. CHECK constraints here are validated immediately; at 48 bookings / 13 requests the scan is
--    free. On a large table these would want ADD ... NOT VALID followed by VALIDATE CONSTRAINT.
