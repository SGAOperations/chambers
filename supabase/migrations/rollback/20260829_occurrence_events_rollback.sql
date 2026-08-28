-- Rollback for 20260829001000_occurrence_events.sql.
--
-- Deletes occurrence-level checklists before restoring booking_id as the primary
-- key, since several of them can share a booking_id and the key would not build
-- otherwise. Those rows are the ones whose occurrence_date is not null; the
-- booking-level rows that one-time and tabling events use are left alone.
--
-- Weekly occurrences also stop being markable as events, so any weekly event
-- disappears from the Events tab.

delete from public.event_tracking where occurrence_date is not null;

alter table public.event_tracking drop constraint if exists event_tracking_target_key;
alter table public.event_tracking drop constraint if exists event_tracking_pkey;
alter table public.event_tracking drop column if exists id;
alter table public.event_tracking drop column if exists occurrence_date;
alter table public.event_tracking add constraint event_tracking_pkey primary key (booking_id);

alter table public.weekly_room_occurrences drop column if exists is_event;
