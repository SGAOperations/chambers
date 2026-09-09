import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { bostonWallClockNow } from '@/lib/boston-time'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DEFAULT_WEEKLY_HOURS = 18

/**
 * The Sun-Sat window to count this user's hours against.
 *
 * Boston wall-clock now, matching the domain space_bookings are stored in. Real
 * UTC put the boundary in the wrong place for the last four hours of a Saturday
 * -- UTC is already Sunday by 8 PM EDT, so bookings were counted against next
 * week and the remaining-hours figure jumped. Same root cause as issue #87.
 */
function getWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = bostonWallClockNow()
  const day = now.getUTCDay()
  const sun = new Date(now)
  sun.setUTCDate(now.getUTCDate() - day)
  sun.setUTCHours(0, 0, 0, 0)
  const sat = new Date(sun)
  sat.setUTCDate(sun.getUTCDate() + 7)
  return { weekStart: sun.toISOString(), weekEnd: sat.toISOString() }
}

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { weekStart, weekEnd } = getWeekBounds()

  const [{ data: weekBookings }, { data: override }, { data: settings }] = await Promise.all([
    adminSupabase.from('space_bookings').select('start_time, end_time').eq('creator_id', user.id).lt('start_time', weekEnd).gt('end_time', weekStart),
    adminSupabase.from('space_weekly_limit_overrides').select('weekly_hours_limit').eq('user_id', user.id).maybeSingle(),
    adminSupabase.from('app_settings').select('min_hours_advance_spaces').eq('id', 1).single(),
  ])

  const usedMs = (weekBookings ?? []).reduce((acc: number, b: { start_time: string; end_time: string }) => {
    return acc + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
  }, 0)
  const usedHours = usedMs / (1000 * 60 * 60)

  const limit = override?.weekly_hours_limit ?? DEFAULT_WEEKLY_HOURS
  const remaining = Math.max(0, limit - usedHours)

  const minHoursAdvance: number = settings?.min_hours_advance_spaces ?? 24
  return NextResponse.json({ used: usedHours, limit, remaining, user_id: user.id, min_hours_advance: minHoursAdvance })
}
