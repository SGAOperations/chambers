-- Expected attendance on a room request (issue #76).
--
-- CSC will not hold a room without a headcount, so it is a required field on the
-- booking -- but the request that precedes the booking had nowhere to put it.
-- Admins were finding out how many people a booking was for by asking, or by
-- guessing from the purpose, after the request had already been submitted.
--
-- Nullable, and deliberately not backfilled. The 2 requests that exist predate
-- the field and there is no honest value to give them: 0 would read as "nobody",
-- and any positive number would be invented. NULL means "not asked for", which
-- is what actually happened, and the UI renders it as "Not specified" rather
-- than as a number. New room requests are required to carry one, which is
-- enforced in /api/request rather than by a NOT NULL, because tabling requests
-- legitimately have no capacity and share this table.
alter table public.room_requests
  add column if not exists capacity integer;

-- A room for zero or minus four people is not a request anyone means to make,
-- and the upper bound is well past the largest space on campus while still
-- ruling out a mistyped phone number landing in the field.
alter table public.room_requests
  drop constraint if exists room_requests_capacity_check;

alter table public.room_requests
  add constraint room_requests_capacity_check
  check (capacity is null or (capacity > 0 and capacity <= 10000));

comment on column public.room_requests.capacity is
  'Expected attendance, used to pick a room that fits. NULL on tabling requests, which do not need one, and on room requests created before issue #76.';
