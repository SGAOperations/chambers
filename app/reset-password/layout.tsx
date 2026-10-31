import { redirect } from 'next/navigation'
import { sgauthEnabled, sgauthLoginHref } from '@/lib/sgauth'

/**
 * Under SGAuth (SGAUTH_ENABLED) accounts and passwords are SGAuth's, so this
 * page has nothing to do: it hands over to SGAuth's sign-in, which also offers
 * sign-up and "forgot password" (issue #149). With the flag off, the page below
 * is Chambers' own, as before.
 */
export default async function Layout({ children }: { children: React.ReactNode }) {
  if (sgauthEnabled()) redirect(await sgauthLoginHref('/'))
  return children
}
