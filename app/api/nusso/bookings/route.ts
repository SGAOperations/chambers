import { NextResponse } from 'next/server'
import { getNussoCaller } from '@/lib/nusso/authorize'
import { browseBookings } from '@/lib/nusso/client'
import { handleNussoError } from '@/lib/nusso/http'

// Manages an outbound login + cookie jar to nuevents.neu.edu; not edge-safe.
export const runtime = 'nodejs'

/**
 * Existing NUSSO bookings for one day, for the calendar. Open to any signed-in
 * user -- this is the same read-only view the EMS "Browse for Space" page gives.
 *
 * ?date=YYYY-MM-DD (Boston). Defaults to today if absent.
 */
export async function GET(request: Request) {
  const caller = await getNussoCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date') || new Date().toISOString().slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const bookings = await browseBookings({
      date: `${date} 00:00:00`,
      start: `${date} 00:00:00`,
      end: `${date} 23:59:59`,
    })
    return NextResponse.json({ date, bookings })
  } catch (err) {
    return handleNussoError(err)
  }
}
