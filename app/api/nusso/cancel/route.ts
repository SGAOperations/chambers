import { NextResponse } from 'next/server'
import { db } from '@/lib/db/data-api'
import { getNussoCaller } from '@/lib/nusso/authorize'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { requireBookingManager } from '@/lib/booking-scope'
import {
  applyReleasedStatus,
  emsEventName,
  releaseOne,
  statusForCancellation,
  type NussoCancelTarget,
  type NussoCancellationType,
  type NussoCancelOutcome,
} from '@/lib/nusso/cancel-booking'

export const runtime = 'nodejs'

interface CancelBody {
  booking_id?: string
  /** A single session row id; omitted to release every session on the booking. */
  occurrence_id?: string | null
  scope?: 'occurrence' | 'series'
  cancellation_type?: NussoCancellationType
}

/**
 * Release a NUSSO reservation in EMS and settle the Chambers side to match.
 *
 * This is the "NUSSO Cancellation" action under Submit Request in My Rooms. The
 * ordinary cancellation request (/api/cancellation-requests) asks an admin to go
 * and cancel by hand; this one does it, and only falls back to that request when
 * it cannot.
 *
 * Authorization is deliberately both locks: getNussoCaller().canBook, because
 * this acts under SGA's shared EMS account exactly as booking does, and
 * requireBookingManager(), because it changes somebody's booking. Neither alone
 * is enough -- the first would let any admin release another body's room, and
 * the second would let a body's Leadership drive the shared EMS account without
 * the booking privilege.
 *
 * Outcome, per session:
 *   released -> Cancelled (full) or Virtual (going virtual), plus an audit entry
 *   not released -> Pending Cancellation and a real cancellation_requests row,
 *                   so an admin picks it up in the Cancellations tab as usual
 *
 * A partial result is possible on a multi-session booking and is reported as
 * such rather than rounded to success or failure.
 */
export async function POST(request: Request) {
  const caller = await getNussoCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.canBook) {
    return NextResponse.json(
      { error: 'Only Leadership and administrators may cancel NUSSO reservations.' },
      { status: 403 }
    )
  }

  const rateLimitRes = await checkRateLimit(caller.user.id)
  if (rateLimitRes) return rateLimitRes

  let body: CancelBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const bookingId = body.booking_id
  if (!bookingId) return NextResponse.json({ error: 'booking_id is required' }, { status: 400 })

  const type: NussoCancellationType = body.cancellation_type === 'Virtual' ? 'Virtual' : 'Cancellation'
  const scope = body.scope === 'occurrence' ? 'occurrence' : 'series'
  const occurrenceId = scope === 'occurrence' ? (body.occurrence_id || null) : null
  if (scope === 'occurrence' && !occurrenceId) {
    return NextResponse.json({ error: 'occurrence_id is required when cancelling one session.' }, { status: 400 })
  }

  const guard = await requireBookingManager(db, db, caller.user, bookingId)
  if (guard.error) return guard.error

  const bookingType = guard.row.type
  if (bookingType !== 'One-Time Room' && bookingType !== 'Tabling') {
    // Weekly rooms are never created through Browse/Book NUSSO, so there is no
    // EMS reservation of ours to release.
    return NextResponse.json(
      { error: 'Only one-time room and tabling bookings can be cancelled through NUSSO.' },
      { status: 400 }
    )
  }

  // The lock that matters. The UI hides the action for a booking Chambers did
  // not make, but a reservation_code is not permission and this route must not
  // rely on the client to know that. Most codes in Chambers were entered by hand
  // for reservations made outside it -- over the phone, or in NUSSO's own web UI
  // -- whose EMS event name and window are not the ones recorded here. Releasing
  // one would cancel something Chambers never made and does not model; at worst
  // a weekly series, whose single reservation stands for a body's entire
  // semester of meetings. Only a booking this codebase created in EMS may be
  // released by it, so provenance is checked before anything else is read.
  //
  // The purpose comes along in the same read: it is what EMS titled the
  // reservation with, so the booking-id lookup needs it later.
  const { data: bookingRow } = await db
    .from('bookings').select('purpose, booked_via_nusso').eq('id', bookingId).maybeSingle()

  if (!bookingRow?.booked_via_nusso) {
    return NextResponse.json(
      {
        error:
          'This booking was not made through Browse/Book NUSSO, so Chambers cannot cancel it there. Submit a cancellation request instead.',
      },
      { status: 400 }
    )
  }

  // Every session in scope that is not already settled, including any without a
  // reservation code: those cannot be released, but they still have to be
  // cancelled, so they go down the fallback path rather than being skipped. That
  // matters now that this is the only cancel action offered on a NUSSO booking.
  const targets = await loadTargets(bookingType, bookingId, occurrenceId)
  if (!targets.length) {
    return NextResponse.json(
      { error: 'Nothing to cancel: these sessions are already cancelled or virtual.' },
      { status: 400 }
    )
  }

  // Attendance and titles aside, this note is what a NUSSO coordinator reads to
  // understand a cancellation they did not make, so it says who and why.
  const who = caller.user.email ?? 'a Chambers user'
  const notes =
    type === 'Virtual'
      ? `Event going virtual; room released via Chambers by ${who}.`
      : `Cancelled via Chambers by ${who}.`

  const eventName = emsEventName(bookingRow.purpose ?? '')
  const outcomes: NussoCancelOutcome[] = []
  for (const target of targets) {
    outcomes.push(await releaseOne(target, eventName, notes))
  }

  try {
    await applyReleasedStatus(db, caller.user, bookingId, outcomes, type)
  } catch (err) {
    // The EMS side is already done and cannot be undone, so this is reported
    // rather than retried: the room is released, Chambers just did not record it.
    console.error('NUSSO cancellation succeeded but the Chambers status write failed:', err)
    return NextResponse.json({
      released: outcomes.filter(o => o.released).length,
      failed: outcomes.filter(o => !o.released).length,
      warning:
        'The reservation was released in NUSSO, but Chambers could not record the new status. ' +
        'Tell Operational Affairs so the booking can be corrected by hand.',
    })
  }

  const failed = outcomes.filter(o => !o.released)
  if (!failed.length) {
    return NextResponse.json({
      released: outcomes.length,
      failed: 0,
      status: statusForCancellation(type),
    })
  }

  // Anything not released becomes the manual request it would have been without
  // this route, so nothing is quietly dropped.
  const fallbackError = await placeFallbackRequest(
    bookingType, bookingId, caller.user.id, scope, occurrenceId, type, failed
  )

  // Two different things end up in `failed`, and only one of them is a fault.
  // A session with no reservation code was never ours to release -- an ordinary
  // Chambers booking sitting in the same series -- and it goes down the ordinary
  // path, which is not news. A session we tried and could not release is.
  const refused = failed.filter(o => o.target.reservationCode)

  return NextResponse.json({
    released: outcomes.length - failed.length,
    failed: failed.length,
    status: statusForCancellation(type),
    warning: buildWarning(outcomes.length, refused, fallbackError),
  })
}

/**
 * What to tell the requester, or null when there is nothing worth saying.
 *
 * Sessions that were never NUSSO reservations are deliberately silent on their
 * own: they went down the ordinary cancellation path, which is exactly what
 * would have happened without this route.
 */
function buildWarning(
  total: number,
  refused: NussoCancelOutcome[],
  fallbackError: string | null
): string | null {
  if (fallbackError) {
    return refused.length
      ? `NUSSO did not release the reservation (${refused[0].reason}), and the backup cancellation request could not be filed either (${fallbackError}). Contact Operational Affairs directly.`
      : `The cancellation request could not be filed (${fallbackError}). Contact Operational Affairs directly.`
  }

  // Only non-NUSSO sessions fell back: the ordinary path working, not a warning.
  if (!refused.length) return null

  const scale = refused.length === total ? 'the reservation' : `${refused.length} of ${total} sessions`
  return (
    `NUSSO did not release ${scale} automatically: ${refused[0].reason} ` +
    'A cancellation request has been filed as a backup and is now Pending Cancellation ' +
    'for Operational Affairs to complete by hand.'
  )
}

/** The session rows to release, each with the reservation code recorded on it. */
async function loadTargets(
  bookingType: 'One-Time Room' | 'Tabling',
  bookingId: string,
  occurrenceId: string | null
): Promise<NussoCancelTarget[]> {
  if (bookingType === 'One-Time Room') {
    let query = db
      .from('one_time_room_bookings')
      .select('id, booking_date, start_time, end_time, reservation_code, status')
      .eq('booking_id', bookingId)
    if (occurrenceId) query = query.eq('id', occurrenceId)
    const { data } = await query
    return (data ?? [])
      .filter(r => !isSettled(r.status))
      .map(r => ({
        table: 'one_time_room_bookings' as const,
        id: r.id,
        reservationCode: r.reservation_code,
        date: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
      }))
  }

  const { data: tabling } = await db
    .from('tabling_bookings').select('id').eq('booking_id', bookingId).maybeSingle()
  if (!tabling) return []

  let query = db
    .from('tabling_sessions')
    .select('id, session_date, start_time, end_time, reservation_code, status')
    .eq('tabling_booking_id', tabling.id)
  if (occurrenceId) query = query.eq('id', occurrenceId)
  const { data } = await query
  return (data ?? [])
    .filter(r => !isSettled(r.status))
    .map(r => ({
      table: 'tabling_sessions' as const,
      id: r.id,
      reservationCode: r.reservation_code,
      date: r.session_date,
      startTime: r.start_time,
      endTime: r.end_time,
    }))
}

/** Already cancelled or already virtual: nothing left in EMS to release. */
function isSettled(status: string | null): boolean {
  return status === 'Cancelled' || status === 'Virtual'
}

/**
 * The manual path, for sessions EMS would not release: one cancellation request
 * plus Pending Cancellation on each affected row, matching what
 * /api/cancellation-requests writes so the Cancellations tab treats it the same.
 *
 * Returns an error message when even this could not be filed -- at which point
 * the requester is told to go to Operational Affairs directly, because nothing
 * in Chambers is now tracking the cancellation.
 */
async function placeFallbackRequest(
  bookingType: 'One-Time Room' | 'Tabling',
  bookingId: string,
  userId: string,
  scope: 'occurrence' | 'series',
  occurrenceId: string | null,
  type: NussoCancellationType,
  failed: NussoCancelOutcome[]
): Promise<string | null> {
  const { error: requestError } = await db.from('cancellation_requests').insert({
    booking_id: bookingId,
    occurrence_id: occurrenceId,
    // The date the request is about, kept for the same reason
    // /api/cancellation-requests keeps it: occurrence ids do not survive edits.
    occurrence_date: scope === 'occurrence' ? failed[0]?.target.date ?? null : null,
    requested_by: userId,
    scope,
    status: 'Pending',
    cancellation_type: type,
  })
  if (requestError) return requestError.message

  for (const { target } of failed) {
    const { error } = await db
      .from(bookingType === 'One-Time Room' ? 'one_time_room_bookings' : 'tabling_sessions')
      .update({ status: 'Pending Cancellation' })
      .eq('id', target.id)
    if (error) return error.message
  }

  return null
}
