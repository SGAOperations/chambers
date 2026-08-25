import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendMissedReservationEmail, formatDateLong } from '@/lib/emails/missed-reservation'
import { sendBookingUpdatedEmail } from '@/lib/emails/booking-updated'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { waitUntil } from '@vercel/functions'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { body_id, purpose, reservation_code, sessions, semester_id } = await request.json()

  const { data: semester } = await adminSupabase
    .from('semesters')
    .select('id')
    .eq('id', semester_id)
    .single()

  if (!semester) {
    return NextResponse.json({ error: 'Invalid semester.' }, { status: 400 })
  }

  // admin_role is already a claim on the verified JWT, so this no longer needs
  // a round trip to the users table.
  const creatorRole = user.app_metadata?.admin_role ?? null

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({ body_id, purpose, type: 'Tabling', created_by: user.id, creator_role: creatorRole, semester_id })
    .select()
    .single()

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Create tabling booking
  const { data: tabling, error: tablingError } = await adminSupabase
    .from('tabling_bookings')
    .insert({ booking_id: booking.id, reservation_code: reservation_code || null })
    .select()
    .single()

  if (tablingError) return NextResponse.json({ error: tablingError.message }, { status: 500 })

  // Create sessions
  const sessionRows = sessions.map((s: {
    location: string
    session_date: string
    start_time: string
    end_time: string
    reservation_code: string
    status: string
  }) => ({
    tabling_booking_id: tabling.id,
    location: s.location,
    session_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    reservation_code: s.reservation_code || null,
    status: s.status,
  }))

  const { error: sessionError } = await adminSupabase
    .from('tabling_sessions')
    .insert(sessionRows)

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

interface Session {
  location: string
  session_date: string
  start_time: string
  end_time: string
  status: string
  reservation_code: string | null
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, tabling_id, body_id, purpose, reservation_code, sessions } = await request.json()

  // Update parent booking
  const { error: bookingError } = await adminSupabase
    .from('bookings')
    .update({ body_id, purpose })
    .eq('id', booking_id)

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Update tabling booking
  const { error: tablingError } = await adminSupabase
    .from('tabling_bookings')
    .update({ reservation_code: reservation_code || null })
    .eq('id', tabling_id)

  if (tablingError) return NextResponse.json({ error: tablingError.message }, { status: 500 })

  // Delete all existing sessions and reinsert
  await adminSupabase
    .from('tabling_sessions')
    .delete()
    .eq('tabling_booking_id', tabling_id)

  const sessionRows = sessions.map((s: Session) => ({
    tabling_booking_id: tabling_id,
    location: s.location,
    session_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    status: s.status,
    reservation_code: s.reservation_code || null,
  }))

  const { error: sessionError } = await adminSupabase
    .from('tabling_sessions')
    .insert(sessionRows)

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })

  const statusSummary = [...new Set(sessions.map((s: Session) => s.status))].join(', ')
  const { data: auditLog } = await adminSupabase
    .from('audit_logs')
    .insert({ booking_id, admin_id: user.id, new_status: statusSummary })
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
        booking_type: 'Tabling',
        booking_date: sessions[0]?.session_date ?? null,
        start_time: sessions[0]?.start_time ?? null,
      }))
    )
  }

  // Notification only -- the booking is already written, so don't hold the
  // admin's response open for a Resend round trip.
  waitUntil(
    (async () => {
      try {
        const emails = (members ?? [])
          .flatMap((m: { users: { email: string; is_active: boolean } | { email: string; is_active: boolean }[] | null }) =>
            Array.isArray(m.users) ? m.users.filter(u => u.is_active).map(u => u.email) : m.users?.is_active ? [m.users.email] : []
          )
          .filter(Boolean) as string[]
        await sendBookingUpdatedEmail({
          bodyName,
          roomOrTable: sessions[0]?.location || 'N/A',
          date: sessions[0]?.session_date ?? '',
          startTime: sessions[0]?.start_time ?? '',
          endTime: sessions[0]?.end_time ?? '',
          status: statusSummary,
          recipients: emails,
        })
      } catch (e) {
        console.error('Booking updated email failed:', e)
      }
    })()
  )

  // Resolve any pending revision request for this booking
  await adminSupabase
    .from('revision_requests')
    .update({ status: 'Done' })
    .eq('booking_id', booking_id)
    .eq('status', 'Pending')

  if (sessions.some((s: Session) => s.status === 'Missed')) {
    waitUntil(
      (async () => {
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
            date: formatDateLong(sessions[0].session_date),
            startTime: sessions[0].start_time,
            endTime: sessions[0].end_time,
            contacts,
          })
        } catch (e) {
          console.error('Resend email failed:', e)
        }
      })()
    )
  }

  return NextResponse.json({ success: true })
}