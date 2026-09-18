import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'
import { sendSpaceBookingUpdatedEmail, type SpaceBookingDetails } from '@/lib/emails/space-booking-updated'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { advanceNoticeError } from '@/lib/spaces-advance-notice'
import {
  EXTERNAL_ATTENDEES_ERROR,
  attendeeKeys,
  cancellationAddressing,
  dedupeEmails,
  parseExternalAttendees,
  resolveSpacesAddresses,
} from '@/lib/spaces-email'
import { waitUntil } from '@vercel/functions'
import { DEFAULT_WEEKLY_HOURS, minutesOf, touchesDeadZone, weekBoundsOf as getWeekBounds } from '@/lib/space-series'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getAuthedUserWithLiveRoles(supabase)
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

  const { title, start_time, end_time, attendee_ids, external_attendees, space_id } = await request.json()

  if (!title || !start_time || !end_time) {
    return NextResponse.json({ error: 'title, start_time, and end_time are required' }, { status: 400 })
  }

  const nextExternals = parseExternalAttendees(external_attendees)
  if (!nextExternals) return NextResponse.json({ error: EXTERNAL_ATTENDEES_ERROR }, { status: 400 })

  if (minutesOf(start_time) % 15 !== 0 || minutesOf(end_time) % 15 !== 0) {
    return NextResponse.json({ error: 'Bookings must start and end on 15-minute intervals.' }, { status: 400 })
  }

  if (new Date(start_time) >= new Date(end_time)) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }

  if (touchesDeadZone(start_time, end_time)) {
    return NextResponse.json({ error: 'Bookings may not start or end between 12:00 AM and 7:00 AM.' }, { status: 400 })
  }

  // The space can change too. Moving is how a meeting follows a room change
  // without being cancelled and rebooked, which would drop it from everyone's
  // calendar and invite them again.
  const spaceId: string = typeof space_id === 'string' && space_id ? space_id : existing.space_id
  const movingSpace = spaceId !== existing.space_id

  // Run all validation checks in parallel
  const { weekStart, weekEnd } = getWeekBounds(start_time)

  const [
    { data: spaces },
    { data: overlapping },
    { data: blackoutHit },
    { data: weekBookings },
    { data: override },
    { data: settings },
  ] = await Promise.all([
    adminSupabase.from('spaces').select('id, name').in('id', [...new Set([existing.space_id, spaceId])]),
    adminSupabase.from('space_bookings').select('id').eq('space_id', spaceId).neq('id', id).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_blackouts').select('id').or(`space_id.eq.${spaceId},space_id.is.null`).lt('start_time', end_time).gt('end_time', start_time).limit(1),
    adminSupabase.from('space_bookings').select('start_time, end_time').eq('creator_id', existing.creator_id).neq('id', id).lt('start_time', weekEnd).gt('end_time', weekStart),
    adminSupabase.from('space_weekly_limit_overrides').select('weekly_hours_limit').eq('user_id', existing.creator_id).maybeSingle(),
    adminSupabase.from('app_settings').select('min_hours_advance_spaces').eq('id', 1).single(),
  ])

  const spaceNameOf = (sid: string) => (spaces ?? []).find(s => s.id === sid)?.name as string | undefined
  if (movingSpace && !spaceNameOf(spaceId)) {
    return NextResponse.json({ error: 'That space does not exist.' }, { status: 400 })
  }

  // Advance notice applies to the time this edit newly claims, not to whether the
  // start moved (issue #94). Shortening a booking, pushing its start later or
  // renaming it releases time or leaves it alone, and needs no notice; only
  // adding time inside the window is refused. Moving to another space claims all
  // of its time there, as a new booking would.
  const minHours: number = settings?.min_hours_advance_spaces ?? 24
  const noticeError = advanceNoticeError(
    { start: start_time, end: end_time },
    movingSpace ? null : { start: existing.start_time, end: existing.end_time },
    minHours
  )
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

  const cleanTitle = title.trim()
  const nextAttendeeIds: string[] = Array.isArray(attendee_ids) ? attendee_ids : []

  const { data: updated, error: updateError } = await adminSupabase
    .from('space_bookings')
    .update({
      title: cleanTitle, start_time, end_time, attendee_ids: nextAttendeeIds, external_attendees: nextExternals, space_id: spaceId,
    })
    .eq('id', id)
    .select()
    .single()

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // Calendars only learn about an edit from an email, so an edit that sent none
  // left every calendar showing the booking as it was first made. Each email
  // counts every recipient against the Resend quota, so each goes only to the
  // people whose calendar it changes, and a save that changes nothing sends none.
  const previous: SpaceBookingDetails = {
    title: existing.title,
    spaceName: spaceNameOf(existing.space_id) ?? 'SGA Space',
    startTime: existing.start_time,
    endTime: existing.end_time,
  }
  const booking: SpaceBookingDetails = {
    title: cleanTitle,
    spaceName: spaceNameOf(spaceId) ?? 'SGA Space',
    startTime: start_time,
    endTime: end_time,
  }
  const detailsChanged =
    booking.title !== previous.title ||
    movingSpace ||
    Date.parse(booking.startTime) !== Date.parse(previous.startTime) ||
    Date.parse(booking.endTime) !== Date.parse(previous.endTime)

  // Chambers users and external addresses alike, as keys (see attendeeKeys).
  const nextAttendees = attendeeKeys({ attendee_ids: nextAttendeeIds, external_attendees: nextExternals })
  const previousAttendees = attendeeKeys(existing)
  const addedAttendees = nextAttendees.filter(a => !previousAttendees.includes(a))
  const removedAttendees = previousAttendees.filter(a => !nextAttendees.includes(a) && a !== existing.creator_id)

  if (detailsChanged || addedAttendees.length > 0 || removedAttendees.length > 0) {
    waitUntil(
      (async () => {
        try {
          const currentIds = [existing.creator_id, ...nextAttendees]
          const addresses = await resolveSpacesAddresses(adminSupabase, [...currentIds, ...removedAttendees])
          const addressesOf = (ids: string[]) => dedupeEmails(ids.flatMap(u => addresses.get(u) ?? []))
          const current = addressesOf(currentIds)
          const inCurrent = new Set(current.map(e => e.toLowerCase()))

          if (detailsChanged) {
            // Everyone on the booking now, including anyone just added: the
            // invite puts the event on a calendar that lacks it and moves it on
            // one that has it.
            await sendSpaceBookingUpdatedEmail({ bookingId: id, booking, previous, recipients: current })
          } else if (addedAttendees.length > 0) {
            // Nothing moved, so only the new attendees need the invite. An inbox
            // someone already on the booking also uses -- a shared SGA inbox --
            // already has it.
            const held = new Set(addressesOf([existing.creator_id, ...previousAttendees]).map(e => e.toLowerCase()))
            const recipients = addressesOf(addedAttendees).filter(e => !held.has(e.toLowerCase()))
            await sendSpaceBookingUpdatedEmail({
              bookingId: id, booking, previous: booking, recipients,
              intro: 'You have been added to an SGA Space booking.',
            })
          }

          // Someone taken off the booking still has it on their calendar. The
          // cancellation describes it as they last saw it, and skips an inbox a
          // current recipient also uses, since that inbox should keep the event.
          const dropped = addressesOf(removedAttendees).filter(e => !inCurrent.has(e.toLowerCase()))
          if (dropped.length > 0) {
            await sendSpaceBookingCancelledEmail({
              bookingId: id,
              title: previous.title,
              spaceName: previous.spaceName,
              startTime: previous.startTime,
              endTime: previous.endTime,
              to: [process.env.RESEND_FROM_EMAIL!],
              bcc: dropped,
              intro: 'You have been removed from this SGA Space booking.',
            })
          }
        } catch (e) {
          console.error('Space booking update email failed:', e)
        }
      })()
    )
  }

  return NextResponse.json({ success: true, booking: updated })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
  const user = await getAuthedUserWithLiveRoles(supabase)
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
        // Sent wherever each person chose to receive SGA Spaces emails (issue #109),
        // so the cancellation reaches the same inbox the invite did.
        const addresses = await resolveSpacesAddresses(
          adminSupabase, [booking.creator_id, ...attendeeKeys(booking)]
        )
        const { to, bcc } = cancellationAddressing(addresses, booking.creator_id, attendeeKeys(booking))
        const spaceName = (booking.spaces as { name: string } | null)?.name ?? 'SGA Space'
        await sendSpaceBookingCancelledEmail({
          bookingId: id,
          title: booking.title,
          spaceName,
          startTime: booking.start_time,
          endTime: booking.end_time,
          to,
          bcc,
        })
      } catch (e) {
        console.error('Space booking cancellation email failed:', e)
      }
    })()
  )

  return NextResponse.json({ success: true })
}
