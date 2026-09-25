import { NextResponse } from 'next/server'
import { db } from '@/lib/db/data-api'
import { getNussoCaller } from '@/lib/nusso/authorize'
import { createBooking } from '@/lib/nusso/client'
import { handleNussoError } from '@/lib/nusso/http'
import { buildWindow, isValidWindow } from '@/lib/nusso/window'
import { recordChambersBooking } from '@/lib/nusso/record-booking'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { reservationProfile } from '@/lib/nusso/config'
import { getActiveSemesterId } from '@/lib/active-semester'
import { loadScopeContext, validateScopeSelection, type BookingScope, type Division } from '@/lib/booking-scope'
import type { NussoUdfAnswer } from '@/lib/nusso/types'

export const runtime = 'nodejs'

interface BookBody {
  roomId?: number
  setupTypeId?: number
  attendance?: number
  eventName?: string
  /** Human room label for the Chambers record (e.g. "Curry Student Center — 333"). */
  roomName?: string
  date?: string
  start?: string
  end?: string
  udfs?: NussoUdfAnswer[]
  /** Reservation type key (e.g. 'room-request'); defaults to room request. */
  reservationType?: string
  // Chambers booking scope (which body the booking is recorded under).
  scope?: BookingScope
  body_id?: string
  division?: Division | null
  body_ids?: string[]
}

/**
 * Create a NUSSO reservation and record it as a Chambers booking (My Rooms).
 * Restricted to admins and Leadership. The EMS reservation is made first (it is
 * the irreversible step); on success it is written into Chambers with its
 * reservation code. If the Chambers write fails afterward the EMS reservation is
 * kept and the response says so, rather than losing the booking.
 */
export async function POST(request: Request) {
  const caller = await getNussoCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!caller.canBook) {
    return NextResponse.json({ error: 'Only Leadership and administrators may book NUSSO spaces.' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(caller.user.id)
  if (rateLimitRes) return rateLimitRes

  let body: BookBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { roomId, setupTypeId, attendance, eventName, roomName, date, start, end, udfs, reservationType } = body
  if (
    typeof roomId !== 'number' ||
    typeof setupTypeId !== 'number' ||
    typeof attendance !== 'number' ||
    attendance < 1 ||
    !eventName?.trim() ||
    !date || !start || !end || !isValidWindow(date, start, end)
  ) {
    return NextResponse.json(
      { error: 'roomId, setupTypeId, attendance, eventName, date, start and end are required' },
      { status: 400 }
    )
  }

  // Validate the Chambers scope selection and semester BEFORE the irreversible
  // EMS booking, so we never create a reservation we cannot record.
  const ctx = await loadScopeContext(db, caller.user)
  const selection = validateScopeSelection(ctx, {
    scope: body.scope, body_id: body.body_id, division: body.division ?? null, body_ids: body.body_ids,
  })
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 400 })

  const semesterId = await getActiveSemesterId(db)
  if (!semesterId) {
    return NextResponse.json({ error: 'No active semester is set, so the booking cannot be recorded in Chambers.' }, { status: 400 })
  }

  const profile = reservationProfile(reservationType)
  const chambersType = profile.key === 'tabling' ? 'Tabling' : 'One-Time Room'

  let result
  try {
    result = await createBooking(
      {
        roomId,
        setupTypeId,
        attendance,
        eventName: eventName.trim(),
        window: buildWindow(date, start, end),
        udfs: Array.isArray(udfs) ? udfs : [],
      },
      profile
    )
  } catch (err) {
    return handleNussoError(err)
  }

  // EMS reservation succeeded; record it in Chambers. A failure here must not
  // discard the reservation the user already holds in NUSSO.
  try {
    const chambersBookingId = await recordChambersBooking(db, caller.user, {
      type: chambersType,
      purpose: eventName.trim(),
      semesterId,
      selection: selection.value,
      creatorRole: caller.user.app_metadata?.admin_role ?? null,
      session: {
        roomName: (roomName ?? '').trim(),
        date,
        startTime: start,
        endTime: end,
        reservationCode: String(result.reservationId),
      },
    })
    return NextResponse.json({ ...result, chambersBookingId, chambersBookingRecorded: true })
  } catch (err) {
    console.error('NUSSO booking made but Chambers record failed:', err)
    return NextResponse.json({
      ...result,
      chambersBookingRecorded: false,
      warning: `Booked in NUSSO as reservation #${result.reservationId}, but it could not be recorded in Chambers/My Rooms. Add it manually as a booking with reservation code ${result.reservationId}.`,
    })
  }
}
