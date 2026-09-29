-- Where an audit entry's action came from, recorded on the entry itself.
--
-- Issue #188. bookings.booked_via_nusso (0009) says a *booking* was made through
-- Browse/Book NUSSO, and that is enough to badge it in a list. It is not enough
-- to audit it. An entry in the Audit tab for a NUSSO booking reads exactly like
-- an entry for any other -- "Booking - Created", no role badge, because a body
-- Leadership author holds none (0008) -- so there is no way to ask the log which
-- actions ran through NUSSO, only which bookings did.
--
-- Those are different questions. A NUSSO booking accumulates ordinary admin
-- edits afterwards, and an admin editing one is not NUSSO acting; conversely the
-- NUSSO cancellation path (lib/nusso/cancel-booking.ts) reaches straight into
-- EMS on SGA's shared account, which is the single most security-relevant thing
-- Chambers does, and it wrote an entry indistinguishable from a click in the
-- Cancellations tab. Provenance belongs on the action, not only on its subject.
--
-- Recorded rather than inferred, deliberately. Joining audit_logs to
-- bookings.booked_via_nusso would tar every later admin edit with NUSSO's brush
-- and would still be wrong the moment a booking's flag is ever corrected; the
-- log is meant to say what happened at the time.
--
-- Nullable, with no default and no backfill. Null means "not recorded as coming
-- from anywhere in particular" -- every entry written before this column, and
-- every ordinary Chambers action, which is the overwhelming majority. Only the
-- two NUSSO writers set it, so `source = 'nusso'` is a positive claim and the
-- absence of the column's value is never read as a claim of anything.
--
-- The check constraint is tight on purpose: a second origin is a schema change
-- and a deliberate decision, not something a caller can invent by typo.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see this column until then,
-- and both lib/audit.ts (write) and /api/administrator/audit-logs (read) select
-- it (db/neon/README.md). Both degrade rather than break in the meantime -- the
-- write retries without the column and the read falls back to the older column
-- list, exactly as they already do for admin_role -- so deploying ahead of the
-- refresh costs unmarked entries, not lost history or an empty tab.
--
-- To undo:
--   alter table public.audit_logs drop constraint if exists audit_logs_source_check;
--   alter table public.audit_logs drop column if exists source;

alter table public.audit_logs
  add column if not exists source text;

do $$
begin
  alter table public.audit_logs
    add constraint audit_logs_source_check
    check (source is null or source = 'nusso');
exception
  when duplicate_object then null;
end
$$;

comment on column public.audit_logs.source is
  'Where this action came from, when it came from somewhere other than Chambers'' own admin UI. ''nusso'' means it was written by the Browse/Book NUSSO integration -- a reservation recorded (lib/nusso/record-booking.ts) or released in EMS (lib/nusso/cancel-booking.ts). Null on every ordinary Chambers action and on entries predating this column; it is not a claim that the action was not NUSSO''s, merely that nothing was recorded. Stamped at write time rather than joined from bookings.booked_via_nusso, because later admin edits to a NUSSO booking are not NUSSO acting.';

create index if not exists audit_logs_source_idx
  on public.audit_logs (source)
  where source is not null;
