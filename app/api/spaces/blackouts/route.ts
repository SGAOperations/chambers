import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { canManageBlackout, resolveBlackoutAccess } from '@/lib/blackout-access'
import { IEMS_BLACKOUT_SPACE_NAME } from '@/lib/iems-blackouts'
import { attendeeKeys, cancellationAddressing, resolveSpacesAddresses } from '@/lib/spaces-email'
import { waitUntil } from '@vercel/functions'

const adminSupabase = db

function minutesOf(iso: string): number {
  return new Date(iso).getUTCMinutes()
}


export async function GET(request: Request) {
  const supabase = db
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Writing admins and IEMS (#227). Still closed to a view-only admin, who may
  // read Bookings and nothing else (#217) -- see resolveBlackoutAccess().
  const resolved = await resolveBlackoutAccess(adminSupabase, user)
  if ('denied' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.denied })
  }
  const { access } = resolved

  const { searchParams } = new URL(request.url)
  const spaceId = searchParams.get('space_id')

  let query = adminSupabase.from('space_blackouts').select('*, spaces(name)').order('start_time')
  if (access.kind === 'iems') {
    // IEMS sees what covers the Conference Room, whatever it asked for. The
    // all-spaces blackouts come too: they close the room just the same, and
    // leaving them out would show IEMS a free room that is not.
    query = query.or(`space_id.eq.${access.spaceId},space_id.is.null`)
  } else if (spaceId) {
    query = query.eq('space_id', spaceId)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Each row says whether this caller may edit or delete it, so the page shows
  // the controls the server will honour rather than re-deriving the rule.
  const rows = ((data ?? []) as { space_id: string | null; created_by: string | null }[])
    .map(b => ({ ...b, can_manage: canManageBlackout(access, user.id, b) }))
  return NextResponse.json(rows)
}

export async function POST(request: Request) {
  const supabase = db
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Writing admins and IEMS (#227). Still closed to a view-only admin (#217).
  const resolved = await resolveBlackoutAccess(adminSupabase, user)
  if ('denied' in resolved) {
    return NextResponse.json({ error: resolved.error }, { status: resolved.denied })
  }
  const { access } = resolved

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { space_id, start_time, end_time } = await request.json()

  // An empty space_id means every space, which IEMS may not close; anything
  // other than the Conference Room's id is a room that is not theirs.
  if (access.kind === 'iems' && space_id !== access.spaceId) {
    return NextResponse.json(
      { error: `IEMS can black out the ${IEMS_BLACKOUT_SPACE_NAME} only.` },
      { status: 403 }
    )
  }

  if (!start_time || !end_time) {
    return NextResponse.json({ error: 'start_time and end_time are required' }, { status: 400 })
  }

  if (new Date(start_time) >= new Date(end_time)) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }

  if (minutesOf(start_time) % 15 !== 0 || minutesOf(end_time) % 15 !== 0) {
    return NextResponse.json({ error: 'Blackout times must be on 15-minute intervals.' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('space_blackouts')
    .insert({ space_id: space_id || null, start_time, end_time, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Force-cancel all bookings that overlap with this blackout
  try {
    let bookingsQuery = adminSupabase
      .from('space_bookings')
      .select('id, title, start_time, end_time, creator_id, attendee_ids, external_attendees, spaces(name)')
      .lt('start_time', end_time)
      .gt('end_time', start_time)

    if (space_id) {
      bookingsQuery = bookingsQuery.eq('space_id', space_id)
    }

    const { data: affected } = await bookingsQuery
    if (affected && affected.length > 0) {
      // Resolve every affected person's inbox in one pass -- wherever they chose
      // to receive SGA Spaces emails (issue #109).
      const addresses = await resolveSpacesAddresses(
        adminSupabase,
        affected.flatMap((b: { creator_id: string; attendee_ids: string[]; external_attendees: string[] | null }) =>
          [b.creator_id, ...attendeeKeys(b)]
        )
      )

      // Delete all affected bookings at once
      await adminSupabase
        .from('space_bookings')
        .delete()
        .in('id', affected.map((b: { id: string }) => b.id))

      // The bookings are already deleted above, so the notifications are a
      // post-commit side effect. Previously the admin's request blocked on one
      // Resend call per affected booking, which could run into seconds.
      waitUntil(
        Promise.all(affected.map(async (b: { id: string; title: string; start_time: string; end_time: string; creator_id: string; attendee_ids: string[]; external_attendees: string[] | null; spaces: { name: string }[] | null }) => {
          const { to, bcc } = cancellationAddressing(addresses, b.creator_id, attendeeKeys(b))
          await sendSpaceBookingCancelledEmail({
            bookingId: b.id,
            title: b.title,
            spaceName: (Array.isArray(b.spaces) ? b.spaces[0]?.name : null) ?? 'SGA Space',
            startTime: b.start_time,
            endTime: b.end_time,
            to,
            bcc,
          })
        })).catch(e => console.error('Blackout cascade emails failed:', e))
      )
    }
  } catch (e) {
    console.error('Blackout cascade cancellation failed:', e)
  }

  return NextResponse.json({ success: true, blackout: data })
}
