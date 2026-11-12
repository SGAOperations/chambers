import { NextResponse } from 'next/server'
import { db } from '@/lib/db/data-api'
import { createBooking } from '@/lib/nusso/client'
import { handleNussoError } from '@/lib/nusso/http'
import { recordChambersBooking } from '@/lib/nusso/record-booking'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { checkBooking, chambersTypeFor } from '@/lib/nusso/book-request'

export const runtime = 'nodejs'

/**
 * Create a NUSSO reservation from this server and record it as a Chambers
 * booking (My Rooms). Restricted to admins and Leadership.
 *
 * This server-side path only works where the server can reach EMS (campus /
 * VPN, i.e. local development); from Vercel it answers 503. Production books
 * through the Chambers for NUSSO extension instead: /book/prepare, then the
 * booker's browser makes the reservation, then /book/record.
 *
 * The EMS reservation is made first (it is the irreversible step); on success it
 * is written into Chambers with its reservation code. If the Chambers write
 * fails afterward the EMS reservation is kept and the response says so, rather
 * than losing the booking.
 */
export async function POST(request: Request) {
  const checked = await checkBooking(request)
  if (!checked.ok) return checked.res
  const b = checked.value

  const rateLimitRes = await checkRateLimit(b.caller.user.id)
  if (rateLimitRes) return rateLimitRes

  let result
  try {
    result = await createBooking(b.request, b.profile)
  } catch (err) {
    return handleNussoError(err)
  }

  // EMS reservation succeeded; record it in Chambers. A failure here must not
  // discard the reservation the user already holds in NUSSO.
  try {
    const chambersBookingId = await recordChambersBooking(db, b.caller.user, {
      type: chambersTypeFor(b.profile),
      purpose: b.purpose,
      semesterId: b.semesterId,
      selection: b.selection,
      creatorRole: b.caller.user.app_metadata?.admin_role ?? null,
      session: { roomName: b.roomName, date: b.date, startTime: b.start, endTime: b.end, reservationCode: String(result.reservationId) },
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
