import type { SupabaseClient } from '@supabase/supabase-js'

export type AuthedUser = {
  id: string
  email?: string
  /**
   * The token's `iat`, in epoch seconds, or null if absent.
   *
   * Carried so callers can tell when this session was minted. Compared against
   * users.sessions_revoked_at to refuse tokens issued before an admin revoked
   * someone's sessions: deleting the session rows stops the *refresh*, but the
   * access token already in their browser keeps verifying locally against the
   * JWKS until it expires. See getAuthedUserWithLiveRoles().
   */
  issuedAt: number | null
  /**
   * True only when the role fields below were re-read from the users table by
   * getAuthedUserWithLiveRoles(). Absent on a plain getAuthedUser(), where they
   * are whatever the token was stamped with and may be out of date.
   *
   * Shared code that grants privilege from app_metadata must require this rather
   * than trusting the fields directly -- see loadScopeContext() and
   * requireBookingManager(), both of which are reached from routes that use
   * either path.
   */
  rolesVerifiedLive?: true
  app_metadata: {
    is_admin?: boolean
    iems_role?: string
    admin_role?: string
    [key: string]: unknown
  }
}

/**
 * Whether this user's admin flag can be trusted to grant privilege.
 *
 * Fails closed: a token-derived user is treated as non-admin rather than as an
 * admin, so a caller that forgot to resolve live roles under-privileges instead
 * of over-privileging.
 */
export function hasLiveAdmin(user: AuthedUser): boolean {
  return user.rolesVerifiedLive === true && !!user.app_metadata?.is_admin
}

/**
 * Verifies the caller's JWT and returns a user-shaped object, or null when
 * there is no valid session.
 *
 * Uses getClaims() rather than getUser(). This project signs tokens with ES256
 * (asymmetric), so getClaims() verifies the signature locally against a cached
 * JWKS instead of making a network round trip to the Auth server on every call.
 * The signature is still cryptographically verified -- this is not the same as
 * trusting getSession(), which does no verification at all.
 *
 * The return shape intentionally mirrors the parts of getUser()'s `user` that
 * this app actually reads (`id` and `app_metadata`), so call sites stay
 * unchanged apart from the call itself.
 */
export async function getAuthedUser(
  supabase: SupabaseClient
): Promise<AuthedUser | null> {
  const { data, error } = await supabase.auth.getClaims()
  if (error || !data?.claims) return null

  const claims = data.claims
  if (typeof claims.sub !== 'string' || !claims.sub) return null

  return {
    id: claims.sub,
    email: typeof claims.email === 'string' ? claims.email : undefined,
    issuedAt: typeof claims.iat === 'number' ? claims.iat : null,
    app_metadata: (claims.app_metadata ?? {}) as AuthedUser['app_metadata'],
  }
}
