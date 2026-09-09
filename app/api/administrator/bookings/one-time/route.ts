import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendMissedReservationEmail, formatDateLong } from '@/lib/emails/missed-reservation'
import { sendBookingUpdatedEmail } from '@/lib/emails/booking-updated'
import { sendBookingCreatedEmail } from '@/lib/emails/booking-created'
import { changed, collectChanges, formatDate, formatTime } from '@/lib/emails/changes'
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

  // Chambers emailed on update and on a missed reservation but never on
  // creation, so the first email a body received about a booking was one saying
  // it had changed (issue #79). waitUntil for the same reason as the update
  // email: the rows are already written.
  waitUntil(
    (async () => {
      try {
        const scopedRow: ScopedRow = {
          id: booking.id,
          body_id: selection.value.body_id,
          scope: selection.value.scope,
          division: selection.value.division,
        }
        const recipients = await resolveBookingRecipients(adminSupabase, scopedRow)
        if (!recipients.length) return

        const { data: bodyData } = await adminSupabase
          .from('bodies').select('name').eq('id', selection.value.body_id).single()

        await sendBookingCreatedEmail({
          bodyName: bodyData?.name ?? 'Unknown',
          bookingType: 'One-Time Room',
          purpose,
          roomOrTable: sessionRows[0]?.room_name || 'N/A',
          status: sessionRows[0]?.status ?? 'Reserved',
          sessions: sessionRows.map((r: { booking_date: string; start_time: string; end_time: string; room_name: string | null }) => ({
            date: r.booking_date,
            startTime: r.start_time,
            endTime: r.end_time,
            roomOrTable: r.room_name,
          })),
          recipients: recipients.map(r => r.email),
        })
      } catch (e) {
        console.error('Booking created email failed:', e)
      }
    })()
  )

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

  // Read before writing so the email can say what moved (issue #79). The session
  // rows are deleted and reinserted below, so the previous values have to be
  // taken now or not at all.
  const [{ data: prevBooking }, { data: prevSessions }] = await Promise.all([
    adminSupabase.from('bookings').select('purpose').eq('id', booking_id).single(),
    adminSupabase
      .from('one_time_room_bookings')
      .select('room_name, booking_date, start_time, end_time, status, reservation_code')
      .eq('booking_id', booking_id)
      .order('booking_date', { ascending: true }),
  ])

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
        // Sessions are replaced wholesale rather than edited in place, so they
        // are compared position by position against the previous list, sorted
        // the same way. A change in how many there are is reported on its own
        // line, since pairing them up past that point would invent moves.
        const prevFirst = (prevSessions ?? [])[0]
        const sessionCountChange = changed(
          'Sessions',
          `${(prevSessions ?? []).length}`,
          `${sessionRows.length}`
        )

        const changes = collectChanges(
          changed('Purpose', prevBooking?.purpose, purpose),
          sessionCountChange,
          changed('Room', prevFirst?.room_name, firstSession.room_name),
          changed('Date', prevFirst?.booking_date, firstSession.booking_date, formatDate),
          changed('Start time', prevFirst?.start_time, firstSession.start_time, formatTime),
          changed('End time', prevFirst?.end_time, firstSession.end_time, formatTime),
          changed('Status', prevFirst?.status, firstSession.status),
          changed('Reservation code', prevFirst?.reservation_code, firstSession.reservation_code),
        )

        await sendBookingUpdatedEmail({
          bodyName,
          purpose,
          roomOrTable: firstSession.room_name || 'N/A',
          date: firstSession.booking_date,
          startTime: firstSession.start_time,
          endTime: firstSession.end_time,
          status: firstSession.status,
          changes,
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
