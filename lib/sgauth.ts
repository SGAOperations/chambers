import { cache } from 'react'
import { headers } from 'next/headers'
import { createSgauthClient, type SgaSession } from '@nusgaops/sgauth'
import { loginUrl, logoutUrl } from '@nusgaops/sgauth/urls'
import { pool } from './db/pool'

/**
 * Chambers' sign-in through SGAuth (issues #149, #150), behind SGAUTH_ENABLED.
 *
 * Server-only. While the flag is off nothing here runs and Better Auth
 * (lib/better-auth.ts) is the login, exactly as before. With it on, the session
 * comes from SGAuth's cookie on northeasternsga.com and Chambers' own login,
 * signup, reset and invite-password flows step aside. The flag is the rollback:
 * turning it off puts Better Auth back without a deploy of different code.
 *
 * What does not change with the flag: users.id stays the key every row in
 * Chambers points at, and roles still come from users.admin_role / iems_role
 * (lib/authorization.ts) until #151 moves them to positions. SGAuth decides who
 * someone is; Chambers still decides what they may do.
 */

/** True when Chambers signs people in through SGAuth. Read per call so a test can flip it. */
export function sgauthEnabled(): boolean {
  return process.env.SGAUTH_ENABLED === 'true'
}

/**
 * The SDK client. Built on first use, not at import, because SGAUTH_URL is only
 * required once the flag is on -- building it eagerly would throw
 * SgauthConfigError on every deployment that has not been cut over.
 *
 * onError is the SDK's report of an SGAuth outage or timeout. It never carries
 * the cookie or the token, and neither does this log line.
 */
let client: ReturnType<typeof createSgauthClient> | null = null
function sgauthClient() {
  client ??= createSgauthClient({
    onError: ({ kind, status, servedStale }) =>
      console.warn('sgauth upstream failure', { kind, status, servedStale }),
  })
  return client
}

/**
 * The SGAuth session for this request, or null. One lookup per request however
 * many callers ask (React's cache), and the SDK caches across requests for 60 s.
 */
export const getSgauthSession = cache(async (): Promise<SgaSession | null> => {
  if (!sgauthEnabled()) return null
  return sgauthClient().getSession({ headers: await headers() })
})

/** The Chambers row an SGAuth session resolves to. */
export type SgauthUserRow = {
  id: string
  email: string
  is_active: boolean
}

export type SgauthUserResult =
  | { status: 'none' }
  | { status: 'ok'; session: SgaSession; user: SgauthUserRow }

const ROW = 'id, email, coalesce(is_active, true) as is_active'

/**
 * The Chambers user behind this request's SGAuth session, linking or creating
 * the row on first sign-in.
 *
 * In order:
 *   1. the row already linked to this SGAuth id;
 *   2. an unlinked row with the same lower-cased email -- someone who was in
 *      Chambers before SGAuth but whom the import's id-map did not cover
 *      (scripts/sgauth/link-users.mjs links the rest ahead of time);
 *   3. a new row, for someone SGAuth knows and Chambers does not yet. They have
 *      no roles and no memberships, and go through onboarding.
 *
 * A deactivated Chambers row still resolves, with is_active false: callers
 * decide what that means (getAuthedUser refuses it; the dashboard shows why).
 *
 * `none` when there is no valid session, or in the one case that needs a person:
 * the email belongs to a row already linked to a *different* SGAuth account.
 * That is logged with ids only and treated as signed out rather than guessed at.
 */
export const resolveSgauthUser = cache(async (): Promise<SgauthUserResult> => {
  const session = await getSgauthSession()
  if (!session) return { status: 'none' }

  const sgauthId = session.user.id
  const email = session.user.email.trim().toLowerCase()

  const linked = await pool.query<SgauthUserRow>(
    `select ${ROW} from public.users where sgauth_user_id = $1`,
    [sgauthId]
  )
  if (linked.rows[0]) return { status: 'ok', session, user: linked.rows[0] }

  const byEmail = await pool.query<SgauthUserRow>(
    `update public.users set sgauth_user_id = $1
       where email = $2 and sgauth_user_id is null
       returning ${ROW}`,
    [sgauthId, email]
  )
  if (byEmail.rows[0]) return { status: 'ok', session, user: byEmail.rows[0] }

  // Two first requests can race to here. The insert does nothing on either
  // unique key, and the re-read below picks up whichever row won.
  const created = await pool.query<SgauthUserRow>(
    `insert into public.users (email, full_name, sgauth_user_id)
       values ($1, $2, $3)
       on conflict do nothing
       returning ${ROW}`,
    [email, session.user.name?.trim() || email.split('@')[0], sgauthId]
  )
  if (created.rows[0]) return { status: 'ok', session, user: created.rows[0] }

  const reread = await pool.query<SgauthUserRow>(
    `select ${ROW} from public.users where sgauth_user_id = $1`,
    [sgauthId]
  )
  if (reread.rows[0]) return { status: 'ok', session, user: reread.rows[0] }

  const holder = await pool.query<{ id: string }>('select id from public.users where email = $1', [email])
  console.error('sgauth: email already linked to another SGAuth account', {
    chambersId: holder.rows[0]?.id ?? null,
    sgauthId,
  })
  return { status: 'none' }
})

/**
 * Whether this session may be used for a Chambers row: the row is active.
 *
 * users.sessions_revoked_at is deliberately not consulted. Chambers cannot end
 * an SGAuth session -- it is shared by every SGA tool -- and Management stamps
 * that column on every role change, so comparing it with the SGAuth session's
 * age would lock out anyone who signed in to SGAuth before their last Chambers
 * role change, with no way back in. Deactivation is what "may not use Chambers"
 * means here, and it is read live; revoking SGAuth sessions is SGAuth's job
 * (#152).
 */
export function sgauthSessionUsable(result: SgauthUserResult): result is Extract<SgauthUserResult, { status: 'ok' }> {
  return result.status === 'ok' && result.user.is_active
}

/** This deployment's public origin, for SGAuth to send people back to. */
export function chambersOrigin(requestHeaders: Headers): string {
  const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'chambers.northeasternsga.com'
  const proto = requestHeaders.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
  return `${proto}://${host}`
}

/** SGAuth sign-in, returning to `path` on this deployment afterwards. */
export async function sgauthLoginHref(path = '/'): Promise<string> {
  return loginUrl(chambersOrigin(await headers()) + path)
}

/**
 * SGAuth sign-out, returning to Chambers' landing page. Global: there is one
 * SGAuth session, so this signs the user out of every SGA tool. Render it as a
 * plain <a> or a location change, never a prefetching <Link>.
 */
export async function sgauthLogoutHref(): Promise<string> {
  return logoutUrl(chambersOrigin(await headers()) + '/')
}

/**
 * The answer from a Chambers account route that SGAuth replaces under the flag
 * -- signup, invite passwords, resending an invite. 410 rather than 404: the
 * route exists, it is just no longer how this is done.
 */
export function replacedBySgauth(): Response {
  return Response.json(
    { error: 'Accounts and passwords are managed in your SGA account now.' },
    { status: 410 }
  )
}
