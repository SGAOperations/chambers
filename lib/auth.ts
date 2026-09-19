import { headers } from 'next/headers'
import { auth } from './better-auth'
import type { AuthedUser } from './auth-types'

export { hasLiveAdmin, type AuthedUser } from './auth-types'

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
