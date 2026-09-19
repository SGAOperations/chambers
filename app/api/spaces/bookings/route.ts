import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { advanceNoticeError } from '@/lib/spaces-advance-notice'
import { sendSpaceBookingConfirmedEmail } from '@/lib/emails/space-booking-confirmed'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import {
  EXTERNAL_ATTENDEES_ERROR,
  attendeeKeys,
  dedupeEmails,
  parseExternalAttendees,
  resolveSpacesAddresses,
} from '@/lib/spaces-email'
import { waitUntil } from '@vercel/functions'
import { DEFAULT_WEEKLY_HOURS, minutesOf, touchesDeadZone, weekBoundsOf as getWeekBounds } from '@/lib/space-series'

const adminSupabase = db

export async function GET(request: Request) {
  const supabase = db
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = new URL(request.url)
  const spaceId = searchParams.get('space_id')
  const weekStart = searchParams.get('week_start') // ISO string for Sunday 00:00

  if (!spaceId || !weekStart) {
    return NextResponse.json({ error: 'space_id and week_start required' }, { status: 400 })
  }

  const weekEndParam = searchParams.get('week_end')
  const weekEnd = weekEndParam ?? new Date(new Date(weekStart).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()

  // space_id=all is the All spaces view: every space's bookings and every
  // blackout, each still carrying the space_id the calendar sorts it by.
  const allSpaces = spaceId === 'all'

  let bookingsQuery = adminSupabase.from('space_bookings').select('*').lt('start_time', weekEnd).gt('end_time', weekStart).order('start_time')
  let blackoutsQuery = adminSupabase.from('space_blackouts').select('*').lt('start_time', weekEnd).gt('end_time', weekStart).order('start_time')
  if (!allSpaces) {
    bookingsQuery = bookingsQuery.eq('space_id', spaceId)
    blackoutsQuery = blackoutsQuery.or(`space_id.eq.${spaceId},space_id.is.null`)
  }

  // Fetch bookings and blackouts in parallel (no join — creator FK points to auth.users which PostgREST can't reach)
  const [
    { data: bookings, error: bookingsError },
    { data: blackouts, error: blackoutsError },
  ] = await Promise.all([bookingsQuery, blackoutsQuery])

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
  const supabase = db
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  // Only admins and Leadership members may create space bookings
  const isAdmin = !!user.app_metadata?.is_admin
  if (!isAdmin) {
    const { data: leadership } = await adminSupabase
      .from('board_memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('role', 'Leadership')
      .limit(1)
    if (!leadership || leadership.length === 0) {
      return NextResponse.json({ error: 'Only Leadership members and administrators may create space bookings.' }, { status: 403 })
    }
  }

  const { space_id, title, start_time, end_time, attendee_ids, external_attendees } = await request.json()

  if (!space_id || !title || !start_time || !end_time) {
    return NextResponse.json({ error: 'space_id, title, start_time, and end_time are required' }, { status: 400 })
  }

  const externals = parseExternalAttendees(external_attendees)
  if (!externals) return NextResponse.json({ error: EXTERNAL_ATTENDEES_ERROR }, { status: 400 })

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
    { data: settings },
  ] = await Promise.all([
    adminSupabase.from('space_bookings').select('id').eq('space_id', space_id).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_blackouts').select('id').or(`space_id.eq.${space_id},space_id.is.null`).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_bookings').select('start_time, end_time').eq('creator_id', user.id).lt('start_time', weekEnd).gt('end_time', weekStart),
    adminSupabase.from('space_weekly_limit_overrides').select('weekly_hours_limit').eq('user_id', user.id).maybeSingle(),
    adminSupabase.from('app_settings').select('min_hours_advance_spaces').eq('id', 1).single(),
  ])

  // Advance notice check (skipped when limit is 0). A creation claims its whole
  // interval, so the shared rule reduces to the same test it always ran here --
  // it is shared with the PATCH route, where the interesting case lives (#94).
  const minHours: number = settings?.min_hours_advance_spaces ?? 24
  const noticeError = advanceNoticeError({ start: start_time, end: end_time }, null, minHours)
  if (noticeError) return NextResponse.json({ error: noticeError }, { status: 400 })

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
      external_attendees: externals,
    })
    .select()
    .single()

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  // The booking is already committed, so the confirmation email is a post-commit
  // side effect. Run it after the response instead of making the user wait on
  // two more queries plus a Resend call.
  waitUntil(
    (async () => {
      try {
        const allUserIds: string[] = [user.id, ...attendeeKeys({ attendee_ids, external_attendees: externals })]
        // Each person's own choice of inbox, creator and attendees alike (issue #109).
        const [{ data: space }, addresses] = await Promise.all([
          adminSupabase.from('spaces').select('name').eq('id', space_id).single(),
          resolveSpacesAddresses(adminSupabase, allUserIds),
        ])
        const emails = dedupeEmails(allUserIds.flatMap(id => addresses.get(id) ?? []))
        await sendSpaceBookingConfirmedEmail({
          bookingId: booking.id,
          title,
          spaceName: space?.name ?? 'SGA Space',
          startTime: start_time,
          endTime: end_time,
          recipients: emails,
        })
      } catch (e) {
        console.error('Space booking confirmation email failed:', e)
      }
    })()
  )

  return NextResponse.json({ success: true, booking })
}
