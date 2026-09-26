-- The actor's role, frozen onto each audit entry at the moment it is written.
--
-- The Audit tab badged an entry with the author's *current* admin_role, read by
-- joining users on admin_id. That is not history: promote, retitle or demote
-- someone and every entry they ever wrote silently re-badges, including entries
-- from a time when they held a different office -- or none. Whoever the tab is
-- open to answer a question for ("who approved this, in what capacity") gets the
-- answer as of today rather than as of the action.
--
-- bookings.creator_role is the same idea one level up, but it is the *creator's*
-- role and belongs to the booking, so it cannot speak for an entry written later
-- by somebody else. The role has to sit on the entry.
--
-- Nullable with no default and no backfill, deliberately. Entries written before
-- this column existed have no recorded role, and inventing one from today's
-- users table would manufacture exactly the false history this column exists to
-- prevent. The tab falls back to the live users.admin_role for those rows, which
-- is what it always showed, and shows the stamped value once there is one.
--
-- Null is also the honest value going forward for an author who holds no admin
-- role -- body Leadership booking through Browse/Book NUSSO, say. Their name is
-- still recorded on the entry via admin_id; they simply have no title to badge.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see this column until then,
-- and /api/administrator/audit-logs selects it (db/neon/README.md).
--
-- To undo:
--   alter table public.audit_logs drop column if exists admin_role;

alter table public.audit_logs
  add column if not exists admin_role text;

comment on column public.audit_logs.admin_role is
  'The author''s admin_role as it was when this entry was written, so the Audit tab shows the office held at the time of the action rather than the one held today. Null on entries predating this column, and on authors with no admin role (e.g. body Leadership).';
