import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { waitUntil } from '@vercel/functions'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

async function cascadeCancelBookings(spaceId: string | null, startTime: string, endTime: string) {
  let q = adminSupabase
    .from('space_bookings')
    .select('id, title, start_time, end_time, creator_id, attendee_ids, spaces(name)')
    .lt('start_time', endTime)
    .gt('end_time', startTime)
  if (spaceId) q = q.eq('space_id', spaceId)

  const { data: affected } = await q
  if (!affected || affected.length === 0) return

  const allUserIds = [...new Set(affected.flatMap((b: { creator_id: string; attendee_ids: string[] }) =>
    [b.creator_id, ...(b.attendee_ids ?? [])]
  ))]
  const { data: emailUsers } = await adminSupabase.from('users').select('id, email').in('id', allUserIds)
  const emailMap = new Map((emailUsers ?? []).map((u: { id: string; email: string }) => [u.id, u.email]))

  await adminSupabase.from('space_bookings').delete().in('id', affected.map((b: { id: string }) => b.id))

  // Bookings are already deleted; notifying is a post-commit side effect.
  waitUntil(
    Promise.all(affected.map(async (b: { id: string; title: string; start_time: string; end_time: string; creator_id: string; attendee_ids: string[]; spaces: { name: string }[] | null }) => {
      const creatorEmail = emailMap.get(b.creator_id)
      if (!creatorEmail) return
      const ccEmails = (b.attendee_ids ?? [])
        .map((id: string) => emailMap.get(id))
        .filter((e): e is string => !!e && e !== creatorEmail)
      await sendSpaceBookingCancelledEmail({
        bookingId: b.id,
        title: b.title,
        spaceName: (Array.isArray(b.spaces) ? b.spaces[0]?.name : null) ?? 'SGA Space',
        startTime: b.start_time,
        endTime: b.end_time,
        to: creatorEmail,
        bcc: ccEmails,
      })
    })).catch(e => console.error('Blackout cascade emails failed:', e))
  )
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()
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
  const supabase = await createClient()
  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id } = await params
  const { error } = await adminSupabase.from('space_blackouts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true })
}
