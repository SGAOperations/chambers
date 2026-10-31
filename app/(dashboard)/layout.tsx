import { redirect } from 'next/navigation'
import { resolveShellIdentity } from '@/lib/shell-identity'
import { sgauthEnabled, sgauthLogoutHref } from '@/lib/sgauth'
import DashboardShell from './dashboard-shell'
import ForceSignOut from './force-sign-out'

/**
 * Server layout for every dashboard route.
 *
 * This exists to move the session check off the browser's critical path. It used
 * to run as AuthGuard, a client component that held the content area behind a
 * skeleton while it did a JWKS fetch, a possible token refresh, and a
 * users + board_memberships read -- all cross-origin, all serial, and all only
 * startable once ~250 KB of JavaScript had downloaded, parsed and hydrated.
 *
 * Doing it here makes the document dynamic, which costs two in-region Postgres
 * reads on a warm pooled connection. In exchange the browser gets a shell that is
 * already populated and a page it can render the moment React mounts.
 *
 * Under SGAuth (SGAUTH_ENABLED) the proxy has already sent anyone without a
 * session cookie to sign in, so "unauthenticated" here means a cookie SGAuth
 * rejected; the landing page offers sign-in again. Sign-out is SGAuth's, and is
 * global, so the shell is given that link rather than ending a session itself.
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const result = await resolveShellIdentity()
  const sgauthSignOutHref = sgauthEnabled() ? await sgauthLogoutHref() : null

  if (result.status === 'unauthenticated') redirect('/')
  if (result.status === 'onboarding') redirect('/onboarding')
  if (result.status === 'deactivated') return <ForceSignOut sgauthSignOutHref={sgauthSignOutHref} />

  return (
    <DashboardShell identity={result.identity} sgauthSignOutHref={sgauthSignOutHref}>
      {children}
    </DashboardShell>
  )
}
