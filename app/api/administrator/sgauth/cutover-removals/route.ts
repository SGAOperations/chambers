import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'
import { pool } from '@/lib/db/pool'
import type { RemovedSeat } from '@/lib/position-sync'
import { findLostBookings, notifyRemovedSeats } from '@/lib/seat-removal'

/**
 * One-off: takes bookings off the calendars of people who lost body seats at
 * the SGAuth cutover, before lib/seat-removal.ts existed to do it as the seats
 * went.
 *
 * Those seats are the difference between board_memberships_pre_sgauth (the
 * cutover snapshot, docs/sgauth/cutover.md) and board_memberships today.
 *
 *   GET   dry run: who lost which seats, and which bookings would come off.
 *   POST  sends the emails.
 *
 * Run it once, soon after this deploys. A seat lost after the deploy was
 * already handled as it went, and running this again would email those people
 * a second time -- harmless to their calendars, since a cancellation for an
 * event already removed does nothing, but noise. Delete this route with the
 * snapshot in #250.
 */

async function requireManagement() {
  const user = await getAuthedUserWithLiveRoles()
  if (!user || !user.app_metadata?.is_admin) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return { error: rateLimitRes }
  return { user }
}

/** Seats in the cutover snapshot that are no longer held, or null when there is no snapshot. */
async function lostSinceCutover(): Promise<(RemovedSeat & { name: string; body: string })[] | null> {
  const { rows: exists } = await pool.query<{ t: string | null }>(
    `select to_regclass('public.board_memberships_pre_sgauth')::text as t`
  )
  if (!exists[0]?.t) return null
  const { rows } = await pool.query<RemovedSeat & { name: string; body: string }>(
    `select s.user_id as "userId", s.body_id as "bodyId", s.role, u.full_name as name, b.name as body
       from public.board_memberships_pre_sgauth s
       join public.users u on u.id = s.user_id
       join public.bodies b on b.id = s.body_id
      where not exists (
        select 1 from public.board_memberships m where m.user_id = s.user_id and m.body_id = s.body_id)
      order by u.full_name, b.name`
  )
  return rows
}

export async function GET() {
  const auth = await requireManagement()
  if (auth.error) return auth.error

  const seats = await lostSinceCutover()
  if (!seats) return NextResponse.json({ error: 'There is no cutover snapshot.' }, { status: 404 })

  const lost = await findLostBookings(seats)
  return NextResponse.json({
    seats: seats.map(s => ({ name: s.name, body: s.body, role: s.role })),
    bookings: lost.map(l => ({
      name: seats.find(s => s.userId === l.userId)?.name ?? l.userId,
      booking: l.summary,
      via: l.removedBodies,
    })),
  })
}

export async function POST() {
  const auth = await requireManagement()
  if (auth.error) return auth.error

  const seats = await lostSinceCutover()
  if (!seats) return NextResponse.json({ error: 'There is no cutover snapshot.' }, { status: 404 })

  await notifyRemovedSeats(seats.map(({ userId, bodyId, role }) => ({ userId, bodyId, role })))
  return NextResponse.json({ success: true, seats: seats.length })
}
