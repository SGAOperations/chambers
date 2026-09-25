import { NextResponse } from 'next/server'
import { getNussoCaller } from '@/lib/nusso/authorize'
import { browseRooms } from '@/lib/nusso/client'
import { handleNussoError } from '@/lib/nusso/http'

export const runtime = 'nodejs'

/**
 * The list of NUSSO rooms for the room picker. Open to any signed-in user.
 *
 * ?date=YYYY-MM-DD (Boston). EMS scopes the browse to a window; we use the
 * whole day so the picker shows every room bookable that day.
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
    const rooms = await browseRooms({
      date: `${date} 00:00:00`,
      start: `${date} 00:00:00`,
      end: `${date} 23:59:59`,
    })
    return NextResponse.json({ date, rooms })
  } catch (err) {
    return handleNussoError(err)
  }
}
