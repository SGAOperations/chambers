-- Per-occurrence overrides for purpose and hidden (issue #55).
--
-- A weekly occurrence can already diverge from its series on room, time, status
-- and reservation code. Each of those is a nullable column on
-- weekly_room_occurrences where NULL means "inherit from the parent", and these
-- follow exactly that convention -- the difference being that they inherit from
-- the `bookings` row two levels up rather than from weekly_room_bookings.
--
-- Nullable boolean for `hidden` is deliberate, and is why this is not
-- `default false`. The column needs three states: inherit (NULL), forced visible
-- (false) and forced hidden (true). A NOT NULL default would collapse "inherit"
-- into "visible" and make it impossible to un-hide a single occurrence of a
-- hidden series, or to reveal one later by changing the parent.
--
-- The issue also asks for a per-occurrence `is_event`. That is not here: storing
-- it is trivial, but the Events tab finds events by querying `bookings` where
-- is_event, and teaching it about occurrence-level events changes both that
-- query and how such an event is presented in a list whose rows are bookings.
-- Left for a follow-up rather than shipping a column nothing reads.

alter table public.weekly_room_occurrences
  add column if not exists purpose text,
  add column if not exists hidden  boolean;

comment on column public.weekly_room_occurrences.purpose is
  'Overrides bookings.purpose for this occurrence. NULL inherits.';

comment on column public.weekly_room_occurrences.hidden is
  'Overrides bookings.hidden for this occurrence. NULL inherits; false forces visible even when the booking is hidden.';
