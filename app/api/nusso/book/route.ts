import { NextResponse } from 'next/server'
import { getNussoCaller } from '@/lib/nusso/authorize'
import { createBooking } from '@/lib/nusso/client'
import { handleNussoError } from '@/lib/nusso/http'
import { buildWindow, isValidWindow } from '@/lib/nusso/window'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { reservationProfile } from '@/lib/nusso/config'
import type { NussoUdfAnswer } from '@/lib/nusso/types'

export const runtime = 'nodejs'

interface BookBody {
  roomId?: number
  setupTypeId?: number
  attendance?: number
  eventName?: string
  date?: string
  start?: string
  end?: string
  udfs?: NussoUdfAnswer[]
  /** Reservation type key (e.g. 'room-request'); defaults to room request. */
  reservationType?: string
}

/**
 * Create a NUSSO reservation. Restricted to admins and Leadership (see
 * getNussoCaller) because it books under SGA's shared EMS account and puts a
 * real reservation on Northeastern's calendar.
 *
 * Body: { roomId, setupTypeId, attendance, eventName, date, start, end, udfs? }.
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

  const { roomId, setupTypeId, attendance, eventName, date, start, end, udfs, reservationType } = body
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

  try {
    const result = await createBooking(
      {
        roomId,
        setupTypeId,
        attendance,
        eventName: eventName.trim(),
        window: buildWindow(date, start, end),
        udfs: Array.isArray(udfs) ? udfs : [],
      },
      reservationProfile(reservationType)
    )
    return NextResponse.json(result)
  } catch (err) {
    return handleNussoError(err)
  }
}
