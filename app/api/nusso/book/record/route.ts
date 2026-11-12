import { NextResponse } from 'next/server'
import { db } from '@/lib/db/data-api'
import { recordChambersBooking } from '@/lib/nusso/record-booking'
import { checkBooking, chambersTypeFor } from '@/lib/nusso/book-request'

export const runtime = 'nodejs'

/**
 * Step 3 of booking through the Chambers for NUSSO extension: the booker's
 * browser made the EMS reservation (step 2) and reports it here, with the same
 * form it sent to /book/prepare plus `reservationId`. Chambers records it in My
 * Rooms exactly as the server-side booking does.
 *
 * This server cannot reach EMS to confirm the reservation, so it records what
 * the booker's browser reports -- the same trust Chambers already gives a
 * reservation code typed into a booking by hand, limited to people who may
 * book. Not rate limited: /book/prepare already was, and refusing here would
 * lose a reservation that already exists.
 */
export async function POST(request: Request) {
  const checked = await checkBooking(request)
  if (!checked.ok) return checked.res
  const b = checked.value

  const reservationId = (checked.body as { reservationId?: unknown }).reservationId
  if (typeof reservationId !== 'number' || !Number.isInteger(reservationId) || reservationId <= 0) {
    return NextResponse.json({ error: 'reservationId (the NUSSO reservation number) is required' }, { status: 400 })
  }

  try {
    const chambersBookingId = await recordChambersBooking(db, b.caller.user, {
      type: chambersTypeFor(b.profile),
      purpose: b.purpose,
      semesterId: b.semesterId,
      selection: b.selection,
      creatorRole: b.caller.user.app_metadata?.admin_role ?? null,
      session: { roomName: b.roomName, date: b.date, startTime: b.start, endTime: b.end, reservationCode: String(reservationId) },
    })
    return NextResponse.json({ chambersBookingId, chambersBookingRecorded: true })
  } catch (err) {
    console.error('NUSSO booking made through the extension but Chambers record failed:', err)
    return NextResponse.json({
      chambersBookingRecorded: false,
      warning: `Booked in NUSSO as reservation #${reservationId}, but it could not be recorded in Chambers/My Rooms. Add it manually as a booking with reservation code ${reservationId}.`,
    })
  }
}
