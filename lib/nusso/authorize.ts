import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { pool } from '@/lib/db/pool'
import { db } from '@/lib/db/data-api'
import type { AuthedUser } from '@/lib/auth-types'

/**
 * The caller of a NUSSO route, with whether they may create bookings.
 *
 * Browsing NUSSO (rooms, existing bookings, availability) is open to any
 * signed-in Chambers user. Creating a reservation is limited to the same people
 * who may book SGA Spaces -- admins and body Leadership -- because it acts under
 * SGA's single shared EMS account and puts a real reservation on Northeastern's
 * calendar. Leadership is read from board_memberships, the same source
 * resolveShellIdentity() uses for the shell's isLeadership.
 */
export interface NussoCaller {
  user: AuthedUser
  canBook: boolean
}

export async function getNussoCaller(): Promise<NussoCaller | null> {
  const user = await getAuthedUserWithLiveRoles(db)
  if (!user) return null

  const isAdmin = !!user.app_metadata?.is_admin
  let isLeadership = false
  if (!isAdmin) {
    const { rows } = await pool.query<{ role: string }>(
      'select role from public.board_memberships where user_id = $1',
      [user.id]
    )
    isLeadership = rows.some(r => r.role === 'Leadership')
  }

  return { user, canBook: isAdmin || isLeadership }
}
