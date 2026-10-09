-- When, and by whom, Chambers itself emailed CSC for a request (issue #226).
--
-- Auto-Request sends CSC the reservation request for tabling requests an admin
-- selects, and moves each to Awaiting CSC. The status alone cannot say that
-- happened: "Mark Sent to CSC" sets the same status after an admin has written
-- to CSC by hand, or not at all, and an admin may move a request back to Ops
-- Review afterwards. Neither tells the next person whether CSC already has this
-- request in their inbox -- and the cost of guessing wrong is sending a
-- university office the same reservation twice.
--
-- audit_logs cannot carry it either: every entry there is about a booking
-- (booking_id is NOT NULL), and a request has no booking until it is fulfilled.
--
-- So the request records it directly. The Auto-Request list shows the stamp
-- beside any request that has been sent before, which is the case that matters:
-- one moved back to Ops Review after Chambers had already mailed CSC for it.
--
-- Nullable and not backfilled. NULL means Chambers never emailed CSC for this
-- request, which is true of every request that predates this column, whatever
-- its status says.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see these columns until then,
-- and Auto-Request fails until it does (db/neon/README.md). Nothing else reads
-- them, so the rest of the Requests tab is unaffected in the meantime.
--
-- To undo:
--   alter table public.room_requests
--     drop column if exists csc_requested_by,
--     drop column if exists csc_requested_at;

alter table public.room_requests
  add column if not exists csc_requested_at timestamp with time zone;

comment on column public.room_requests.csc_requested_at is
  'When Auto-Request last emailed CSC for this request (issue #226). NULL if Chambers never has -- including requests marked Awaiting CSC by hand.';

-- Deliberately not a foreign key to users. room_requests already has one
-- (requested_by), and every query that embeds `users(full_name)` on a request
-- -- the Requests tab, My Requests, alerts -- relies on it being the only one. A
-- second makes each of those embeds ambiguous to PostgREST, which refuses them
-- outright, so this column would have broken the Requests tab to record who
-- pressed a button. The name is looked up separately where it is shown.
alter table public.room_requests
  add column if not exists csc_requested_by uuid;

comment on column public.room_requests.csc_requested_by is
  'The admin who pressed send on the Auto-Request that emailed CSC for this request. NULL alongside csc_requested_at. Not a foreign key, so it may outlive the account it names.';
