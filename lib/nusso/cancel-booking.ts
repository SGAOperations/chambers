import type { Db } from '@/lib/db/data-api'
import type { AuthedUser } from '@/lib/auth-types'
import { insertAuditRows } from '@/lib/audit'
import { cancelBooking, findBookingId } from './client'

/**
 * Releasing a NUSSO reservation from Chambers.
 *
 * Until now "Cancelled" in Chambers was a Chambers-only fact: nothing called
 * back to nuevents.neu.edu, so a cancelled booking could sit over a live EMS
 * reservation holding a room nobody was going to use. This is the path that
 * actually releases it, from the same Request Cancellation modal Leadership
 * already uses.
 *
 * The EMS side is one call (see cancelBooking), but it needs the *booking* id
 * and Chambers only stores the *reservation* id, so every cancellation starts
 * with a lookup that can legitimately come back empty. That, plus EMS being a
 * remote system that can simply be down, is why this never fails hard: a
 * cancellation that cannot be completed automatically degrades to the manual
 * request Chambers has always had, and says so. Losing the reservation silently
 * is the one outcome worth engineering against.
 */

/** Full cancellation releases the room; going virtual also releases it. */
export type NussoCancellationType = 'Cancellation' | 'Virtual'

/** The Chambers status a completed EMS cancellation lands the session on. */
export function statusForCancellation(type: NussoCancellationType): 'Cancelled' | 'Virtual' {
  return type === 'Virtual' ? 'Virtual' : 'Cancelled'
}

/** One Chambers session to release, flattened out of whichever table holds it. */
export interface NussoCancelTarget {
  /** 'one_time_room_bookings' | 'tabling_sessions' -- the row's own table. */
  table: 'one_time_room_bookings' | 'tabling_sessions'
  id: string
  /** EMS reservation id, as stored on the row. */
  reservationCode: string
  date: string
  startTime: string
  endTime: string
}

export interface NussoCancelOutcome {
  target: NussoCancelTarget
  /** True once EMS has released the booking. */
  released: boolean
  /** Why it could not be released, for the warning shown to the requester. */
  reason?: string
}

/**
 * The event name EMS holds for a booking Chambers made.
 *
 * /api/nusso/book titles every reservation "SGA - {purpose}" and records the
 * purpose without that prefix, so this rebuilds what EMS is holding. Keep it in
 * step with the prefix in that route -- the booking-id lookup matches on this
 * string, and a drift between the two turns every cancellation into a fallback.
 */
export function emsEventName(purpose: string): string {
  return `SGA - ${purpose.trim()}`
}

/**
 * Release one session in EMS. Never throws: a failure is an outcome, because the
 * caller has to go on and place the manual request instead.
 */
export async function releaseOne(
  target: NussoCancelTarget,
  eventName: string,
  cancelNotes: string
): Promise<NussoCancelOutcome> {
  const reservationId = Number(target.reservationCode)
  if (!Number.isFinite(reservationId)) {
    return { target, released: false, reason: 'The stored reservation code is not a NUSSO reservation id.' }
  }

  let bookingId: number | null
  try {
    bookingId = await findBookingId(target.date, target.startTime, target.endTime, eventName)
  } catch (err) {
    return {
      target,
      released: false,
      reason: err instanceof Error ? `Could not reach NUSSO to look up the booking (${err.message}).` : 'Could not reach NUSSO to look up the booking.',
    }
  }

  if (bookingId === null) {
    return {
      target,
      released: false,
      reason: `No single NUSSO booking matched "${eventName}" at that date and time, so there was nothing safe to cancel automatically.`,
    }
  }

  try {
    await cancelBooking(reservationId, bookingId, cancelNotes)
  } catch (err) {
    return {
      target,
      released: false,
      reason: err instanceof Error ? err.message : 'NUSSO refused the cancellation.',
    }
  }

  return { target, released: true }
}

/**
 * Apply the finished status to the rows EMS released, and log it.
 *
 * Only the released ones: a session that fell back is left for the caller to put
 * into Pending Cancellation, so the two states never overlap.
 */
export async function applyReleasedStatus(
  db: Db,
  user: AuthedUser,
  bookingId: string,
  outcomes: NussoCancelOutcome[],
  type: NussoCancellationType
): Promise<void> {
  const released = outcomes.filter(o => o.released)
  if (!released.length) return

  const status = statusForCancellation(type)

  for (const { target } of released) {
    const { error } = await db.from(target.table).update({ status }).eq('id', target.id)
    if (error) throw new Error(error.message)
  }

  await insertAuditRows(
    db,
    released.map(({ target }) => ({
      booking_id: bookingId,
      admin_id: user.id,
      new_status: status,
      target: 'session' as const,
      target_date: target.date,
      action: 'cancelled' as const,
      changes: null,
    }))
  )
}
