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

function getWeeklyDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  const current = new Date(startDate + 'T00:00:00')
  const end = new Date(endDate + 'T00:00:00')

  while (current <= end) {
    dates.push(current.toISOString().split('T')[0])
    current.setDate(current.getDate() + 7)
  }

  return dates
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { body_id, purpose, room_name, start_date, end_date, start_time, end_time, reservation_code, status } = await request.json()

  // Require an active semester
  const { data: activeSemester } = await adminSupabase
    .from('semesters')
    .select('id')
    .eq('is_active', true)
    .single()

  if (!activeSemester) {
    return NextResponse.json({ error: 'No active semester. Please activate a semester before creating bookings.' }, { status: 400 })
  }

  const { data: userData } = await adminSupabase
    .from('users')
    .select('admin_role')
    .eq('id', user.id)
    .single()

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({ body_id, purpose, type: 'Weekly Room', created_by: user.id, creator_role: userData?.admin_role ?? null, semester_id: activeSemester.id })
    .select()
    .single()

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Create weekly room booking
  const { data: weekly, error: weeklyError } = await adminSupabase
    .from('weekly_room_bookings')
    .insert({ booking_id: booking.id, room_name, start_date, end_date, start_time, end_time, reservation_code: reservation_code || null, status })
    .select()
    .single()

  if (weeklyError) return NextResponse.json({ error: weeklyError.message }, { status: 500 })

  // Generate occurrences
  const dates = getWeeklyDates(start_date, end_date)
  const occurrences = dates.map(date => ({
    weekly_booking_id: weekly.id,
    occurrence_date: date,
  }))

  const { error: occurrenceError } = await adminSupabase
    .from('weekly_room_occurrences')
    .insert(occurrences)

  if (occurrenceError) return NextResponse.json({ error: occurrenceError.message }, { status: 500 })

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

  const { booking_id, weekly_id, body_id, purpose, room_name, start_date, end_date, start_time, end_time, reservation_code, status, occurrences } = await request.json()

  // Update parent booking
  const { error: bookingError } = await adminSupabase
    .from('bookings')
    .update({ body_id, purpose })
    .eq('id', booking_id)

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Update weekly booking base fields
  const { error: weeklyError } = await adminSupabase
    .from('weekly_room_bookings')
    .update({ room_name, start_date, end_date, start_time, end_time, reservation_code: reservation_code || null, status })
    .eq('id', weekly_id)

  if (weeklyError) return NextResponse.json({ error: weeklyError.message }, { status: 500 })

  // Regenerate occurrences — delete all and reinsert
  await adminSupabase
    .from('weekly_room_occurrences')
    .delete()
    .eq('weekly_booking_id', weekly_id)

  const dates = getWeeklyDates(start_date, end_date)
  const newOccurrences = dates.map(date => {
    const existing = occurrences.find((o: { occurrence_date: string; room_name: string | null; start_time: string | null; end_time: string | null; status: string | null; reservation_code: string | null; senate_type: string | null }) => o.occurrence_date === date)
    return {
      weekly_booking_id: weekly_id,
      occurrence_date: date,
      room_name: existing?.room_name || null,
      start_time: existing?.start_time || null,
      end_time: existing?.end_time || null,
      status: existing?.status || null,
      reservation_code: existing?.reservation_code || null,
      senate_type: existing?.senate_type ?? null,
    }
  })

  const { error: occError } = await adminSupabase
    .from('weekly_room_occurrences')
    .insert(newOccurrences)

  if (occError) return NextResponse.json({ error: occError.message }, { status: 500 })

  const { data: auditLog } = await adminSupabase
    .from('audit_logs')
    .insert({ booking_id, admin_id: user.id, new_status: status })
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
        booking_type: 'Weekly Room',
        booking_date: start_date,
        start_time: start_time,
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
      roomOrTable: room_name || 'N/A',
      date: start_date,
      startTime: start_time,
      endTime: end_time,
      status,
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

  const isMissed = status === 'Missed' || occurrences.some((o: { status: string | null }) => o.status === 'Missed')
  if (isMissed) {
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
        date: formatDateLong(start_date),
        startTime: start_time,
        endTime: end_time,
        contacts,
      })
    } catch (e) {
      console.error('Resend email failed:', e)
    }
  }

  return NextResponse.json({ success: true })
}