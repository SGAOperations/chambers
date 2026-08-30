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
 * This governs what the dashboard *renders*, but it is no longer the only thing
 * standing in the way: the endpoints behind these tabs now run the same
 * isManagementRole() check against the live admin_role and answer 403, so a
 * Comptroller who calls them directly gets nowhere.
 *
 * One deliberate exception -- GET /api/administrator/bodies stays open to any
 * admin, because the Bookings page reads it for its body picker. Only POST and
 * PATCH on that route are narrowed.
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
