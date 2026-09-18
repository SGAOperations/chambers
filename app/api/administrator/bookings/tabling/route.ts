import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { sendMissedReservationEmail } from '@/lib/emails/missed-reservation'
import { sendBookingUpdatedEmail } from '@/lib/emails/booking-updated'
import { sendBookingCreatedEmail } from '@/lib/emails/booking-created'
import { meetingTimeForStorage, resolveMeetingTime } from '@/lib/meeting-time'
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
import { OPEN_REQUEST_STATUSES } from '@/lib/request-status'

import { diffFields, insertAuditRows, pairByDate, type AuditField, type AuditRow } from '@/lib/audit'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { body_id, purpose, reservation_code, sessions, semester_id, scope, division, body_ids } = await request.json()

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
      type: 'Tabling',
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
    meeting_time: string | null
    reservation_code: string
    status: string
  }) => ({
    tabling_booking_id: tabling.id,
    location: s.location,
    session_date: s.session_date,
    start_time: s.start_time,
    end_time: s.end_time,
    meeting_time: meetingTimeForStorage(s.meeting_time, s.start_time),
    reservation_code: s.reservation_code || null,
    status: s.status,
  }))

  const { error: sessionError } = await adminSupabase
    .from('tabling_sessions')
    .insert(sessionRows)

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })

  // Opens the booking's history in the Audit tab (issue #120). Creating one was
  // never logged, so a booking's trail used to start at its first edit.
  await insertAuditRows(adminSupabase, [{
    booking_id: booking.id, admin_id: user.id, new_status: sessionRows[0]?.status ?? 'Reserved',
    target: 'booking', target_date: null, action: 'created', changes: null,
  }])

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
          bookingType: 'Tabling',
          purpose,
          roomOrTable: sessionRows[0]?.location || 'N/A',
          status: sessionRows[0]?.status ?? 'Reserved',
          sessions: sessionRows.map((r: { session_date: string; start_time: string; end_time: string; meeting_time: string | null; location: string }) => ({
            date: r.session_date,
            startTime: r.start_time,
            endTime: r.end_time,
            meetingTime: resolveMeetingTime(r.meeting_time, r.start_time),
            roomOrTable: r.location,
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

interface Session {
  location: string
  session_date: string
  start_time: string
  end_time: string
  /** Blank means the session meets when its reservation starts (issue #126). */
  meeting_time: string | null
  status: string
  reservation_code: string | null
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, tabling_id, body_id, purpose, reservation_code, sessions, scope, division, body_ids } = await request.json()

  const ctx = await loadScopeContext(supabase, user)
  const selection = validateScopeSelection(ctx, { scope, body_id, division, body_ids })
  if (!selection.ok) return NextResponse.json({ error: selection.error }, { status: 400 })

  // Read before writing so the email can say what moved (issue #79).
  const [{ data: prevBooking }, { data: prevTabling }, { data: prevSessions }] = await Promise.all([
    adminSupabase.from('bookings').select('purpose').eq('id', booking_id).single(),
    adminSupabase.from('tabling_bookings').select('reservation_code').eq('id', tabling_id).single(),
    adminSupabase
      .from('tabling_sessions')
      .select('location, session_date, start_time, end_time, meeting_time, status, reservation_code')
      .eq('tabling_booking_id', tabling_id)
      .order('session_date', { ascending: true }),
  ])

  // Update parent booking
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
    meeting_time: meetingTimeForStorage(s.meeting_time, s.start_time),
    status: s.status,
    reservation_code: s.reservation_code || null,
  }))

  const { error: sessionError } = await adminSupabase
    .from('tabling_sessions')
    .insert(sessionRows)

  if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })

  const statusSummary = [...new Set(sessions.map((s: Session) => s.status))].join(', ')

  // Audit entries (issue #120): one per session this save changed, added or
  // removed, plus one for the booking if its purpose or shared reservation code
  // moved. Tabling still replaces every session on save, so ids cannot match
  // them up; pairByDate does it by day instead.
  type TablingValues = {
    location: string; date: string; start: string; end: string; meeting: string; status: string; code: string | null
  }
  const tablingValues = (r: { location: string; session_date: string; start_time: string; end_time: string; meeting_time: string | null; status: string; reservation_code: string | null }): TablingValues => ({
    location: r.location,
    date: r.session_date,
    start: r.start_time,
    end: r.end_time,
    // Resolved, so a blank meeting time reads as the start time it means (#126).
    meeting: resolveMeetingTime(r.meeting_time, r.start_time),
    status: r.status,
    code: r.reservation_code || null,
  })
  const TABLING_FIELDS: AuditField<TablingValues>[] = [
    { label: 'Table', get: v => v.location },
    { label: 'Start time', get: v => v.start, format: formatTime },
    { label: 'End time', get: v => v.end, format: formatTime },
    { label: 'Meeting time', get: v => v.meeting, format: formatTime },
    { label: 'Status', get: v => v.status },
    { label: 'Reservation code', get: v => v.code },
  ]

  const auditRows: AuditRow[] = []
  const bookingChanges = collectChanges(
    changed('Purpose', prevBooking?.purpose, purpose),
    changed('Reservation code', prevTabling?.reservation_code, reservation_code || null),
  )
  if (bookingChanges.length) {
    auditRows.push({
      booking_id, admin_id: user.id, new_status: statusSummary,
      target: 'booking', target_date: null, action: 'updated', changes: bookingChanges,
    })
  }

  const pairs = pairByDate(
    ((prevSessions ?? []) as Parameters<typeof tablingValues>[0][]).map(tablingValues),
    (sessionRows as Parameters<typeof tablingValues>[0][]).map(tablingValues),
    v => v.date,
    v => v.start,
  )
  for (const { date, prev, next } of pairs) {
    if (prev && next) {
      const changes = diffFields(prev, next, TABLING_FIELDS)
      if (changes.length) {
        auditRows.push({
          booking_id, admin_id: user.id, new_status: next.status,
          target: 'session', target_date: date, action: 'updated', changes,
        })
      }
    } else {
      const row = (next ?? prev)!
      auditRows.push({
        booking_id, admin_id: user.id, new_status: row.status,
        target: 'session', target_date: date, action: next ? 'added' : 'removed', changes: null,
      })
    }
  }

  if (!auditRows.length) {
    auditRows.push({
      booking_id, admin_id: user.id, new_status: statusSummary,
      target: 'booking', target_date: null, action: 'updated', changes: [],
    })
  }
  const auditLogId = await insertAuditRows(adminSupabase, auditRows)

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

  if (recipients.length && auditLogId) {
    await adminSupabase.from('user_alerts').insert(
      recipients.map(r => ({
        user_id: r.userId,
        audit_log_id: auditLogId,
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
        const emails = recipients.map(r => r.email)
        const prevFirst = (prevSessions ?? [])[0]
        const changes = collectChanges(
          changed('Purpose', prevBooking?.purpose, purpose),
          changed('Reservation code', prevTabling?.reservation_code, reservation_code || null),
          changed('Sessions', `${(prevSessions ?? []).length}`, `${sessions.length}`),
          changed('Table', prevFirst?.location, sessions[0]?.location),
          changed('Date', prevFirst?.session_date, sessions[0]?.session_date, formatDate),
          changed('Start time', prevFirst?.start_time, sessions[0]?.start_time, formatTime),
          changed('End time', prevFirst?.end_time, sessions[0]?.end_time, formatTime),
          // Effective values on both sides, so a session that has never set a
          // meeting time does not report one when its start time moves (#126).
          changed(
            'Meeting time',
            resolveMeetingTime(prevFirst?.meeting_time, prevFirst?.start_time),
            resolveMeetingTime(sessions[0]?.meeting_time, sessions[0]?.start_time),
            formatTime
          ),
        )

        await sendBookingUpdatedEmail({
          bodyName,
          purpose,
          roomOrTable: sessions[0]?.location || 'N/A',
          date: sessions[0]?.session_date ?? '',
          startTime: sessions[0]?.start_time ?? '',
          endTime: sessions[0]?.end_time ?? '',
          meetingTime: resolveMeetingTime(sessions[0]?.meeting_time, sessions[0]?.start_time ?? ''),
          status: statusSummary,
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
    .in('status', OPEN_REQUEST_STATUSES)

  if (sessions.some((s: Session) => s.status === 'Missed')) {
    waitUntil(
      (async () => {
        try {
          const leaders = await resolveBookingRecipients(adminSupabase, scopedRow, {
            leadershipOnly: true,
          })
          const contacts = leaders.map(l => l.fullName).filter(Boolean)

          await sendMissedReservationEmail({
            bodyName,
            date: sessions[0].session_date,
            roomOrTable: sessions[0].location,
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