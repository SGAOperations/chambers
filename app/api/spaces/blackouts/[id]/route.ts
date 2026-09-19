import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
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

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = db
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { space_id, start_time, end_time } = await request.json()

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
  const supabase = db
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { error } = await adminSupabase.from('space_blackouts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
