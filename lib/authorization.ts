import type { SupabaseClient } from '@supabase/supabase-js'
import { getAuthedUser, type AuthedUser } from './auth'

/**
 * getAuthedUser(), but with the role fields refreshed from the users table.
 *
 * Routes decide what a caller may do by reading app_metadata off the verified
 * JWT:
 *
 *   if (!user || !user.app_metadata?.is_admin) return 401
 *
 * The signature check behind that is sound. The payload is the problem:
 * app_metadata is a copy stamped into the access token when it was issued, and
 * granting or revoking a role writes the users row and the auth metadata without
 * touching a token already sitting in someone's browser. A revoked admin kept
 * passing that check until their token expired -- an hour by default, longer if
 * the tab kept refreshing it.
 *
 * This returns the same AuthedUser shape with is_admin / admin_role / iems_role
 * overwritten from the row, so every existing call site becomes live without
 * changing its control flow. That is deliberate: it makes this a one-line swap
 * per route rather than a rewrite of thirty authorization branches, which is a
 * much smaller surface for a mistake in exactly the code where a mistake is
 * expensive.
 *
 * The values are no longer literally "metadata from the token", despite the field
 * name. They are what the token's copy was always meant to reflect.
 *
 * Deactivated users resolve to null, so `!user` already denies them everywhere and
 * `is_active = false` revokes access outright rather than only hiding the UI.
 *
 * Cost is one primary-key lookup. Use it on routes that make an authorization
 * decision, not on hot read paths that merely need the caller's id -- /api/my-rooms
 * keeps plain getAuthedUser() for that reason.
 */
export async function getAuthedUserWithLiveRoles(
  supabase: SupabaseClient
): Promise<AuthedUser | null> {
  const user = await getAuthedUser(supabase)
  if (!user) return null

  // The RLS-scoped client is correct here: this reads only the caller's own row,
  // which users_select_admin_or_own already permits without admin rights.
  const { data: profile } = await supabase
    .from('users')
    .select('admin_role, iems_role, is_active, sessions_revoked_at')
    .eq('id', user.id)
    .single()

  if (!profile || !profile.is_active) return null

  // Refuse a token minted before this user's sessions were revoked.
  //
  // revoke_user_sessions() deletes the session rows, which stops the refresh --
  // but the access token already in their browser is ES256 and verified locally
  // against a cached JWKS, so it keeps passing until it expires. Without this
  // comparison, revoking someone would take up to another hour to bite.
  //
  // `iat` is whole seconds, so the stamp is floored before comparing, and the
  // test is strict: a token minted in the same second as the revocation is let
  // through. That avoids rejecting the fresh token of someone who signs straight
  // back in, and the window it opens is one second wide against an attacker who
  // would have had to re-authenticate inside it -- at which point they hold a
  // legitimate session anyway.
  if (profile.sessions_revoked_at) {
    const revokedAtSeconds = Math.floor(
      new Date(profile.sessions_revoked_at).getTime() / 1000
    )
    if (user.issuedAt === null || user.issuedAt < revokedAtSeconds) return null
  }

  return {
    ...user,
    app_metadata: {
      ...user.app_metadata,
      is_admin: !!profile.admin_role,
      admin_role: profile.admin_role ?? undefined,
      iems_role: profile.iems_role ?? undefined,
    },
  }
}
