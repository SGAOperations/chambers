import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { sendSpaceBookingCancelledEmail } from '@/lib/emails/space-booking-cancelled'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function minutesOf(iso: string): number {
  return new Date(iso).getUTCMinutes()
}


export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const spaceId = searchParams.get('space_id')

  let query = adminSupabase.from('space_blackouts').select('*, spaces(name)').order('start_time')
  if (spaceId) query = query.eq('space_id', spaceId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { space_id, start_time, end_time } = await request.json()

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
      .select('id, title, start_time, end_time, creator_id, attendee_ids, spaces(name)')
      .lt('start_time', end_time)
      .gt('end_time', start_time)

    if (space_id) {
      bookingsQuery = bookingsQuery.eq('space_id', space_id)
    }

    const { data: affected } = await bookingsQuery
    if (affected && affected.length > 0) {
      // Collect all user IDs to fetch emails in one query
      const allUserIds = [...new Set(affected.flatMap((b: { creator_id: string; attendee_ids: string[] }) =>
        [b.creator_id, ...(b.attendee_ids ?? [])]
      ))]
      const { data: emailUsers } = await adminSupabase
        .from('users')
        .select('id, email')
        .in('id', allUserIds)
      const emailMap = new Map((emailUsers ?? []).map((u: { id: string; email: string }) => [u.id, u.email]))

      // Delete all affected bookings at once
      await adminSupabase
        .from('space_bookings')
        .delete()
        .in('id', affected.map((b: { id: string }) => b.id))

      // Send cancellation emails
      await Promise.all(affected.map(async (b: { id: string; title: string; start_time: string; end_time: string; creator_id: string; attendee_ids: string[]; spaces: { name: string }[] | null }) => {
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
          cc: ccEmails,
        })
      }))
    }
  } catch (e) {
    console.error('Blackout cascade cancellation failed:', e)
  }

  return NextResponse.json({ success: true, blackout: data })
}
