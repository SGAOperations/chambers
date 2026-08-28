'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useIdentity } from './identity-context'

/**
 * Admin-only gate.
 *
 * The check is synchronous: the server already resolved this user's identity and
 * shipped it with the document, so there is no round trip to wait on and no
 * skeleton to show. (This previously called getAuthedUser() on mount, which meant
 * a JWKS fetch against the Supabase origin before /administrator could paint.)
 *
 * The redirect still has to happen in an effect -- router.push() during render is
 * not allowed -- but rendering nothing while it runs is correct here: a non-admin
 * should never see this content, not even for a frame.
 */
export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useIdentity()
  const router = useRouter()

  useEffect(() => {
    if (!isAdmin) router.replace('/my-rooms')
  }, [isAdmin, router])

  if (!isAdmin) return null

  return <>{children}</>
}
