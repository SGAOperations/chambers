import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendMissedReservationEmail, formatDateLong } from '@/lib/emails/missed-reservation'
import { sendBookingUpdatedEmail } from '@/lib/emails/booking-updated'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { waitUntil } from '@vercel/functions'
import {
  loadScopeContext,
  validateScopeSelection,
  resolveBookingRecipients,
  syncBookingBodies,
  type ScopedRow,
} from '@/lib/booking-scope'

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

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { body_id, purpose, sessions, semester_id, scope, division, body_ids } = await request.json()

  const { data: semester } = await adminSupabase
    .from('semesters')
    .select('id')
    .eq('id', semester_id)
    .single()

  if (!semester) {
    return NextResponse.json({ error: 'Invalid semester.' }, { status: 400 })
  }

  const ctx = await loadScopeContext(supabase, user)
  const selection = validateScopeSelection(ctx, { scope, body_id, division, body_ids })
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 400 })

  // admin_role is already a claim on the verified JWT, so this no longer needs
  // a round trip to the users table.
  const creatorRole = user.app_metadata?.admin_role ?? null

  // Create parent booking
  const { data: booking, error: bookingError } = await adminSupabase
    .from('bookings')
    .insert({
      body_id: selection.value.body_id,
      scope: selection.value.scope,
      division: selection.value.division,
      purpose,
      type: 'One-Time Room',
      created_by: user.id,
      creator_role: creatorRole,
      semester_id,
    })
    .select()
    .single()

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  const { error: bodiesError } = await syncBookingBodies(
    adminSupabase, booking.id, selection.value.scope, selection.value.body_ids
  )
  if (bodiesError) return NextResponse.json({ error: bodiesError }, { status: 500 })

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

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, body_id, purpose, sessions, scope, division, body_ids } = await request.json()

  const ctx = await loadScopeContext(supabase, user)
  const selection = validateScopeSelection(ctx, { scope, body_id, division, body_ids })
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 400 })

  const { error: bookingError } = await adminSupabase
    .from('bookings')
    .update({
      body_id: selection.value.body_id,
      scope: selection.value.scope,
      division: selection.value.division,
      purpose,
    })
    .eq('id', booking_id)

  if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })

  // Clears the join rows when the scope moved away from 'multi'.
  const { error: bodiesError } = await syncBookingBodies(
    adminSupabase, booking_id, selection.value.scope, selection.value.body_ids
  )
  if (bodiesError) return NextResponse.json({ error: bodiesError }, { status: 500 })

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
    .eq('id', selection.value.body_id)
    .single()
  const bodyName = bodyData?.name ?? 'Unknown'

  // The audience is the whole scope, not just the owning body -- see resolveBookingRecipients for
  // the divisional/multi fan-out policy.
  const scopedRow: ScopedRow = {
    id: booking_id,
    body_id: selection.value.body_id,
    scope: selection.value.scope,
    division: selection.value.division,
  }
  const recipients = await resolveBookingRecipients(adminSupabase, scopedRow)

  if (recipients.length && auditLog) {
    await adminSupabase.from('user_alerts').insert(
      recipients.map(r => ({
        user_id: r.userId,
        audit_log_id: auditLog.id,
        booking_id,
        booking_type: 'One-Time Room',
        booking_date: firstSession.booking_date,
        start_time: firstSession.start_time,
      }))
    )
  }

  // Notification only -- the booking is already written, so don't hold the
  // admin's response open for a Resend round trip.
  waitUntil(
    (async () => {
      try {
        const emails = recipients.map(r => r.email)
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
    })()
  )

  // Resolve any pending revision request for this booking
  await adminSupabase
    .from('revision_requests')
    .update({ status: 'Done' })
    .eq('booking_id', booking_id)
    .eq('status', 'Pending')

  if (firstSession.status === 'Missed') {
    waitUntil(
      (async () => {
        try {
          const leaders = await resolveBookingRecipients(adminSupabase, scopedRow, {
            leadershipOnly: true,
          })
          const contacts = leaders.map(l => l.fullName).filter(Boolean)

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
      })()
    )
  }

  return NextResponse.json({ success: true })
}
