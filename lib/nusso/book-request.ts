import { NextResponse } from 'next/server'
import { db } from '@/lib/db/data-api'
import { getNussoCaller, type NussoCaller } from '@/lib/nusso/authorize'
import { buildWindow, isValidWindow } from '@/lib/nusso/window'
import { reservationProfile, type NussoReservationProfile } from '@/lib/nusso/config'
import { getActiveSemesterId } from '@/lib/active-semester'
import { loadScopeContext, validateScopeSelection, type BookingScope, type Division } from '@/lib/booking-scope'
import type { NussoBookingRequest, NussoUdfAnswer } from '@/lib/nusso/types'

/** What the Book and Tabling forms send, to /api/nusso/book and /book/{prepare,record}. */
export interface BookBody {
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

export interface CheckedBooking {
  caller: NussoCaller
  profile: NussoReservationProfile
  /** The EMS request, titled "SGA - {title}" like every NUSSO reservation. */
  request: NussoBookingRequest
  /** The raw title, which Chambers records as the booking's purpose. */
  purpose: string
  roomName: string
  date: string
  start: string
  end: string
  semesterId: string
  selection: Extract<ReturnType<typeof validateScopeSelection>, { ok: true }>['value']
}

/**
 * Everything checked before an EMS reservation is made: the caller may book,
 * the form is complete, and the Chambers side (scope, active semester) can
 * record it -- so we never create a reservation we cannot record. Answers
 * either the checked booking or the error response to send.
 */
export async function checkBooking(request: Request): Promise<{ ok: true; value: CheckedBooking; body: BookBody } | { ok: false; res: NextResponse }> {
  const fail = (error: string, status: number) => ({ ok: false as const, res: NextResponse.json({ error }, { status }) })

  const caller = await getNussoCaller()
  if (!caller) return fail('Unauthorized', 401)
  if (!caller.canBook) return fail('Only Leadership and administrators may book NUSSO spaces.', 403)

  let body: BookBody
  try {
    body = await request.json()
  } catch {
    return fail('Invalid JSON body', 400)
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
    return fail('roomId, setupTypeId, attendance, eventName, date, start and end are required', 400)
  }

  const ctx = await loadScopeContext(db, caller.user)
  const selection = validateScopeSelection(ctx, {
    scope: body.scope, body_id: body.body_id, division: body.division ?? null, body_ids: body.body_ids,
  })
  if (!selection.ok) return fail(selection.error, 400)

  const semesterId = await getActiveSemesterId(db)
  if (!semesterId) return fail('No active semester is set, so the booking cannot be recorded in Chambers.', 400)

  const purpose = eventName.trim()
  return {
    ok: true,
    body,
    value: {
      caller,
      profile: reservationProfile(reservationType),
      request: {
        roomId,
        setupTypeId,
        attendance,
        eventName: `SGA - ${purpose}`,
        window: buildWindow(date, start, end),
        udfs: Array.isArray(udfs) ? udfs : [],
      },
      purpose,
      roomName: (roomName ?? '').trim(),
      date,
      start,
      end,
      semesterId,
      selection: selection.value,
    },
  }
}

/** The Chambers booking type a reservation is recorded as. */
export function chambersTypeFor(profile: NussoReservationProfile): 'Tabling' | 'One-Time Room' {
  return profile.key === 'tabling' ? 'Tabling' : 'One-Time Room'
}
