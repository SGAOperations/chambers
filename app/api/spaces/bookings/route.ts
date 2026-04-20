import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { sendSpaceBookingConfirmedEmail } from '@/lib/emails/space-booking-confirmed'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DEFAULT_WEEKLY_HOURS = 18

// Returns the Sunday (00:00 UTC) and following Saturday (end of day UTC) bounding a given date
function getWeekBounds(iso: string): { weekStart: string; weekEnd: string } {
  const d = new Date(iso)
  const day = d.getUTCDay() // 0 = Sun
  const sun = new Date(d)
  sun.setUTCDate(d.getUTCDate() - day)
  sun.setUTCHours(0, 0, 0, 0)
  const sat = new Date(sun)
  sat.setUTCDate(sun.getUTCDate() + 7)
  return { weekStart: sun.toISOString(), weekEnd: sat.toISOString() }
}

function minutesOf(iso: string): number {
  const d = new Date(iso)
  return d.getUTCMinutes()
}

// Returns true if any part of [start, end) falls in 00:00–07:00 local ET
function touchesDeadZone(startIso: string, endIso: string): boolean {
  // Check every hour boundary within the range
  const start = new Date(startIso)
  const end = new Date(endIso)
  const etOffset = -5 * 60 // EST; close enough for hard-block purposes
  const startLocal = new Date(start.getTime() + etOffset * 60000)
  const endLocal = new Date(end.getTime() + etOffset * 60000)
  const startHour = startLocal.getUTCHours() + startLocal.getUTCMinutes() / 60
  const endHour = endLocal.getUTCHours() + endLocal.getUTCMinutes() / 60
  // Dead zone: [0, 7)
  // A booking touches it if startHour < 7 OR (the booking spans midnight into it)
  // Simplified: if start hour < 7 or end hour > 0 and < 7 (same day) — we check start and end both in ET
  if (startHour < 7) return true
  if (endHour > 0 && endHour <= 7 && endHour < startHour) return true // crosses midnight into dead zone
  // Check if booking spans more than a day and inevitably crosses midnight
  const durationMs = end.getTime() - start.getTime()
  if (durationMs >= 17 * 60 * 60 * 1000) return true // >= 17 hrs means it must cross 12am–7am
  return false
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const spaceId = searchParams.get('space_id')
  const weekStart = searchParams.get('week_start') // ISO string for Sunday 00:00

  if (!spaceId || !weekStart) {
    return NextResponse.json({ error: 'space_id and week_start required' }, { status: 400 })
  }

  const weekEnd = new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // Fetch bookings with creator display name
  const { data: bookings, error: bookingsError } = await adminSupabase
    .from('space_bookings')
    .select('*, creator:users!space_bookings_creator_id_fkey(id, full_name, email)')
    .eq('space_id', spaceId)
    .lt('start_time', weekEnd)
    .gt('end_time', weekStart)
    .order('start_time')

  if (bookingsError) return NextResponse.json({ error: bookingsError.message }, { status: 500 })

  // Fetch blackouts for this space (space-specific or all-spaces)
  const { data: blackouts, error: blackoutsError } = await adminSupabase
    .from('space_blackouts')
    .select('*')
    .or(`space_id.eq.${spaceId},space_id.is.null`)
    .lt('start_time', weekEnd)
    .gt('end_time', weekStart)
    .order('start_time')

  if (blackoutsError) return NextResponse.json({ error: blackoutsError.message }, { status: 500 })

  // Redact creator name for non-owners
  const sanitized = (bookings ?? []).map((b: {
    id: string
    creator_id: string
    creator: { id: string; full_name: string; email: string } | null
    [key: string]: unknown
  }) => ({
    ...b,
    creator_name: b.creator_id === user.id ? (b.creator as { full_name: string } | null)?.full_name ?? null : null,
    creator: undefined,
  }))

  return NextResponse.json({ bookings: sanitized, blackouts: blackouts ?? [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { space_id, title, start_time, end_time, attendee_ids } = await request.json()

  if (!space_id || !title || !start_time || !end_time) {
    return NextResponse.json({ error: 'space_id, title, start_time, and end_time are required' }, { status: 400 })
  }

  // 15-minute interval check
  if (minutesOf(start_time) % 15 !== 0 || minutesOf(end_time) % 15 !== 0) {
    return NextResponse.json({ error: 'Bookings must start and end on 15-minute intervals.' }, { status: 400 })
  }

  // Start must be before end
  if (new Date(start_time) >= new Date(end_time)) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }

  // 12am–7am dead zone
  if (touchesDeadZone(start_time, end_time)) {
    return NextResponse.json({ error: 'Bookings may not start or end between 12:00 AM and 7:00 AM.' }, { status: 400 })
  }

  // Overlap check
  const { data: overlapping } = await adminSupabase
    .from('space_bookings')
    .select('id')
    .eq('space_id', space_id)
    .lt('start_time', end_time)
    .gt('end_time', start_time)
    .limit(1)

  if (overlapping && overlapping.length > 0) {
    return NextResponse.json({ error: 'This time slot overlaps with an existing booking for this space.' }, { status: 400 })
  }

  // Blackout check
  const { data: blackoutHit } = await adminSupabase
    .from('space_blackouts')
    .select('id')
    .or(`space_id.eq.${space_id},space_id.is.null`)
    .lt('start_time', end_time)
    .gt('end_time', start_time)
    .limit(1)

  if (blackoutHit && blackoutHit.length > 0) {
    return NextResponse.json({ error: 'This time slot falls within a blackout window.' }, { status: 400 })
  }

  // Weekly hour limit check
  const { weekStart, weekEnd } = getWeekBounds(start_time)

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

  const newDurationHours = (new Date(end_time).getTime() - new Date(start_time).getTime()) / (1000 * 60 * 60)

  const { data: override } = await adminSupabase
    .from('space_weekly_limit_overrides')
    .select('weekly_hours_limit')
    .eq('user_id', user.id)
    .maybeSingle()

  const limitHours = override?.weekly_hours_limit ?? DEFAULT_WEEKLY_HOURS
  const remainingHours = limitHours - usedHours

  if (usedHours + newDurationHours > limitHours) {
    return NextResponse.json({
      error: `Weekly limit exceeded. You have ${remainingHours.toFixed(1)} hr${remainingHours === 1 ? '' : 's'} remaining this week (limit: ${limitHours} hrs Sun–Sat).`,
    }, { status: 400 })
  }

  // Insert booking
  const { data: booking, error: insertError } = await adminSupabase
    .from('space_bookings')
    .insert({
      space_id,
      creator_id: user.id,
      title,
      start_time,
      end_time,
      attendee_ids: attendee_ids ?? [],
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // Send confirmation email
  try {
    const { data: space } = await adminSupabase.from('spaces').select('name').eq('id', space_id).single()
    const allUserIds: string[] = [user.id, ...(attendee_ids ?? [])]
    const { data: emailUsers } = await adminSupabase
      .from('users')
      .select('email')
      .in('id', allUserIds)
    const emails = (emailUsers ?? []).map((u: { email: string }) => u.email).filter(Boolean)
    await sendSpaceBookingConfirmedEmail({
      title,
      spaceName: space?.name ?? 'SGA Space',
      startTime: start_time,
      endTime: end_time,
      recipients: emails,
    })
  } catch (e) {
    console.error('Space booking confirmation email failed:', e)
  }

  return NextResponse.json({ success: true, booking })
}
