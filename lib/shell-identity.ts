import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'

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
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return { status: 'unauthenticated' }

  const [{ data: profile }, { data: memberships }] = await Promise.all([
    supabase
      .from('users')
      .select('is_active, has_completed_onboarding, full_name')
      .eq('id', user.id)
      .single(),
    supabase.from('board_memberships').select('role').eq('user_id', user.id),
  ])

  if (!profile) return { status: 'unauthenticated' }
  if (!profile.is_active) return { status: 'deactivated' }
  if (!profile.has_completed_onboarding) return { status: 'onboarding' }

  return {
    status: 'ok',
    identity: {
      userId: user.id,
      fullName: profile.full_name ?? null,
      isLeadership: (memberships ?? []).some(
        (m: { role: string }) => m.role === 'Leadership'
      ),
      isAdmin: !!user.app_metadata?.is_admin,
      isIEMS: !!user.app_metadata?.iems_role,
    },
  }
}
