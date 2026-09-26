import { NextResponse } from 'next/server'
import { getNussoCaller } from '@/lib/nusso/authorize'
import { getAvailability } from '@/lib/nusso/client'
import { handleNussoError } from '@/lib/nusso/http'
import { buildWindow, isValidWindow } from '@/lib/nusso/window'
import { reservationProfile } from '@/lib/nusso/config'

export const runtime = 'nodejs'

/**
 * Whether a room is free for a chosen window (GetAvailabilityList).
 *
 * Body: { roomId, date: "YYYY-MM-DD", start: "HH:mm", end: "HH:mm" }.
 * Open to any signed-in user -- it only reads availability.
 */
export async function POST(request: Request) {
  const caller = await getNussoCaller()
  if (!caller) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { roomId?: number; date?: string; start?: string; end?: string; reservationType?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { roomId, date, start, end, reservationType } = body
  if (typeof roomId !== 'number' || !date || !start || !end || !isValidWindow(date, start, end)) {
    return NextResponse.json({ error: 'roomId, date, start and end (start before end) are required' }, { status: 400 })
  }

  try {
    const availability = await getAvailability(roomId, buildWindow(date, start, end), reservationProfile(reservationType))
    const room = availability.find(a => a.RoomId === roomId)
    return NextResponse.json({
      available: !!room && room.DaysAvailable > 0,
      room: room ?? null,
      availability,
    })
  } catch (err) {
    return handleNussoError(err)
  }
}
