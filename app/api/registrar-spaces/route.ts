import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { todayInAppZone } from '@/lib/app-zone'
import {
  fetchRegistrarReservations,
  fetchRegistrarSpaces,
  isRegistrarSpacesEnabled,
  TwentyFiveLiveError,
} from '@/lib/25live/client'

export const runtime = 'nodejs'

/** How far either side of today a day may be asked for. */
const MAX_DAYS_AWAY = 366

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / 86_400_000)
}

/**
 * The Registrar's Boston spaces and what is booked in them on one day, read
 * from 25Live. Open to any signed-in user; nothing here writes.
 *
 * ?date=YYYY-MM-DD (Boston), defaulting to today. Held to a year either way so
 * nobody can walk the upstream cache one uncached day at a time.
 */
export async function GET(request: Request) {
  // 404 rather than 503 while the flag is off: the page is not a feature that is
  // broken, it is one that does not exist yet.
  if (!isRegistrarSpacesEnabled()) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const today = todayInAppZone()
  const date = new URL(request.url).searchParams.get('date') || today
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || isNaN(Date.parse(`${date}T12:00:00Z`))) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (Math.abs(daysBetween(today, date)) > MAX_DAYS_AWAY) {
    return NextResponse.json({ error: 'Pick a date within a year of today.' }, { status: 400 })
  }

  try {
    const spaces = await fetchRegistrarSpaces()
    const reservations = await fetchRegistrarReservations(date, new Set(spaces.map(s => s.id)))
    return NextResponse.json({ date, spaces, reservations })
  } catch (err) {
    if (err instanceof TwentyFiveLiveError) {
      return NextResponse.json({ error: `Couldn't load 25Live. ${err.message}` }, { status: 502 })
    }
    console.error('Unexpected 25Live error:', err)
    return NextResponse.json({ error: 'Something went wrong reading 25Live.' }, { status: 500 })
  }
}
