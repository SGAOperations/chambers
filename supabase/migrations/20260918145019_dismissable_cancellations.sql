-- Dismissable cancellation requests (issue #139).
--
-- Marking a request Done applies what it asked for: its reservations become
-- Cancelled or Virtual (issue #96). That is right when the request can be acted
-- on, and wrong when it cannot -- most often because it came in too late for
-- CSC to release the room, so the booking stands and the body is still expected
-- to use it. An administrator needs a way to close such a request without
-- cancelling anything.
--
-- ---------------------------------------------------------------------------
-- cancellation_requests.previous_statuses
-- ---------------------------------------------------------------------------
-- "Close it without changing the status" is not enough on its own. Submitting a
-- request overwrites the status of every row it covers with Pending
-- Cancellation, and nothing kept what was there before. Leaving that in place
-- on dismissal would leave the booking pending, which is exactly what
-- Auto-Cancel then picks up and cancels, so dismissing would not stop the
-- cancellation at all.
--
-- So a request now records, at the moment it is made, the status each row held
-- before it was overwritten:
--
--   [{ "table": "weekly_room_bookings", "id": "<uuid>", "status": "Reserved" }, ...]
--
-- One entry per row the request actually wrote to, which is not always the row
-- the request names. A series-level request on a weekly booking writes to the
-- series row in weekly_room_bookings, and its weeks inherit the status from
-- there. `status` may be JSON null: a weekly occurrence with no status of its
-- own was inheriting, and that is what it goes back to.
--
-- NULL for requests made before this migration. Their prior statuses were
-- never recorded and cannot be recovered, so dismissing one closes it and
-- leaves its booking where it is, and the admin is told so.

alter table public.cancellation_requests
  add column if not exists previous_statuses jsonb;

comment on column public.cancellation_requests.previous_statuses is
  'The status each covered row held before this request set it to Pending Cancellation, as [{table, id, status}]. Read when the request is dismissed, to put them back. NULL for requests made before issue #139.';

-- ---------------------------------------------------------------------------
-- A distinct 'Dismissed' status
-- ---------------------------------------------------------------------------
-- Not folded into 'Done'. The two mean opposite things for the booking: Done
-- cancelled it, Dismissed left it standing. Anyone reading the list later needs
-- to be able to tell which happened.
--
-- Additive: nothing currently writes or reads 'Dismissed', and every open-
-- request check in the app compares against 'Pending', so a dismissed request
-- is already treated as closed everywhere.

alter table public.cancellation_requests
  drop constraint if exists cancellation_requests_status_check;

alter table public.cancellation_requests
  add constraint cancellation_requests_status_check
  check (status = any (array['Pending'::text, 'Done'::text, 'Dismissed'::text]));
