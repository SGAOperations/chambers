'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useIdentity } from './identity-context'
import { isManagementRole } from '@/lib/admin-roles'

/**
 * Gate for the Management page: admin *and* one of MANAGEMENT_ROLES (issue #64).
 *
 * Same shape as AdminGuard -- the identity was resolved on the server and shipped
 * with the document, so the check is synchronous and nothing renders for the
 * frame before the redirect runs. The fallback is /bookings rather than
 * /my-rooms: everyone who fails this check is still an admin, so the useful place
 * to land them is the admin page they do have.
 *
 * This governs what the dashboard *renders*. The endpoints behind these tabs
 * still authorize on their own terms -- role editing is already restricted to
 * exactly these four roles in app/api/administrator/users/route.ts, while the
 * rest accept any admin, as they did when these tabs lived under Advanced
 * Settings. Narrowing those is a separate change.
 */
export default function ManagementGuard({ children }: { children: React.ReactNode }) {
  const { isAdmin, adminRole } = useIdentity()
  const router = useRouter()
  const allowed = isAdmin && isManagementRole(adminRole)

  useEffect(() => {
    if (!allowed) router.replace(isAdmin ? '/bookings' : '/my-rooms')
  }, [allowed, isAdmin, router])

  if (!allowed) return null

  return <>{children}</>
}
