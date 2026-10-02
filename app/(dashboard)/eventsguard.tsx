'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useIdentity } from './identity-context'
import { canWriteAdmin } from '@/lib/admin-roles'

/**
 * Events gate -- admins and IEMS staff. Synchronous for the same reason as
 * AdminGuard: the identity came down with the document. See ./identity-context.
 *
 * A view-only admin is not let in on the strength of being an admin (issue
 * #217): Events is work, not a record to read. They still are if they hold an
 * IEMS role, which is a separate grant.
 */
export default function EventsGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, isIEMS, adminRole } = useIdentity()
  const router = useRouter()
  const allowed = isIEMS || (isAdmin && canWriteAdmin(adminRole))

  useEffect(() => {
    if (!allowed) router.replace('/my-rooms')
  }, [allowed, router])

  if (!allowed) return null

  return <>{children}</>
}
