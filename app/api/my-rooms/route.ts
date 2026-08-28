import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { fetchMyRooms, MyRoomsQueryError } from '@/lib/my-rooms-data'

/**
 * The refresh path for My Rooms. First paint no longer comes through here -- the
 * /my-rooms server page calls fetchMyRooms() directly while rendering -- so this
 * now serves re-reads after a cancel, a revision, or a Senate-preference change.
 */
export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Started, not awaited. The limiter is an Upstash HTTP round trip, and awaiting
  // it here put that latency in front of every query below on any instance that
  // had not already seen this user (the ephemeralCache only helps a repeat caller
  // on the same warm instance). Reads are idempotent, so letting the data start in
  // parallel costs nothing: the verdict is still checked before anything is
  // returned, so a throttled caller is refused either way.
  const rateLimitPromise = checkRateLimit(user.id)

  try {
    const payload = await fetchMyRooms(supabase, user)

    const rateLimitRes = await rateLimitPromise
    if (rateLimitRes) return rateLimitRes

    return NextResponse.json(payload)
  } catch (err) {
    // Surface query failures instead of coercing them to an empty list. A malformed
    // embed (e.g. PGRST201, an ambiguous relationship) otherwise renders as a calm
    // "no bookings found", which is indistinguishable from genuinely having none.
    if (err instanceof MyRoomsQueryError) {
      return NextResponse.json({ error: err.message }, { status: 500 })
    }
    throw err
  }
}
