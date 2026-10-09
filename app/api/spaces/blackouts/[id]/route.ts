import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { canManageBlackout, resolveBlackoutAccess, type BlackoutAccess } from '@/lib/blackout-access'
import { IEMS_BLACKOUT_SPACE_NAME } from '@/lib/iems-blackouts'
import { attendeeKeys, cancellationAddressing, resolveSpacesAddresses } from '@/lib/spaces-email'
import { waitUntil } from '@vercel/functions'

const adminSupabase = db

async function cascadeCancelBookings(spaceId: string | null, startTime: string, endTime: string) {
  let q = adminSupabase
    .from('space_bookings')
    .select('id, title, start_time, end_time, creator_id, attendee_ids, external_attendees, spaces(name)')
    .lt('start_time', endTime)
    .gt('end_time', startTime)
  if (spaceId) q = q.eq('space_id', spaceId)

  const { data: affected } = await q
  if (!affected || affected.length === 0) return

  // Wherever each affected person chose to receive SGA Spaces emails (issue #109).
  const addresses = await resolveSpacesAddresses(
    adminSupabase,
    affected.flatMap((b: { creator_id: string; attendee_ids: string[]; external_attendees: string[] | null }) =>
      [b.creator_id, ...attendeeKeys(b)]
    )
  )

  await adminSupabase.from('space_bookings').delete().in('id', affected.map((b: { id: string }) => b.id))

  // Bookings are already deleted; notifying is a post-commit side effect.
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

/**
 * The access the caller has, and -- for IEMS -- whether this blackout is one of
 * theirs to change. Returns the response to send when the answer is no.
 *
 * An admin skips the read: they may change any blackout, and a missing id still
 * surfaces as it always did, from the update or delete itself.
 */
async function authorize(
  id: string,
): Promise<{ userId: string; access: BlackoutAccess } | { response: NextResponse }> {
  const user = await getAuthedUserWithLiveRoles(adminSupabase)
  if (!user) {
    return { response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  // Writing admins and IEMS (#227). Still closed to a view-only admin, who may
  // read Bookings and nothing else (#217) -- see resolveBlackoutAccess().
  const resolved = await resolveBlackoutAccess(adminSupabase, user)
  if ('denied' in resolved) {
    return { response: NextResponse.json({ error: resolved.error }, { status: resolved.denied }) }
  }
  const { access } = resolved

  if (access.kind === 'iems') {
    const { data: existing } = await adminSupabase
      .from('space_blackouts')
      .select('space_id, created_by')
      .eq('id', id)
      .maybeSingle()
    // Not found and not theirs answer the same, so the response does not tell
    // IEMS which ids exist in rooms they cannot see.
    if (!existing || !canManageBlackout(access, user.id, existing)) {
      return {
        response: NextResponse.json(
          { error: `IEMS can change only the ${IEMS_BLACKOUT_SPACE_NAME} blackouts they created.` },
          { status: 403 }
        ),
      }
    }
  }

  return { userId: user.id, access }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(id)
  if ('response' in auth) return auth.response

  const { space_id, start_time, end_time } = await request.json()

  // Moving it is held to the same rule as creating it: IEMS may not carry one
  // of their blackouts to another room, or widen it to every room.
  if (auth.access.kind === 'iems' && space_id !== auth.access.spaceId) {
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
  if (new Date(start_time).getUTCMinutes() % 15 !== 0 || new Date(end_time).getUTCMinutes() % 15 !== 0) {
    return NextResponse.json({ error: 'Blackout times must be on 15-minute intervals.' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('space_blackouts')
    .update({ space_id: space_id || null, start_time, end_time })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await cascadeCancelBookings(space_id || null, start_time, end_time)
  } catch (e) {
    console.error('Blackout edit cascade cancellation failed:', e)
  }

  return NextResponse.json({ success: true, blackout: data })
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const auth = await authorize(id)
  if ('response' in auth) return auth.response

  const { error } = await adminSupabase.from('space_blackouts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
