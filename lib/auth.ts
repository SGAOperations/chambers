import { headers } from 'next/headers'
import { auth } from './better-auth'
import { resolveSgauthUser, sgauthEnabled, sgauthSessionUsable } from './sgauth'
import type { AuthedUser } from './auth-types'

export { hasLiveAdmin, type AuthedUser } from './auth-types'

/**
 * The signed-in user for this request, or null when there is no valid session.
 *
 * Server-only. With SGAUTH_ENABLED on, the session is SGAuth's and `id` is the
 * Chambers users.id it is linked to (lib/sgauth.ts), so every caller keeps
 * working with the id every Chambers table references. Someone deactivated in
 * SGAuth has no session, so they are null here within the SDK's minute-long
 * cache; Chambers' own users.is_active is not read under the flag (#152).
 *
 * With the flag off, it reads the Better Auth session cookie and checks the
 * session against auth_sessions, so an expired, signed-out or revoked session
 * is null here on its very next use.
 *
 * The argument is ignored. It used to be the Supabase client whose cookies held
 * the session, and is still accepted so call sites did not all have to change in
 * the same PR as the login itself (issue #136); drop it as those call sites move
 * off Supabase.
 */
export async function getAuthedUser(_legacyClient?: unknown): Promise<AuthedUser | null> {
  if (sgauthEnabled()) {
    const result = await resolveSgauthUser()
    if (!sgauthSessionUsable(result)) return null
    const created = Date.parse(result.session.session.createdAt)
    return {
      id: result.user.id,
      email: result.user.email,
      issuedAt: Number.isFinite(created) ? Math.floor(created / 1000) : null,
      app_metadata: {},
    }
  }

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
