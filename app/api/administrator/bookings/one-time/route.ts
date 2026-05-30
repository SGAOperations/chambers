import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendMissedReservationEmail, formatDateLong } from '@/lib/emails/missed-reservation'
import { sendBookingUpdatedEmail } from '@/lib/emails/booking-updated'
import { checkRateLimit } from '@/lib/check-rate-limit'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

interface OneTimeSession {
  room_name: string
  booking_date: string
  start_time: string
  end_time: string
  status: string
  reservation_code: string
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { body_id, purpose, sessions, semester_id } = await request.json()

  const { data: semester } = await adminSupabase
    .from('semesters')
    .select('id')
    .eq('id', semester_id)
    .single()

  if (!semester) {
    return NextResponse.json({ error: 'Invalid semester.' }, { status: 400 })
  }

  const { data: userData } = await adminSupabase
    .from('users')
    .select('admin_role')
    .eq('id', user.id)
    .single()

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({ body_id, purpose, type: 'One-Time Room', created_by: user.id, creator_role: userData?.admin_role ?? null, semester_id })
    .select()
    .single()

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Create one-time room booking rows
  const sessionRows = sessions.map((s: OneTimeSession) => ({
    booking_id: booking.id,
    room_name: s.room_name || null,
    booking_date: s.booking_date,
    start_time: s.start_time,
    end_time: s.end_time,
    reservation_code: s.reservation_code || null,
    status: s.status,
  }))

  const { error: detailError } = await adminSupabase
    .from('one_time_room_bookings')
    .insert(sessionRows)

  if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, body_id, purpose, sessions } = await request.json()

  const { error: bookingError } = await adminSupabase
    .from('bookings')
    .update({ body_id, purpose })
    .eq('id', booking_id)

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Delete existing session rows and reinsert
  const { error: deleteError } = await adminSupabase
    .from('one_time_room_bookings')
    .delete()
    .eq('booking_id', booking_id)

  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 500 })

  const sessionRows = sessions.map((s: OneTimeSession) => ({
    booking_id,
    room_name: s.room_name || null,
    booking_date: s.booking_date,
    start_time: s.start_time,
    end_time: s.end_time,
    reservation_code: s.reservation_code || null,
    status: s.status,
  }))

  const { error: insertError } = await adminSupabase
    .from('one_time_room_bookings')
    .insert(sessionRows)

  if (insertError) return NextResponse.json({ error: insertError.message }, { status: 500 })

  const firstSession = sessions[0] as OneTimeSession

  const { data: auditLog } = await adminSupabase
    .from('audit_logs')
    .insert({ booking_id, admin_id: user.id, new_status: firstSession.status })
    .select('id')
    .single()

  const { data: bodyData } = await adminSupabase
    .from('bodies')
    .select('name')
    .eq('id', body_id)
    .single()
  const bodyName = bodyData?.name ?? 'Unknown'

  const { data: members } = await adminSupabase
    .from('board_memberships')
    .select('user_id, users(email, is_active)')
    .eq('body_id', body_id)

  if (members?.length && auditLog) {
    await adminSupabase.from('user_alerts').insert(
      members.map((m: { user_id: string }) => ({
        user_id: m.user_id,
        audit_log_id: auditLog.id,
        booking_id,
        booking_type: 'One-Time Room',
        booking_date: firstSession.booking_date,
        start_time: firstSession.start_time,
      }))
    )
  }

  try {
    const emails = (members ?? [])
      .flatMap((m: { users: { email: string; is_active: boolean } | { email: string; is_active: boolean }[] | null }) =>
        Array.isArray(m.users) ? m.users.filter(u => u.is_active).map(u => u.email) : m.users?.is_active ? [m.users.email] : []
      )
      .filter(Boolean) as string[]
    await sendBookingUpdatedEmail({
      bodyName,
      roomOrTable: firstSession.room_name || 'N/A',
      date: firstSession.booking_date,
      startTime: firstSession.start_time,
      endTime: firstSession.end_time,
      status: firstSession.status,
      recipients: emails,
    })
  } catch (e) {
    console.error('Booking updated email failed:', e)
  }

  // Resolve any pending revision request for this booking
  await adminSupabase
    .from('revision_requests')
    .update({ status: 'Done' })
    .eq('booking_id', booking_id)
    .eq('status', 'Pending')

  if (firstSession.status === 'Missed') {
    try {
      const { data: leaders } = await adminSupabase
        .from('board_memberships')
        .select('users(full_name, is_active)')
        .eq('body_id', body_id)
        .eq('role', 'Leadership')

      const contacts = (leaders ?? [])
        .flatMap((l: { users: { full_name: string; is_active: boolean }[] }) => l.users.filter(u => u.is_active).map(u => u.full_name))
        .filter(Boolean) as string[]

      await sendMissedReservationEmail({
        bodyName,
        date: formatDateLong(firstSession.booking_date),
        startTime: firstSession.start_time,
        endTime: firstSession.end_time,
        contacts,
      })
    } catch (e) {
      console.error('Resend email failed:', e)
    }
  }

  return NextResponse.json({ success: true })
}
