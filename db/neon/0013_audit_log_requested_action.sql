-- 'requested' as an audit action: a cancellation request moving a status to
-- Pending Cancellation.
--
-- Issue #211. Asking for a cancellation changes a booking -- one week, one
-- session, or a whole series goes to Pending Cancellation -- and the Audit tab
-- said nothing about it. The log picked the story up only at the far end, when
-- an admin marked the request Done ('cancelled') or closed it without acting
-- ('dismissed'), so a booking sitting at Pending Cancellation had no entry
-- naming who put it there or when. That is the question the tab exists to
-- answer, and it is the one change on a booking that a non-admin can make.
--
-- Its own action rather than a plain 'updated' with a Status change, for the
-- same reason 'dismissed' is its own: the request is a distinct thing that
-- happened to the booking, with a distinct next step, and the pair of entries
-- around it should read as a pair. An entry labelled "Changed" would be
-- indistinguishable from an admin editing the status by hand in the booking
-- editor, which is a different act by a different person.
--
-- Postgres enforces this constraint directly, so unlike the column additions in
-- 0008 and 0011 there is **no Data API schema cache refresh to do** -- nothing
-- about the shape PostgREST sees has changed. It does have to be applied before
-- the code that writes 'requested' is deployed: until then those inserts are
-- rejected by the check, and since audit writes are best effort
-- (lib/audit.ts) the cost is an unwritten entry rather than a failed
-- cancellation request. Applying it to a branch ahead of any deploy costs
-- nothing, because nothing writes the value yet.
--
-- Apply with scripts/neon/apply-file.mjs (db/neon/README.md).
--
-- To undo, restore the previous list:
--   alter table public.audit_logs drop constraint if exists audit_logs_action_check;
--   alter table public.audit_logs add constraint audit_logs_action_check
--     check (action is null or action = any (array['created','updated','added','removed','cancelled','dismissed']));

alter table public.audit_logs
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  add constraint audit_logs_action_check
  check (
    action is null
    or action = any (array[
      'created'::text,
      'updated'::text,
      'added'::text,
      'removed'::text,
      'cancelled'::text,
      'dismissed'::text,
      'requested'::text
    ])
  );

comment on column public.audit_logs.action is
  'What happened to the entry''s target. ''requested'' is a cancellation request being filed, which moves the target to Pending Cancellation; ''dismissed'' is that request being closed without acting on it; ''cancelled'' is it being carried out. Null on entries predating issue #120, which recorded a status and nothing else.';
