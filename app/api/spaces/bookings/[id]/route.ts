import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'
import { getAuthedUser } from '@/lib/auth'
import { waitUntil } from '@vercel/functions'

const DEFAULT_WEEKLY_HOURS = 18

function getWeekBounds(iso: string): { weekStart: string; weekEnd: string } {
  const d = new Date(iso)
  const day = d.getUTCDay()
  const sun = new Date(d)
  sun.setUTCDate(d.getUTCDate() - day)
  sun.setUTCHours(0, 0, 0, 0)
  const sat = new Date(sun)
  sat.setUTCDate(sun.getUTCDate() + 7)
  return { weekStart: sun.toISOString(), weekEnd: sat.toISOString() }
}

function minutesOf(iso: string): number {
  return new Date(iso).getUTCMinutes()
}

function touchesDeadZone(startIso: string, endIso: string): boolean {
  const startDate = startIso.slice(0, 10)
  const endDate = endIso.slice(0, 10)
  if (endDate > startDate) {
    const end = new Date(endIso)
    const endsAtMidnight = end.getUTCHours() === 0 && end.getUTCMinutes() === 0 && end.getUTCSeconds() === 0
    const nextDay = new Date(`${startDate}T00:00:00Z`)
    nextDay.setUTCDate(nextDay.getUTCDate() + 1)
    const isConsecutiveDay = endDate === nextDay.toISOString().slice(0, 10)
    if (!endsAtMidnight || !isConsecutiveDay) return true
  }
  const startHour = new Date(startIso).getUTCHours() + new Date(startIso).getUTCMinutes() / 60
  return startHour < 7
}

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await params

  const { data: existing, error: fetchError } = await adminSupabase
    .from('space_bookings')
    .select('*')
    .eq('id', id)
    .single()

  if (fetchError || !existing) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  const isAdmin = !!user.app_metadata?.is_admin
  if (existing.creator_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { title, start_time, end_time, attendee_ids } = await request.json()

  if (!title || !start_time || !end_time) {
    return NextResponse.json({ error: 'title, start_time, and end_time are required' }, { status: 400 })
  }

  if (minutesOf(start_time) % 15 !== 0 || minutesOf(end_time) % 15 !== 0) {
    return NextResponse.json({ error: 'Bookings must start and end on 15-minute intervals.' }, { status: 400 })
  }

  if (new Date(start_time) >= new Date(end_time)) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }

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
    adminSupabase.from('space_bookings').select('id').eq('space_id', existing.space_id).neq('id', id).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_blackouts').select('id').or(`space_id.eq.${existing.space_id},space_id.is.null`).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_bookings').select('start_time, end_time').eq('creator_id', existing.creator_id).neq('id', id).lt('start_time', weekEnd).gt('end_time', weekStart),
    adminSupabase.from('space_weekly_limit_overrides').select('weekly_hours_limit').eq('user_id', existing.creator_id).maybeSingle(),
    adminSupabase.from('app_settings').select('min_hours_advance_spaces').eq('id', 1).single(),
  ])

  // Advance notice check — only enforce if start_time changed and limit > 0
  const minHours: number = settings?.min_hours_advance_spaces ?? 24
  const startTimeChanged = start_time !== existing.start_time
  if (minHours > 0 && startTimeChanged) {
    const earliestAllowed = new Date(Date.now() + minHours * 60 * 60 * 1000)
    if (new Date(start_time) < earliestAllowed) {
      return NextResponse.json({
        error: `Bookings must be made at least ${minHours} hour${minHours === 1 ? '' : 's'} in advance.`,
      }, { status: 400 })
    }
  }

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

  const { data: updated, error: updateError } = await adminSupabase
    .from('space_bookings')
    .update({ title: title.trim(), start_time, end_time, attendee_ids: attendee_ids ?? [] })
    .eq('id', id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  return NextResponse.json({ success: true, booking: updated })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params

  const { data: booking, error: fetchError } = await adminSupabase
    .from('space_bookings')
    .select('*, spaces(name)')
    .eq('id', id)
    .single()

  if (fetchError || !booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  // Only creator or admin can cancel
  const isAdmin = !!user.app_metadata?.is_admin
  if (booking.creator_id !== user.id && !isAdmin) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { error: deleteError } = await adminSupabase.from('space_bookings').delete().eq('id', id)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  // The row is already deleted, so notifying is a post-commit side effect.
  waitUntil(
    (async () => {
      try {
        const allUserIds: string[] = [...new Set([booking.creator_id, ...(booking.attendee_ids ?? [])])]
        const { data: emailUsers } = await adminSupabase
          .from('users')
          .select('id, email')
          .in('id', allUserIds)
        const userMap = new Map((emailUsers ?? []).map((u: { id: string; email: string }) => [u.id, u.email]))
        const creatorEmail = userMap.get(booking.creator_id)
        const ccEmails = (booking.attendee_ids ?? [])
          .map((id: string) => userMap.get(id))
          .filter((e: string | undefined): e is string => !!e && e !== creatorEmail)
        const spaceName = (booking.spaces as { name: string } | null)?.name ?? 'SGA Space'
        if (creatorEmail) {
          await sendSpaceBookingCancelledEmail({
            bookingId: id,
            title: booking.title,
            spaceName,
            startTime: booking.start_time,
            endTime: booking.end_time,
            to: creatorEmail,
            cc: ccEmails,
          })
        }
      } catch (e) {
        console.error('Space booking cancellation email failed:', e)
      }
    })()
  )

  return NextResponse.json({ success: true })
}
