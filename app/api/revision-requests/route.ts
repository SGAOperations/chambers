import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, change_type, new_start_time, new_end_time, new_room, more_info } = await request.json()

  const { data: bookingRow } = await adminSupabase
    .from('bookings')
    .select('body_id')
    .eq('id', booking_id)
    .single()

  if (!bookingRow) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  if (!user.app_metadata?.is_admin) {
    const { data: membership } = await supabase
      .from('board_memberships')
      .select('id')
      .eq('user_id', user.id)
      .eq('body_id', bookingRow.body_id)
      .eq('role', 'Leadership')
      .maybeSingle()

    if (!membership) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Block if a pending revision request already exists for this booking
  const { data: existing } = await adminSupabase
    .from('revision_requests')
    .select('id')
    .eq('booking_id', booking_id)
    .eq('status', 'Pending')
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'A revision request for this booking is already pending.' },
      { status: 409 }
    )
  }

  const { error } = await adminSupabase
    .from('revision_requests')
    .insert({
      booking_id,
      requested_by: user.id,
      change_type,
      new_start_time: new_start_time || null,
      new_end_time: new_end_time || null,
      new_room: new_room || null,
      more_info,
      status: 'Pending',
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
