import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { body_id, purpose, room_name, booking_date, start_time, end_time, reservation_code, status } = await request.json()

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({ body_id, purpose, type: 'One-Time Room', created_by: user.id })
    .select()
    .single()

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Create one-time room booking
  const { error: detailError } = await adminSupabase
    .from('one_time_room_bookings')
    .insert({ booking_id: booking.id, room_name, booking_date, start_time, end_time, reservation_code: reservation_code || null, status })

  if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { booking_id, detail_id, body_id, purpose, room_name, booking_date, start_time, end_time, reservation_code, status } = await request.json()

  const { error: bookingError } = await adminSupabase
    .from('bookings')
    .update({ body_id, purpose })
    .eq('id', booking_id)

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  const { error: detailError } = await adminSupabase
    .from('one_time_room_bookings')
    .update({ room_name, booking_date, start_time, end_time, reservation_code: reservation_code || null, status })
    .eq('id', detail_id)

  if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 })

  const { data: auditLog } = await adminSupabase
    .from('audit_logs')
    .insert({ booking_id, admin_id: user.id, new_status: status })
    .select('id')
    .single()

  const { data: parentBooking } = await adminSupabase
    .from('bookings')
    .select('body_id')
    .eq('id', booking_id)
    .single()

  const { data: members } = await adminSupabase
    .from('board_memberships')
    .select('user_id')
    .eq('body_id', parentBooking?.body_id)

  if (members?.length && auditLog) {
    await adminSupabase.from('user_alerts').insert(
      members.map((m: { user_id: string }) => ({
        user_id: m.user_id,
        audit_log_id: auditLog.id,
        booking_id,
        booking_type: 'One-Time Room',
        booking_date: booking_date,
        start_time: start_time,
      }))
    )
  }

  return NextResponse.json({ success: true })
}