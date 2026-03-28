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

  const { body_id, purpose, sessions } = await request.json()

  // Require an active semester
  const { data: activeSemester } = await adminSupabase
    .from('semesters')
    .select('id')
    .eq('is_active', true)
    .single()

  if (!activeSemester) {
    return NextResponse.json({ error: 'No active semester. Please activate a semester before creating bookings.' }, { status: 400 })
  }

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({ body_id, purpose, type: 'One-Time Room', created_by: user.id, semester_id: activeSemester.id })
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

  const { data: parentBooking } = await adminSupabase
    .from('bookings')
    .select('body_id, bodies(name)')
    .eq('id', booking_id)
    .single()

  const { data: members } = await adminSupabase
    .from('board_memberships')
    .select('user_id, users(email)')
    .eq('body_id', parentBooking?.body_id)

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
    const bodies = parentBooking?.bodies as { name: string }[] | undefined
    const bodyName = bodies?.[0]?.name ?? 'Unknown'
    const emails = (members ?? [])
      .flatMap((m: { users: { email: string } | { email: string }[] | null }) =>
        Array.isArray(m.users) ? m.users.map(u => u.email) : m.users ? [m.users.email] : []
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
        .select('users(full_name)')
        .eq('body_id', parentBooking?.body_id)
        .eq('role', 'Leadership')

      const contacts = (leaders ?? [])
        .flatMap((l: { users: { full_name: string }[] }) => l.users.map(u => u.full_name))
        .filter(Boolean) as string[]

      const bodies = parentBooking?.bodies as { name: string }[] | undefined
      const bodyName = bodies?.[0]?.name ?? 'Unknown'

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
