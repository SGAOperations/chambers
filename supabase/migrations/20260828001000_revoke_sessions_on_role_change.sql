-- Kick a user out of every session, immediately, when their role is revoked.
--
-- 20260828000000 made each authorization *check* read the users table, so a
-- revoked admin stops being an admin on their next request. This goes further and
-- ends the session outright.
--
-- Deleting the session rows alone is not enough, and the reason is worth stating
-- because it is easy to get wrong. Access tokens here are ES256 and verified
-- locally against a cached JWKS -- no call to the auth server -- so a token whose
-- session has been deleted still passes signature verification until it expires.
-- Deleting auth.sessions kills the *refresh*, which means the user is out within
-- the access token's lifetime (an hour by default), not at once.
--
-- To make it immediate, revocation also stamps users.sessions_revoked_at, and the
-- app rejects any token issued before that stamp. The JWT's `iat` is already in
-- the verified payload and the app already reads this row for the caller's roles,
-- so the check costs nothing extra. See getAuthedUserWithLiveRoles().

alter table public.users
  add column if not exists sessions_revoked_at timestamptz;

comment on column public.users.sessions_revoked_at is
  'Access tokens issued before this instant are refused. Set by revoke_user_sessions().';

-- SECURITY DEFINER because the auth schema is not reachable by the API roles, and
-- deliberately not granted to `authenticated`: only trusted server code may call
-- it, via the service-role client.
create or replace function public.revoke_user_sessions(target uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'auth', 'pg_temp'
as $$
begin
  -- refresh_tokens.user_id is varchar in GoTrue's schema, unlike sessions.user_id.
  delete from auth.refresh_tokens where user_id = target::text;
  delete from auth.sessions where user_id = target;

  update public.users
     set sessions_revoked_at = now()
   where id = target;
end;
$$;

revoke all on function public.revoke_user_sessions(uuid) from public;
revoke all on function public.revoke_user_sessions(uuid) from anon;
revoke all on function public.revoke_user_sessions(uuid) from authenticated;
grant execute on function public.revoke_user_sessions(uuid) to service_role;
