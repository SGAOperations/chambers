import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { bostonWallClockNow } from '@/lib/boston-time'

/**
 * Every SGA Space and its day, for the All Spaces card on the corridor display.
 *
 * A route of its own rather than more fields on /api/display/committees, which
 * is about meetings. The display polls both on the same tick, and keeping them
 * apart is what lets the spaces card fail on its own: a wall screen that drops
 * its whole board because one query went wrong is worse than one that keeps
 * showing the meetings.
 *
 * Named all-spaces rather than spaces so it cannot be read as a sibling of
 * /api/display/[spaceId]. Space ids are uuids, so a static `spaces` segment
 * could never actually be shadowed by one -- but the next person to read the
 * directory should not have to work that out.
 *
 * Gated on DISPLAY_KEY, the same key the other two display routes take, so the
 * screen needs no second secret.
 */

const adminSupabase = db

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const key = searchParams.get('key')

  if (!key || key !== process.env.DISPLAY_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // The client's own local date, so "today" matches the clock beside the screen.
  //
  // The fallback is Boston wall clock rather than the server's UTC date, for the
  // reason spelled out in lib/boston-time.ts: bookings are wall-clock digits
  // labelled Z, so a UTC "today" has already rolled over after 8 PM EDT and this
  // would fetch tomorrow's day while the screen still shows this evening.
  const dateParam = searchParams.get('date')
  const [year, month, day] = dateParam
    ? dateParam.split('-').map(Number)
    : (() => {
        const n = bostonWallClockNow()
        return [n.getUTCFullYear(), n.getUTCMonth() + 1, n.getUTCDate()]
      })()

  if (!year || !month || !day) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  const dayStart = new Date(Date.UTC(year, month - 1, day))
  const dayEnd = new Date(Date.UTC(year, month - 1, day + 1))

  const [spacesResult, bookingsResult, blackoutsResult] = await Promise.all([
    adminSupabase.from('spaces').select('id, name, capacity'),
    // Overlap rather than start-within-the-day. For bookings the two are the
    // same today: touchesDeadZone in lib/space-series.ts lets one cross midnight
    // only by ending exactly at it, so none can reach into a later morning.
    // Blackouts carry no such rule, and an overlap test is the one that stays
    // correct if the booking rule is ever relaxed.
    adminSupabase
      .from('space_bookings')
      .select('id, space_id, title, start_time, end_time')
      .lt('start_time', dayEnd.toISOString())
      .gt('end_time', dayStart.toISOString())
      .order('start_time', { ascending: true }),
    // space_id is null for a blackout that closes every space at once, so those
    // have to be picked up for all of them rather than joined per space.
    adminSupabase
      .from('space_blackouts')
      .select('id, space_id, start_time, end_time')
      .lt('start_time', dayEnd.toISOString())
      .gt('end_time', dayStart.toISOString())
      .order('start_time', { ascending: true }),
  ])

  if (spacesResult.error) {
    console.error('display/all-spaces: spaces query failed:', spacesResult.error)
    return NextResponse.json({ error: 'Could not load spaces' }, { status: 500 })
  }

  const bookings = bookingsResult.data ?? []
  const blackouts = blackoutsResult.data ?? []

  const spaces = (spacesResult.data ?? []).map(
    (s: { id: string; name: string; capacity: number }) => ({
      id: s.id,
      name: s.name,
      capacity: s.capacity,
      // Titles are already public on the per-space kiosk outside each room, so
      // this discloses nothing new. Names are deliberately not carried: the
      // corridor is a wider audience than a door, and the card has no room to
      // print them anyway.
      bookings: bookings
        .filter((b: { space_id: string }) => b.space_id === s.id)
        .map((b: { id: string; title: string | null; start_time: string; end_time: string }) => ({
          id: b.id,
          title: b.title,
          start_time: b.start_time,
          end_time: b.end_time,
        })),
      blackouts: blackouts
        .filter((b: { space_id: string | null }) => b.space_id === s.id || b.space_id === null)
        .map((b: { id: string; start_time: string; end_time: string }) => ({
          id: b.id,
          start_time: b.start_time,
          end_time: b.end_time,
        })),
    })
  )

  return NextResponse.json({
    date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
    spaces,
  })
}
