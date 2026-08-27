-- Pending-action severity thresholds (issue #38).
--
-- The admin "Pending Actions" total stops being a flat count: each pending item
-- now carries a severity (regular / warning / danger) derived from how close its
-- deadline is. The Danger Range per source, and the warning lead time, live here
-- so admins can tune them in Administrator -> Advanced -> Other Settings without
-- a deploy.
--
-- All values are whole days. A "_start" is the far edge of the Danger Range
-- (larger number of days out); severity becomes "danger" once daysUntil <= start
-- and, per product decision, stays danger after the range passes. "warning"
-- covers the pa_warning_lead_days window immediately before the range opens.
-- The "_end" values are the near edge, stored for display and future use.
--
-- Single-row table (id = 1), so the defaults backfill immediately and nothing
-- that reads app_settings today references these columns.

alter table app_settings
  add column if not exists pa_warning_lead_days                integer not null default 7,
  add column if not exists pa_event_trigger_weeks              integer not null default 10,
  add column if not exists pa_request_room_danger_start        integer not null default 17,
  add column if not exists pa_request_room_danger_end          integer not null default 11,
  add column if not exists pa_request_tabling_danger_start     integer not null default 17,
  add column if not exists pa_request_tabling_danger_end       integer not null default 14,
  add column if not exists pa_revision_danger_start            integer not null default 17,
  add column if not exists pa_revision_danger_end              integer not null default 11,
  add column if not exists pa_cancellation_regular_danger_days integer not null default 0,
  add column if not exists pa_cancellation_event_danger_start  integer not null default 21,
  add column if not exists pa_cancellation_event_danger_end    integer not null default 14,
  add column if not exists pa_event_mgmt_danger_start          integer not null default 35,
  add column if not exists pa_event_mgmt_danger_end            integer not null default 28,
  add column if not exists pa_event_engage_danger_start        integer not null default 28,
  add column if not exists pa_event_engage_danger_end          integer not null default 21;
