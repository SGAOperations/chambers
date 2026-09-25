import { NextResponse } from 'next/server'
import { getNussoCaller } from '@/lib/nusso/authorize'
import { searchAvailableRooms } from '@/lib/nusso/client'
import { handleNussoError } from '@/lib/nusso/http'
import { buildWindow, isValidWindow } from '@/lib/nusso/window'
import { reservationProfile } from '@/lib/nusso/config'

export const runtime = 'nodejs'

/**
 * "Find a room": every room free for a given window, for the room-search view.
 * Open to any signed-in user -- it only reads availability.
 *
 * Body: { date: "YYYY-MM-DD", start: "HH:mm", end: "HH:mm", capacity?, reservationType? }.
 */
export async function POST(request: Request) {
  const caller = await getNussoCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { date?: string; start?: string; end?: string; capacity?: number; reservationType?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { date, start, end, capacity, reservationType } = body
  if (!date || !start || !end || !isValidWindow(date, start, end)) {
    return NextResponse.json({ error: 'date, start and end (start before end) are required' }, { status: 400 })
  }
  const minCapacity = typeof capacity === 'number' && capacity > 0 ? capacity : 0

  try {
    const rooms = await searchAvailableRooms(
      buildWindow(date, start, end),
      reservationProfile(reservationType),
      minCapacity
    )
    return NextResponse.json({ count: rooms.length, rooms })
  } catch (err) {
    return handleNussoError(err)
  }
}
