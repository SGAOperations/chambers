-- Extra event tracking forms (issue #161).
--
-- Event tracking was two fixed forms: Event Management Form and Engage Form,
-- each due a number of days before the event that is set once globally in
-- Administrator -> Advanced (app_settings.pa_event_mgmt_* / pa_event_engage_*).
-- An event that needs anything else -- pre-contracting six weeks out, a service
-- the standard two do not cover -- had nowhere to track it, and a deadline that
-- only applies to some events cannot be a global setting.
--
-- So an event gets forms of its own, on top of the standard two. Those two are
-- untouched here: they stay columns on event_tracking, on the global schedule.
--
--   event_form_templates -- the saved forms an admin curates, so a deadline the
--                           division uses repeatedly is picked rather than
--                           retyped.
--   event_tracking_items -- the forms actually being tracked on one event.
--
-- Adding from a saved form copies its name and lead time rather than pointing at
-- it. Editing a saved form is then a change to what gets added next, never a
-- silent change to a deadline someone is already working to.
--
-- Deadlines are stored as lead days (days before the event), not as dates, which
-- is how the standard two already work. The event date is derived -- the
-- earliest session of the booking, or the occurrence's own date -- and it moves
-- when a booking is edited or a week is rescheduled. A stored date would quietly
-- go stale there; a lead time follows.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see these tables until then,
-- and every request touching them 404s (db/neon/README.md).
--
-- To undo: drop table public.event_tracking_items, public.event_form_templates.

-- ---------------------------------------------------------------------------
-- event_form_templates: the catalog
-- ---------------------------------------------------------------------------

create table if not exists public.event_form_templates (
  id         uuid primary key default gen_random_uuid(),
  label      text not null,
  due_days   integer not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint event_form_templates_label_check    check (length(btrim(label)) between 1 and 100),
  constraint event_form_templates_due_days_check check (due_days >= 0)
);

comment on table public.event_form_templates is
  'Saved extra tracking forms an admin curates. Adding one to an event copies its name and due_days; later edits here do not reach events that already added it.';

comment on column public.event_form_templates.due_days is
  'Default number of days before the event this form is due.';

-- Two saved forms with the same name would be indistinguishable in the picker.
-- Case-insensitive, so "Contract" and "contract" collide as a reader expects.
create unique index if not exists event_form_templates_label_key
  on public.event_form_templates (lower(btrim(label)));

-- ---------------------------------------------------------------------------
-- event_tracking_items: the forms on one event
-- ---------------------------------------------------------------------------
-- Keyed by (booking_id, occurrence_date) rather than by event_tracking.id, for
-- the same reason that table is keyed on the date: the weekly PATCH handler
-- deletes and reinserts a series' occurrences on every save, so occurrence ids
-- do not survive an edit. It also means an event can carry extra forms before
-- anyone has ticked a standard one, i.e. before its event_tracking row exists.
--
-- No foreign key to event_tracking for the same reason, and cascading from
-- bookings is enough: deleting a booking takes its checklist and its extra forms
-- with it.

create table if not exists public.event_tracking_items (
  id              uuid primary key default gen_random_uuid(),
  booking_id      uuid not null references public.bookings(id) on delete cascade,
  occurrence_date date,
  label           text not null,
  due_days        integer not null,
  completed       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint event_tracking_items_label_check    check (length(btrim(label)) between 1 and 100),
  constraint event_tracking_items_due_days_check check (due_days >= 0)
);

comment on table public.event_tracking_items is
  'Extra tracking forms on one event, beyond the two standard ones. A NULL occurrence_date means the booking itself, which is how event_tracking addresses one-time and tabling events.';

comment on column public.event_tracking_items.due_days is
  'Days before the event this form is due. The event date is derived from the booking''s sessions, or from occurrence_date for a weekly event.';

create index if not exists event_tracking_items_target_idx
  on public.event_tracking_items (booking_id, occurrence_date);

-- ---------------------------------------------------------------------------
-- Access, as set up in 0003_data_api_server_role.sql
-- ---------------------------------------------------------------------------
-- That file loops over the tables that existed when it ran, so a table added
-- later has to repeat its two steps or the server sees "permission denied".
-- RLS stays enabled with only the chambers_server policy: every other role,
-- including anyone who reached the Data API with a token of their own, sees
-- nothing. Who may read or change these rows is decided in the API routes
-- (app/api/events/forms and .../form-templates), as everywhere else in Chambers.

alter table public.event_form_templates enable row level security;
alter table public.event_tracking_items enable row level security;

grant select, insert, update, delete on public.event_form_templates to chambers_server;
grant select, insert, update, delete on public.event_tracking_items to chambers_server;

drop policy if exists chambers_server_all on public.event_form_templates;
create policy chambers_server_all on public.event_form_templates
  for all to chambers_server using (true) with check (true);

drop policy if exists chambers_server_all on public.event_tracking_items;
create policy chambers_server_all on public.event_tracking_items
  for all to chambers_server using (true) with check (true);
