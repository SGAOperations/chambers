-- Preferred location and table count on a tabling request (issue #164).
--
-- A tabling booking has always recorded where the table stands --
-- tabling_sessions.location, NOT NULL, filled in by an admin when the booking is
-- created. The *request* that precedes it had nowhere to say it. Someone asking
-- to table outside Curry rather than in the Crossroads had to write it in the
-- notes and hope, and how many tables they needed was not asked at all, so a
-- body that wanted three got one.
--
-- Both columns sit on the session rather than the request: a request can carry
-- several sessions, and the whole point of asking is that a body tabling on
-- three days may want a different spot on each. That also matches
-- tabling_sessions, where location is already per session.
--
-- Nullable, and deliberately not backfilled. Requests submitted before this
-- existed have no honest value -- an invented location is worse than an admitted
-- blank -- so NULL means "not asked for" and both surfaces render it as "Not
-- specified", exactly as room_requests.capacity does for the requests that
-- predate issue #76.
--
-- New requests from the form are required to carry a table count, which is
-- enforced in /api/request rather than by a NOT NULL: the Slack quick-request
-- flow (app/api/slack/interaction) creates tabling requests too and has no field
-- for it, and a NOT NULL would turn that path into a 500. Location stays
-- optional everywhere, being a preference in the same sense as
-- room_request_details.room_name.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** in the Neon console: PostgREST will not see these columns until then,
-- and every request touching them fails (db/neon/README.md).
--
-- To undo:
--   alter table public.tabling_request_sessions
--     drop constraint if exists tabling_request_sessions_tables_check,
--     drop column if exists location,
--     drop column if exists tables;

alter table public.tabling_request_sessions
  add column if not exists location text;

comment on column public.tabling_request_sessions.location is
  'Where the body would like to table, as free text. A preference, not a promise: the admin sets the real location on tabling_sessions when the booking is made. NULL on requests created before issue #164, and on requests made through Slack.';

alter table public.tabling_request_sessions
  add column if not exists tables integer;

-- A request for zero or minus two tables is not one anyone means to make, and
-- the upper bound is well past the largest tabling setup while still ruling out
-- a mistyped year or phone number landing in the field.
alter table public.tabling_request_sessions
  drop constraint if exists tabling_request_sessions_tables_check;

alter table public.tabling_request_sessions
  add constraint tabling_request_sessions_tables_check
  check (tables is null or (tables > 0 and tables <= 20));

comment on column public.tabling_request_sessions.tables is
  'How many tables the session needs. NULL means not asked for: requests created before issue #164, and requests made through Slack, which has no field for it.';
