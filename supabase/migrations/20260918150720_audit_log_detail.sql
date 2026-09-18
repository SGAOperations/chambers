-- Audit entries that say what changed, and where (issue #120).
--
-- An audit row held one status and nothing else, and that status came from the
-- booking as a whole: the first session of a one-time booking, a comma-joined
-- list for tabling, the series for a weekly booking. Since bookings grew
-- sessions and per-week overrides, that answered nothing. Cancelling one week of
-- a fourteen-week series logged "Reserved", the series' status, with no mention
-- of the week, and a room change logged the same row as a save that changed
-- nothing.
--
-- Each entry now names what it is about and what moved. A save that touches
-- three weeks writes three entries, sharing a created_at so the Audit tab can
-- show them as one action.

alter table public.audit_logs
  add column if not exists target text,
  add column if not exists target_date date,
  add column if not exists action text,
  add column if not exists changes jsonb;

comment on column public.audit_logs.target is
  'What the entry is about: booking, series (a weekly series as a whole), occurrence (one week of it) or session (one date of a one-time or tabling booking). NULL for entries written before issue #120.';
comment on column public.audit_logs.target_date is
  'The date of the week or session the entry is about. NULL when it is about the booking or series as a whole. A date rather than a row id, because a tabling session''s id does not survive an edit and a date does.';
comment on column public.audit_logs.action is
  'created, updated, added, removed, cancelled or dismissed. NULL for entries written before issue #120.';
comment on column public.audit_logs.changes is
  'The fields that changed, as [{label, from, to}] in display form -- the same strings the update email shows. NULL where there is nothing to compare, such as on creation.';

-- new_status stays NOT NULL and keeps its meaning of "status after the change",
-- now the status of the thing the entry names. Old rows are untouched: they are
-- shown as they always were, marked as predating the detail.

alter table public.audit_logs
  drop constraint if exists audit_logs_target_check;
alter table public.audit_logs
  add constraint audit_logs_target_check
  check (target is null or target = any (array['booking'::text, 'series'::text, 'occurrence'::text, 'session'::text]));

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;
alter table public.audit_logs
  add constraint audit_logs_action_check
  check (action is null or action = any (array['created'::text, 'updated'::text, 'added'::text, 'removed'::text, 'cancelled'::text, 'dismissed'::text]));

-- The Audit tab reads one booking's entries, newest first.
create index if not exists audit_logs_booking_created_idx
  on public.audit_logs (booking_id, created_at desc);
