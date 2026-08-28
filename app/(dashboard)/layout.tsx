import { redirect } from 'next/navigation'
import { resolveShellIdentity } from '@/lib/shell-identity'
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
 */
export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const result = await resolveShellIdentity()

  if (result.status === 'unauthenticated') redirect('/')
  if (result.status === 'onboarding') redirect('/onboarding')
  if (result.status === 'deactivated') return <ForceSignOut />

  return <DashboardShell identity={result.identity}>{children}</DashboardShell>
}
