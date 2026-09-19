import { getAuthedUser } from '@/lib/auth'
import { pool } from '@/lib/db/pool'

/**
 * The per-user facts the dashboard shell needs, resolved on the server during the
 * document request instead of by the browser after hydration.
 *
 * This used to run client-side: DashboardLayout and AuthGuard each called
 * getAuthedUser() and then loadIdentity(). In the browser that is not cheap --
 * getClaims() has to fetch the JWKS from the Supabase origin (~150-260ms, and the
 * response carries no Cache-Control, so a fresh page load always pays it), on top
 * of a cross-origin TLS handshake to supabase.co, and only then can the
 * users + board_memberships read start. Every one of those round trips sat in
 * front of first paint, because AuthGuard held the page behind a skeleton until
 * they resolved.
 *
 * On the server the same work is two in-region Postgres reads on a connection the
 * instance already holds, and the result ships with the document -- so the shell
 * renders with the user's name already in the HTML and the page below it is
 * revealed as soon as React mounts.
 */
export interface ShellIdentity {
  userId: string
  fullName: string | null
  isLeadership: boolean
  isAdmin: boolean
  isIEMS: boolean
  /**
   * The caller's admin_role, or null. `isAdmin` only says whether there is one;
   * the Management page needs to know *which* (issue #64), and it is already in
   * the row this function reads.
   */
  adminRole: string | null
}

export type ShellIdentityResult =
  | { status: 'ok'; identity: ShellIdentity }
  | { status: 'unauthenticated' }
  | { status: 'deactivated' }
  | { status: 'onboarding' }

/**
 * Returns the caller's shell identity, or which redirect the layout should take.
 *
 * The outcome is returned rather than acted on here: next/navigation's redirect()
 * works by throwing, and keeping that throw in the layout (where there is no
 * try/catch around it) makes the control flow obvious at the call site.
 */
export async function resolveShellIdentity(): Promise<ShellIdentityResult> {
  const user = await getAuthedUser()
  if (!user) return { status: 'unauthenticated' }

  const [{ rows: profiles }, { rows: memberships }] = await Promise.all([
    pool.query<{
      is_active: boolean | null
      has_completed_onboarding: boolean
      full_name: string | null
      admin_role: string | null
      iems_role: string | null
    }>(
      'select is_active, has_completed_onboarding, full_name, admin_role, iems_role from public.users where id = $1',
      [user.id]
    ),
    pool.query<{ role: string }>('select role from public.board_memberships where user_id = $1', [user.id]),
  ])
  const profile = profiles[0]

  if (!profile) return { status: 'unauthenticated' }
  if (!profile.is_active) return { status: 'deactivated' }
  if (!profile.has_completed_onboarding) return { status: 'onboarding' }

  return {
    status: 'ok',
    identity: {
      userId: user.id,
      fullName: profile.full_name ?? null,
      isLeadership: memberships.some(m => m.role === 'Leadership'),
      // Read from `users`, not from the JWT's app_metadata.
      //
      // Both describe the same fact, but app_metadata is a copy stamped into the
      // access token when it was issued. Granting or revoking a role updates the
      // users row and the auth metadata, and neither touches a token already in
      // someone's browser -- so an admin whose role was revoked kept passing
      // `app_metadata.is_admin` until their token expired (an hour by default) or
      // they signed out. The users row is the fact itself, and this query is
      // already being made, so consulting it costs nothing.
      //
      // Since #136 there is no token copy at all: roles only ever come from here.
      //
      isAdmin: !!profile.admin_role,
      isIEMS: !!profile.iems_role,
      adminRole: profile.admin_role ?? null,
    },
  }
}
