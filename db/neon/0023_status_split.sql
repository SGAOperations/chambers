-- Split a booking's status into a meeting status and an ops status (issue #281,
-- epic #279; design revised in the epic's comments).
--
-- Every reservation's single `status` answers two questions: is the body
-- meeting, and where (members, calendars, reminders, the display), and what
-- happened to the room (Operational Affairs, CSC, the Comptroller). This adds
-- one column for each, plus a flag for meeting online:
--
--   meeting_status  owned by the body: Scheduled, Alternate Room, Alternate
--                   Time, Alternate Room and Time, Cancelled, Tentative.
--                   Null only on rows whose meeting was never recorded
--                   (backfilled Unavailable, Missed and Repurposed).
--   is_virtual      whether the meeting is online. A meeting that moves online
--                   stays Scheduled; going virtual releases the room the way a
--                   cancellation does.
--   ops_status      owned by Operational Affairs: Reserved, Tentative,
--                   Waitlisted, Unavailable, Pending Cancellation, Cancelled,
--                   Missed, Repurposed.
--
-- On weekly_room_occurrences all three are overrides where null means "the
-- series'", each independently, as `status` is today.
--
-- This is the expand step. `status` is unchanged and still authoritative, and
-- nothing reads the new columns yet. Until the writers set them (#282), a
-- trigger derives all three from `status` on every insert and every write to
-- `status`, so they never drift. The backfill at the bottom is that same
-- trigger fired over every existing row. #282 drops the trigger in the same
-- release that teaches the writers to set the columns themselves.
--
-- The mapping, in public.status_split_of():
--
--   status                  meeting_status   is_virtual  ops_status
--   Reserved                Scheduled        false       Reserved
--   Alternate Room/Time/..  (the same)       false       Reserved
--   Waitlisted              Scheduled        false       Waitlisted
--   Tentative               Tentative        false       Tentative
--   Pending Cancellation    Cancelled        false       Pending Cancellation
--     ...request Virtual    Scheduled        true        Pending Cancellation
--   Cancelled               Cancelled        false       Cancelled
--   Virtual                 Scheduled        true        Cancelled
--   Unavailable             null             false       Unavailable
--   Missed                  null             false       Missed
--   Repurposed              null             false       Repurposed
--   null                    null             null        null
--
-- "request Virtual" is the cancellation_type of the request behind the row,
-- matched the way Auto-Cancel matches it (lib/pending-cancellations.ts
-- collectPending): public.status_split_request_type().
--
-- Apply with scripts/neon/apply-file.mjs, then **refresh the Data API schema
-- cache** (db/neon/README.md). Preview what the backfill will write first with
-- scripts/neon/status-split-preview.mjs.
--
-- To undo:
--   drop trigger if exists status_split on public.one_time_room_bookings;
--   drop trigger if exists status_split on public.weekly_room_bookings;
--   drop trigger if exists status_split on public.weekly_room_occurrences;
--   drop trigger if exists status_split on public.tabling_sessions;
--   drop function if exists public.status_split_trigger();
--   drop function if exists public.status_split_of(text, text);
--   drop function if exists public.status_split_request_type(text, uuid, uuid, date);
--   alter table public.<each of the four> drop column if exists meeting_status,
--     drop column if exists is_virtual, drop column if exists ops_status;
--   alter table public.cancellation_requests drop column if exists previous_meeting_status,
--     drop column if exists previous_is_virtual, drop column if exists previous_ops_status;

-- ─── Columns ─────────────────────────────────────────────────────────────────

alter table public.one_time_room_bookings
  add column if not exists meeting_status text default 'Scheduled',
  add column if not exists is_virtual boolean not null default false,
  add column if not exists ops_status text default 'Reserved';

alter table public.weekly_room_bookings
  add column if not exists meeting_status text default 'Scheduled',
  add column if not exists is_virtual boolean not null default false,
  add column if not exists ops_status text default 'Reserved';

alter table public.tabling_sessions
  add column if not exists meeting_status text default 'Scheduled',
  add column if not exists is_virtual boolean not null default false,
  add column if not exists ops_status text default 'Reserved';

-- Overrides: no defaults, null inherits the series.
alter table public.weekly_room_occurrences
  add column if not exists meeting_status text,
  add column if not exists is_virtual boolean,
  add column if not exists ops_status text;

do $$
declare
  t text;
begin
  foreach t in array array['one_time_room_bookings', 'weekly_room_bookings', 'weekly_room_occurrences', 'tabling_sessions'] loop
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_meeting_status_check');
    execute format(
      'alter table public.%I add constraint %I check (meeting_status = any (array[%L, %L, %L, %L, %L, %L]))',
      t, t || '_meeting_status_check',
      'Scheduled', 'Alternate Room', 'Alternate Time', 'Alternate Room and Time', 'Cancelled', 'Tentative'
    );
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_ops_status_check');
    execute format(
      'alter table public.%I add constraint %I check (ops_status = any (array[%L, %L, %L, %L, %L, %L, %L, %L]))',
      t, t || '_ops_status_check',
      'Reserved', 'Tentative', 'Waitlisted', 'Unavailable', 'Pending Cancellation', 'Cancelled', 'Missed', 'Repurposed'
    );
  end loop;
end $$;

-- What a request moved the booking from, so dismissing it can put all three
-- back (#282). Null on requests filed before this, which never recorded it.
alter table public.cancellation_requests
  add column if not exists previous_meeting_status text,
  add column if not exists previous_is_virtual boolean,
  add column if not exists previous_ops_status text;

alter table public.cancellation_requests drop constraint if exists cancellation_requests_previous_meeting_status_check;
alter table public.cancellation_requests add constraint cancellation_requests_previous_meeting_status_check
  check (previous_meeting_status = any (array['Scheduled', 'Alternate Room', 'Alternate Time', 'Alternate Room and Time', 'Cancelled', 'Tentative']));
alter table public.cancellation_requests drop constraint if exists cancellation_requests_previous_ops_status_check;
alter table public.cancellation_requests add constraint cancellation_requests_previous_ops_status_check
  check (previous_ops_status = any (array['Reserved', 'Tentative', 'Waitlisted', 'Unavailable', 'Pending Cancellation', 'Cancelled', 'Missed', 'Repurposed']));

-- ─── The mapping ─────────────────────────────────────────────────────────────

-- The three new values for one old status. `request_type` is the
-- cancellation_type behind a Pending Cancellation row, and only read for one.
-- lib/booking-status.ts splitStatus() is the same table in TypeScript, and
-- tests/status-split.test.ts checks the two agree on every status.
create or replace function public.status_split_of(
  status text,
  request_type text,
  out meeting_status text,
  out is_virtual boolean,
  out ops_status text
)
language sql immutable
as $$
  select
    case status
      when 'Reserved' then 'Scheduled'
      when 'Alternate Room' then 'Alternate Room'
      when 'Alternate Time' then 'Alternate Time'
      when 'Alternate Room and Time' then 'Alternate Room and Time'
      when 'Waitlisted' then 'Scheduled'
      when 'Tentative' then 'Tentative'
      when 'Pending Cancellation' then case when request_type = 'Virtual' then 'Scheduled' else 'Cancelled' end
      when 'Cancelled' then 'Cancelled'
      when 'Virtual' then 'Scheduled'
      else null
    end,
    case
      when status is null then null
      when status = 'Virtual' then true
      when status = 'Pending Cancellation' then coalesce(request_type = 'Virtual', false)
      else false
    end,
    case status
      when 'Reserved' then 'Reserved'
      when 'Alternate Room' then 'Reserved'
      when 'Alternate Time' then 'Reserved'
      when 'Alternate Room and Time' then 'Reserved'
      when 'Virtual' then 'Cancelled'
      else status
    end
$$;

-- The cancellation_type of the request behind a row, matched as Auto-Cancel
-- matches it (lib/pending-cancellations.ts collectPending). Each kind of row
-- tries its lookups in order, and within a lookup a Pending request beats a
-- resolved one and the newest beats the rest:
--
--   'dated'       a one-time booking or tabling session: the request naming its
--                 (booking, date), else any request on the booking.
--   'occurrence'  one week of a weekly series: the request naming its row, else
--                 its (booking, date), else a series-scoped request.
--   'series'      the weekly series row itself: a series-scoped request, else
--                 any request on the booking.
--
-- Null when nothing matches, which status_split_of reads as a cancellation --
-- the same default Auto-Cancel applies.
create or replace function public.status_split_request_type(kind text, row_id uuid, booking uuid, on_date date)
returns text
language sql stable
as $$
  select m.cancellation_type
    from (
      select r.cancellation_type, r.status, r.created_at,
             case
               when kind = 'occurrence' and r.occurrence_id = row_id then 1
               when kind in ('dated', 'occurrence') and r.booking_id = booking and r.occurrence_date = on_date then 2
               when kind in ('occurrence', 'series') and r.booking_id = booking and r.scope = 'series' then 3
               when kind in ('dated', 'series') and r.booking_id = booking then 4
             end as rank
        from public.cancellation_requests r
       where r.booking_id = booking
          or (kind = 'occurrence' and r.occurrence_id = row_id)
    ) m
   -- A week is never matched by another week's request: Auto-Cancel has no
   -- booking-wide fallback for occurrences, so neither does this.
   where m.rank is not null
   order by m.rank, (m.status = 'Pending') desc, m.created_at desc
   limit 1
$$;

-- Keeps the three columns derived from `status` while `status` is the one the
-- writers set. Only looks up a request for a Pending Cancellation row; the
-- request is always inserted before the status moves (lib/cancellation-request.ts,
-- app/api/nusso/cancel), so it is there to be found.
create or replace function public.status_split_trigger()
returns trigger
language plpgsql
as $$
declare
  request_type text;
  split record;
begin
  -- IF rather than CASE: plpgsql resolves every new.<field> in an expression,
  -- including branches for other tables, and each table has only its own.
  if new.status = 'Pending Cancellation' then
    if tg_table_name = 'one_time_room_bookings' then
      request_type := public.status_split_request_type('dated', new.id, new.booking_id, new.booking_date);
    elsif tg_table_name = 'tabling_sessions' then
      request_type := public.status_split_request_type('dated', new.id,
        (select tb.booking_id from public.tabling_bookings tb where tb.id = new.tabling_booking_id),
        new.session_date);
    elsif tg_table_name = 'weekly_room_occurrences' then
      request_type := public.status_split_request_type('occurrence', new.id,
        (select w.booking_id from public.weekly_room_bookings w where w.id = new.weekly_booking_id),
        new.occurrence_date);
    elsif tg_table_name = 'weekly_room_bookings' then
      request_type := public.status_split_request_type('series', new.id, new.booking_id, null);
    end if;
  end if;

  split := public.status_split_of(new.status, request_type);
  new.meeting_status := split.meeting_status;
  new.ops_status := split.ops_status;
  -- Not null outside occurrences, where a row with no status is not virtual.
  new.is_virtual := case
    when tg_table_name = 'weekly_room_occurrences' then split.is_virtual
    else coalesce(split.is_virtual, false)
  end;
  return new;
end;
$$;

-- None of these is for calling through the Data API.
revoke all on function public.status_split_of(text, text) from public;
revoke all on function public.status_split_request_type(text, uuid, uuid, date) from public;
revoke all on function public.status_split_trigger() from public;

drop trigger if exists status_split on public.one_time_room_bookings;
create trigger status_split before insert or update of status on public.one_time_room_bookings
  for each row execute function public.status_split_trigger();
drop trigger if exists status_split on public.weekly_room_bookings;
create trigger status_split before insert or update of status on public.weekly_room_bookings
  for each row execute function public.status_split_trigger();
drop trigger if exists status_split on public.weekly_room_occurrences;
create trigger status_split before insert or update of status on public.weekly_room_occurrences
  for each row execute function public.status_split_trigger();
drop trigger if exists status_split on public.tabling_sessions;
create trigger status_split before insert or update of status on public.tabling_sessions
  for each row execute function public.status_split_trigger();

-- ─── Backfill ────────────────────────────────────────────────────────────────

-- Fires the trigger over every row, so the backfill and every later write go
-- through one mapping. `status` itself is written back unchanged. Re-running
-- this file is safe: it derives the same values again.
update public.one_time_room_bookings set status = status;
update public.weekly_room_bookings set status = status;
update public.weekly_room_occurrences set status = status;
update public.tabling_sessions set status = status;

do $$
declare
  t text;
  n bigint;
  summary text := '';
begin
  foreach t in array array['one_time_room_bookings', 'weekly_room_bookings', 'weekly_room_occurrences', 'tabling_sessions'] loop
    execute format('select count(*) from public.%I', t) into n;
    summary := summary || format('%s %s, ', t, n);
  end loop;
  raise notice 'status split backfilled: %', rtrim(summary, ', ');
end $$;
