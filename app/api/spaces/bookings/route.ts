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
  // Times are stored as UTC wall-clock (8 AM displayed = T08:00Z). No offset needed.
  // Block if the booking spans into a different UTC date (crosses midnight)
  const startDate = startIso.slice(0, 10)
  const endDate = endIso.slice(0, 10)
  if (endDate > startDate) return true
  // Same UTC day: block if start is before 07:00
  const startHour = new Date(startIso).getUTCHours() + new Date(startIso).getUTCMinutes() / 60
  return startHour < 7
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

  // Fetch bookings and blackouts in parallel (no join — creator FK points to auth.users which PostgREST can't reach)
  const [
    { data: bookings, error: bookingsError },
    { data: blackouts, error: blackoutsError },
  ] = await Promise.all([
    adminSupabase.from('space_bookings').select('*').eq('space_id', spaceId).lt('start_time', weekEnd).gt('end_time', weekStart).order('start_time'),
    adminSupabase.from('space_blackouts').select('*').or(`space_id.eq.${spaceId},space_id.is.null`).lt('start_time', weekEnd).gt('end_time', weekStart).order('start_time'),
  ])

  if (bookingsError) return NextResponse.json({ error: bookingsError.message }, { status: 500 })
  if (blackoutsError) return NextResponse.json({ error: blackoutsError.message }, { status: 500 })

  // Fetch creator display names from public.users (depends on bookings result)
  const creatorIds = [...new Set((bookings ?? []).map((b: { creator_id: string }) => b.creator_id))]
  const creatorMap: Record<string, string> = {}
  if (creatorIds.length > 0) {
    const { data: creators } = await adminSupabase
      .from('users')
      .select('id, full_name')
      .in('id', creatorIds)
    for (const c of creators ?? []) {
      creatorMap[c.id] = c.full_name
    }
  }

  // Admins see all creator names; regular users only see their own
  const isAdmin = !!user.app_metadata?.is_admin
  const sanitized = (bookings ?? []).map((b: { id: string; creator_id: string; [key: string]: unknown }) => ({
    ...b,
    creator_name: (isAdmin || b.creator_id === user.id) ? (creatorMap[b.creator_id] ?? null) : null,
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

  // Run all validation checks in parallel
  const { weekStart, weekEnd } = getWeekBounds(start_time)

  const [
    { data: overlapping },
    { data: blackoutHit },
    { data: weekBookings },
    { data: override },
  ] = await Promise.all([
    adminSupabase.from('space_bookings').select('id').eq('space_id', space_id).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_blackouts').select('id').or(`space_id.eq.${space_id},space_id.is.null`).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_bookings').select('start_time, end_time').eq('creator_id', user.id).lt('start_time', weekEnd).gt('end_time', weekStart),
    adminSupabase.from('space_weekly_limit_overrides').select('weekly_hours_limit').eq('user_id', user.id).maybeSingle(),
  ])

  if (overlapping && overlapping.length > 0) {
    return NextResponse.json({ error: 'This time slot overlaps with an existing booking for this space.' }, { status: 400 })
  }

  if (blackoutHit && blackoutHit.length > 0) {
    return NextResponse.json({ error: 'This time slot falls within a blackout window.' }, { status: 400 })
  }

  const usedMs = (weekBookings ?? []).reduce((acc: number, b: { start_time: string; end_time: string }) => {
    return acc + (new Date(b.end_time).getTime() - new Date(b.start_time).getTime())
  }, 0)
  const usedHours = usedMs / (1000 * 60 * 60)

  const newDurationHours = (new Date(end_time).getTime() - new Date(start_time).getTime()) / (1000 * 60 * 60)

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
    const allUserIds: string[] = [user.id, ...(attendee_ids ?? [])]
    const [{ data: space }, { data: emailUsers }] = await Promise.all([
      adminSupabase.from('spaces').select('name').eq('id', space_id).single(),
      adminSupabase.from('users').select('email').in('id', allUserIds),
    ])
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
