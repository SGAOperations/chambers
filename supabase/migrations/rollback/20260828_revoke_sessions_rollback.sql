-- Rollback for 20260828001000_revoke_sessions_on_role_change.sql.
--
-- Drops the function and the column. Any session already revoked stays revoked --
-- those rows are gone from auth.sessions and cannot be restored -- but nothing
-- further will be cut off, and tokens issued before a past revocation stop being
-- refused once the column is gone.

drop function if exists public.revoke_user_sessions(uuid);

alter table public.users
  drop column if exists sessions_revoked_at;
