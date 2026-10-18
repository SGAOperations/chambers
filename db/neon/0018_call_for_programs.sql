-- The call for programs: Operational Affairs asks every body's leadership,
-- before a semester's weekly rooms are booked, whether to keep last term's
-- weekly booking as it was or move its room, its time, or both.
--
-- A call is opened and closed from the Management page. It closes either when
-- an admin closes it (closed_at) or when its optional closes_at passes, so an
-- automatic close needs no cron: "open" is worked out on read. At most one call
-- is ever unclosed; opening a new one closes the last.
--
-- One submission per body per call, and it is not editable -- the unique key
-- is what holds that, not the form.
--
-- semesters.term says which semesters are fall or spring, because the form
-- shows the body's weekly booking from the latest one of those (a summer term
-- is not the schedule a body is renewing). Backfilled from the name, which is
-- how it was told apart until now; admins set it on the Management page.
--
-- The Slack message on opening goes to app_settings.cancel_reminder_channel_id
-- (0017), the same leadership channel as the Sunday reminder, so there is no
-- new setting.
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** -- new tables and a new column are invisible to PostgREST until it
-- does (db/neon/README.md).
--
-- To undo:
--   drop table if exists public.program_submissions;
--   drop table if exists public.program_calls;
--   alter table public.semesters drop column if exists term;

alter table public.semesters
  add column if not exists term text;

alter table public.semesters
  drop constraint if exists semesters_term_check;
alter table public.semesters
  add constraint semesters_term_check
  check ((term is null) or (term = any (array['Fall'::text, 'Spring'::text, 'Summer'::text])));

update public.semesters set term = case
    when name ilike '%fall%' then 'Fall'
    when name ilike '%spring%' then 'Spring'
    when name ilike '%summer%' then 'Summer'
  end
  where term is null;

create table if not exists public.program_calls (
  id uuid not null default gen_random_uuid(),
  opened_at timestamp with time zone not null default now(),
  opened_by uuid references public.users(id) on delete set null,
  closes_at timestamp with time zone,
  closed_at timestamp with time zone,
  closed_by uuid references public.users(id) on delete set null,
  constraint program_calls_pkey primary key (id)
);

-- Only one call may be unclosed at a time.
create unique index if not exists program_calls_one_unclosed
  on public.program_calls ((true)) where closed_at is null;

create table if not exists public.program_submissions (
  id uuid not null default gen_random_uuid(),
  call_id uuid not null references public.program_calls(id) on delete cascade,
  body_id uuid not null references public.bodies(id) on delete cascade,
  submitted_by uuid references public.users(id) on delete set null,
  created_at timestamp with time zone not null default now(),
  -- The weekly booking the answer is about, and a copy of what it was, so the
  -- answer still reads after that semester is archived or deleted.
  prior_weekly_booking_id uuid references public.weekly_room_bookings(id) on delete set null,
  prior_snapshot jsonb,
  -- keep / room / time / both; 'new' when the body had no weekly booking.
  change_type text not null,
  requested_room text,
  requested_capacity integer,
  requested_day text,
  requested_start_time time without time zone,
  requested_end_time time without time zone,
  -- The times are a window the body could meet in, not the exact slot.
  time_is_range boolean not null default false,
  comments text,
  constraint program_submissions_pkey primary key (id),
  constraint program_submissions_call_body_key unique (call_id, body_id),
  constraint program_submissions_change_type_check
    check (change_type = any (array['keep'::text, 'room'::text, 'time'::text, 'both'::text, 'new'::text])),
  constraint program_submissions_capacity_check
    check ((requested_capacity is null) or ((requested_capacity > 0) and (requested_capacity <= 10000))),
  constraint program_submissions_day_check
    check ((requested_day is null) or (requested_day = any (array['Monday'::text, 'Tuesday'::text, 'Wednesday'::text, 'Thursday'::text, 'Friday'::text, 'Saturday'::text, 'Sunday'::text])))
);

create index if not exists program_submissions_call_id_idx on public.program_submissions (call_id);

-- RLS with only the chambers_server policy, as in 0004: who may read or write
-- these rows is decided in the API routes (app/api/call-for-programs and
-- app/api/administrator/call-for-programs).

alter table public.program_calls enable row level security;
alter table public.program_submissions enable row level security;

grant select, insert, update, delete on public.program_calls to chambers_server;
grant select, insert, update, delete on public.program_submissions to chambers_server;

drop policy if exists chambers_server_all on public.program_calls;
create policy chambers_server_all on public.program_calls
  for all to chambers_server using (true) with check (true);

drop policy if exists chambers_server_all on public.program_submissions;
create policy chambers_server_all on public.program_submissions
  for all to chambers_server using (true) with check (true);
