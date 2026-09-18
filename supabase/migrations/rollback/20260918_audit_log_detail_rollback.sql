-- Rollback for the audit_log_detail migration (issue #120).
--
-- Drops the detail columns. Every entry keeps its new_status, so the Audit tab
-- goes back to showing one status per row, which is what it showed before. The
-- per-week and per-session detail recorded since is lost.

drop index if exists public.audit_logs_booking_created_idx;

alter table public.audit_logs
  drop constraint if exists audit_logs_target_check,
  drop constraint if exists audit_logs_action_check;

alter table public.audit_logs
  drop column if exists target,
  drop column if exists target_date,
  drop column if exists action,
  drop column if exists changes;
