import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { requireBookingManager } from '@/lib/booking-scope'
import { cancellationRequestTarget, insertAuditRows } from '@/lib/audit'

const adminSupabase = db

/**
 * The one status a set of rows all hold, or null where they disagree.
 *
 * A series-scoped request moves every session on the booking at once, and those
 * can legitimately start out differently -- one week Reserved, another already
 * Waitlisted. There is no honest single "from" for that, so the audit entry
 * records only where they landed rather than inventing a value that was true of
 * some of them. A blank is treated as no answer for the same reason.
 */
function sharedStatus(rows: { status: string | null }[] | null | undefined): string | null {
  const values = new Set((rows ?? []).map(r => r.status ?? ''))
  if (values.size !== 1) return null
  return [...values][0] || null
}

export async function POST(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, occurrence_id, scope, cancellation_type = 'Cancellation' } = await request.json()

  // Leadership of any body the booking is scoped to may request a cancellation -- for a divisional
  // or multi booking that is wider than the owning body.
  const guard = await requireBookingManager(supabase, adminSupabase, user, booking_id)
  if (guard.error) return guard.error

  const bookingType = guard.row.type

  // The date this request is about, resolved now while occurrence_id still
  // names a live row (issue #96).
  //
  // It will not always. The weekly PATCH handler used to delete and reinsert
  // every occurrence on each save, orphaning occurrence_id, and requests made
  // before issue #113 still point at those lost rows. Even now an occurrence's
  // id changes when its series moves to another day of the week. Storing the
  // date is what lets the request still be matched to its reservation -- without
  // it, marking the request Done finds nothing to do, and Auto-Cancel cannot
  // tell which request asked for what.
  let occurrenceDate: string | null = null

  // What the reservations this request covers say right now, read before they
  // are moved, so the audit entry below can say what the request changed rather
  // than only where it left things (issue #211). Null where there is no single
  // answer, which is not an error -- see sharedStatus().
  let previousStatus: string | null = null

  if (scope === 'occurrence' && occurrence_id) {
    if (bookingType === 'One-Time Room') {
      const { data } = await adminSupabase
        .from('one_time_room_bookings').select('booking_date, status').eq('id', occurrence_id).maybeSingle()
      occurrenceDate = data?.booking_date ?? null
      previousStatus = data?.status ?? null
    } else if (bookingType === 'Tabling') {
      const { data } = await adminSupabase
        .from('tabling_sessions').select('session_date, status').eq('id', occurrence_id).maybeSingle()
      occurrenceDate = data?.session_date ?? null
      previousStatus = data?.status ?? null
    } else {
      const { data } = await adminSupabase
        .from('weekly_room_occurrences').select('occurrence_date, status').eq('id', occurrence_id).maybeSingle()
      occurrenceDate = data?.occurrence_date ?? null
      // An occurrence's status is an override where null means "the series'",
      // and most carry null (lib/pending-cancellations.ts resolveOccurrence), so
      // reading the column alone would report no prior status on the common case.
      previousStatus = data?.status ?? null
      if (previousStatus === null) {
        const { data: series } = await adminSupabase
          .from('weekly_room_bookings').select('status').eq('booking_id', booking_id).maybeSingle()
        previousStatus = series?.status ?? null
      }
    }
  } else {
    // Series scope, read from whichever rows the updates below actually touch.
    if (bookingType === 'One-Time Room') {
      const { data } = await adminSupabase
        .from('one_time_room_bookings').select('status').eq('booking_id', booking_id)
      previousStatus = sharedStatus(data)
    } else if (bookingType === 'Weekly Room') {
      const { data } = await adminSupabase
        .from('weekly_room_bookings').select('status').eq('booking_id', booking_id).maybeSingle()
      previousStatus = data?.status ?? null
    } else if (bookingType === 'Tabling') {
      const { data: tb } = await adminSupabase
        .from('tabling_bookings').select('id').eq('booking_id', booking_id).maybeSingle()
      if (tb) {
        const { data } = await adminSupabase
          .from('tabling_sessions').select('status').eq('tabling_booking_id', tb.id)
        previousStatus = sharedStatus(data)
      }
    }
  }

  // Create cancellation request
  const { error: requestError } = await adminSupabase
    .from('cancellation_requests')
    .insert({
      booking_id,
      occurrence_id: occurrence_id || null,
      occurrence_date: occurrenceDate,
      requested_by: user.id,
      scope,
      status: 'Pending',
      cancellation_type,
    })

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Update booking/occurrence status to Pending Cancellation
  if (scope === 'occurrence' && occurrence_id) {
    if (bookingType === 'One-Time Room') {
      const { error } = await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (bookingType === 'Tabling') {
      const { error } = await adminSupabase
        .from('tabling_sessions')
        .update({ status: 'Pending Cancellation' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else {
      // Weekly Room — update the specific occurrence
      const { error } = await adminSupabase
        .from('weekly_room_occurrences')
        .update({ status: 'Pending Cancellation' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    // Series scope — update all sessions for the booking
    if (bookingType === 'One-Time Room') {
      await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('booking_id', booking_id)
    } else if (bookingType === 'Weekly Room') {
      await adminSupabase
        .from('weekly_room_bookings')
        .update({ status: 'Pending Cancellation' })
        .eq('booking_id', booking_id)
    } else if (bookingType === 'Tabling') {
      const { data: tablingBooking } = await adminSupabase
        .from('tabling_bookings')
        .select('id')
        .eq('booking_id', booking_id)
        .single()

      if (tablingBooking) {
        await adminSupabase
          .from('tabling_sessions')
          .update({ status: 'Pending Cancellation' })
          .eq('tabling_booking_id', tablingBooking.id)
      }
    }
  }

  // Filing a request *is* a change to the booking -- one week, one session or
  // the whole run is Pending Cancellation from here on -- and until issue #211
  // the Audit tab heard about it only at the far end, when an admin marked the
  // request Done ('cancelled') or closed it ('dismissed'). A booking sitting at
  // Pending Cancellation therefore had no entry saying who put it there or when,
  // which is the one status change on a booking that someone other than an admin
  // can make.
  //
  // Written after the statuses have actually moved, so the entry is never a
  // claim about a change that did not happen, and best effort like every other
  // audit write (lib/audit.ts): the request is already filed, and failing the
  // response over the log would only invite a second, duplicate request.
  await insertAuditRows(adminSupabase, [{
    booking_id,
    admin_id: user.id,
    new_status: 'Pending Cancellation',
    target: cancellationRequestTarget(bookingType, scope),
    target_date: scope === 'occurrence' ? occurrenceDate : null,
    action: 'requested',
    // Omitted where the rows disagreed, and where they were already pending --
    // a second request over an unresolved one moves nothing, and "Pending
    // Cancellation -> Pending Cancellation" would read as though it had.
    changes: previousStatus && previousStatus !== 'Pending Cancellation'
      ? [{ label: 'Status', from: previousStatus, to: 'Pending Cancellation' }]
      : null,
  }])

  return NextResponse.json({ success: true })
}
