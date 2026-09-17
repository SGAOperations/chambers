import { headers } from 'next/headers'
import { auth } from './better-auth'

export type AuthedUser = {
  id: string
  email?: string
  /**
   * When this session was created, in epoch seconds, or null if unknown.
   *
   * Compared against users.sessions_revoked_at in getAuthedUserWithLiveRoles().
   * Revoking deletes the sessions outright now (lib/auth-admin.ts), so this is a
   * second lock rather than the only one: a session created before the stamp is
   * refused even if its row somehow survived.
   */
  issuedAt: number | null
  /**
   * True only when the role fields below were read from the users table by
   * getAuthedUserWithLiveRoles(). Absent on a plain getAuthedUser(), where
   * app_metadata is empty.
   *
   * Shared code that grants privilege from app_metadata must require this -- see
   * loadScopeContext() and requireBookingManager().
   */
  rolesVerifiedLive?: true
  /**
   * The caller's roles, under the name Supabase gave them.
   *
   * Under Supabase Auth these were copied into the access token. Better Auth
   * carries no such copy, so they are only ever filled from the users row, by
   * getAuthedUserWithLiveRoles(). The name is kept so the thirty-odd routes that
   * read `user.app_metadata?.is_admin` did not all have to change with the
   * migration (issue #136).
   */
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
 * Fails closed: a user whose roles were not read live is treated as non-admin.
 */
export function hasLiveAdmin(user: AuthedUser): boolean {
  return user.rolesVerifiedLive === true && !!user.app_metadata?.is_admin
}

/**
 * The signed-in user for this request, or null when there is no valid session.
 *
 * Server-only. Reads the Better Auth session cookie and checks the session
 * against auth_sessions, so an expired, signed-out or revoked session is null
 * here on its very next use.
 *
 * The argument is ignored. It used to be the Supabase client whose cookies held
 * the session, and is still accepted so call sites did not all have to change in
 * the same PR as the login itself (issue #136); drop it as those call sites move
 * off Supabase.
 */
export async function getAuthedUser(_legacyClient?: unknown): Promise<AuthedUser | null> {
  const session = await auth.api.getSession({ headers: await headers() })
  if (!session) return null

  const created = new Date(session.session.createdAt).getTime()
  return {
    id: session.user.id,
    email: session.user.email,
    issuedAt: Number.isFinite(created) ? Math.floor(created / 1000) : null,
    app_metadata: {},
  }
}
