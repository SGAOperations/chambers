'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useIdentity } from './identity-context'

/**
 * Events gate -- admins and IEMS staff. Synchronous for the same reason as
 * AdminGuard: the identity came down with the document. See ./identity-context.
 */
export default function EventsGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, isIEMS } = useIdentity()
  const router = useRouter()
  const allowed = isAdmin || isIEMS

  useEffect(() => {
    if (!allowed) router.replace('/my-rooms')
  }, [allowed, router])

  if (!allowed) return null

  return <>{children}</>
}
