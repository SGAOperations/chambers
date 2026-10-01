-- Let a standard event form be marked not required (issue #208).
--
-- The two standard forms are booleans on event_tracking, and a boolean has room
-- for exactly two of the three things that can be true of a form: it is done, or
-- it is outstanding. The third -- it was never required in the first place --
-- had nowhere to live. An Event Management Form is not asked for when the event
-- is in a normal Curry space, so the form is never going to be submitted, and
-- lib/pending-actions.ts builds its event-form actions from `not ticked`. The
-- action therefore sat on the Administrator's list until the event passed,
-- escalating to red on the way, with only one way to clear it: tick a form
-- nobody filled in, which puts a false record in the one place that is supposed
-- to say whether the form exists.
--
-- Same shape, and the same fix, as the deniable revision requests of issue #77:
-- a third state, so that "no" is a thing the system can express. There it was a
-- status column that gained a value; here it is a boolean that gains a sibling,
-- because that is the shape the two standard forms already have.
--
-- Waiving is deliberately not derived from the room. "Not required in a normal
-- Curry space" is the rule as a person states it, but Chambers has no room
-- catalog -- room names are free text typed per booking ('Curry 318', 'Curry
-- Student Center - 333'), which is why lib/committee-display.ts has to pattern
-- match them to point an arrow. A rule read off that text would be wrong for
-- every room written a way the patterns do not know, and wrong silently. So an
-- admin says so per event, and the flag records that they did.
--
-- Separate columns rather than a third value on the tick, so the two facts stay
-- independent: a form that was waived and later turns out to be needed goes back
-- to outstanding without anything having to remember whether it had been ticked.
-- No reason column, unlike #77's denial_reason -- the flag answers the question
-- the pending actions list is asking, and the reason is nearly always the room.
--
-- Not null with a default, and the default is the status quo: every existing
-- checklist row reads "required", which is what it meant before this column.
--
-- Who may set them is decided in /api/events/checklist, as everywhere else in
-- Chambers, and it is a narrower gate than the rest of that route: ticking a
-- form is admin or IEMS, waiving one is admins only.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see these columns until then,
-- and both readers select them by name -- /api/events for the Events tab and
-- lib/pending-actions.ts for the actions list -- so each 404s until it is done
-- rather than degrading (db/neon/README.md).
--
-- To undo:
--   alter table public.event_tracking
--     drop column if exists event_management_form_waived,
--     drop column if exists engage_form_waived;

alter table public.event_tracking
  add column if not exists event_management_form_waived boolean not null default false,
  add column if not exists engage_form_waived boolean not null default false;

comment on column public.event_tracking.event_management_form_waived is
  'True when an admin has marked the Event Management Form as not required for this event, e.g. because it is in a normal Curry space. Independent of event_management_form: a waived form raises no pending action whether or not it was ever ticked, and un-waiving returns it to whatever its tick says. False on every row predating this column, which is what they already meant.';

comment on column public.event_tracking.engage_form_waived is
  'True when an admin has marked the Engage Form as not required for this event. See event_management_form_waived.';
