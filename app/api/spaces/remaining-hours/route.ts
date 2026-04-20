import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DEFAULT_WEEKLY_HOURS = 18

function getWeekBounds(): { weekStart: string; weekEnd: string } {
  const now = new Date()
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
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { weekStart, weekEnd } = getWeekBounds()

  const { data: weekBookings } = await adminSupabase
    .from('space_bookings')
    .select('start_time, end_time')
    .eq('creator_id', user.id)
    .lt('start_time', weekEnd)
    .gt('end_time', weekStart)

  const usedMs = (weekBookings ?? []).reduce((acc: number, b: { start_time: string; end_time: string }) => {
    return acc + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
  }, 0)
  const usedHours = usedMs / (1000 * 60 * 60)

  const { data: override } = await adminSupabase
    .from('space_weekly_limit_overrides')
    .select('weekly_hours_limit')
    .eq('user_id', user.id)
    .maybeSingle()

  const limit = override?.weekly_hours_limit ?? DEFAULT_WEEKLY_HOURS
  const remaining = Math.max(0, limit - usedHours)

  return NextResponse.json({ used: usedHours, limit, remaining })
}
