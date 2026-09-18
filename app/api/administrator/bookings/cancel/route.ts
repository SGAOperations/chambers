import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { notifyCancelledReservations, type CancelledReservation } from '@/lib/room-invites'
import { waitUntil } from '@vercel/functions'
import { insertAuditRows } from '@/lib/audit'

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

  const { booking_id, scope, occurrence_id } = await request.json()

  /**
   * The sessions this cancel is about, read before the write so the body can be
   * told what was cancelled and their calendars can be corrected (issue #69).
   * Only one-time sessions: tabling has no calendar invites, and the weekly
   * editor cancels weeks through its own PATCH.
   */
  let cancelled: CancelledReservation[] = []
  const readOneTimeSessions = async () => {
    let query = adminSupabase
      .from('one_time_room_bookings')
      .select('id, booking_date, start_time, end_time, room_name, status')
      .eq('booking_id', booking_id)
    if (scope === 'occurrence' && occurrence_id) query = query.eq('id', occurrence_id)
    const { data } = await query
    return ((data ?? []) as { id: string; booking_date: string; start_time: string; end_time: string; room_name: string | null; status: string }[])
      // A session already cancelled needs no second notice.
      .filter(r => r.status !== 'Cancelled')
      .map(r => ({
        source: 'one_time' as const,
        id: r.id,
        bookingId: booking_id,
        resultingStatus: 'Cancelled' as const,
        date: r.booking_date,
        startTime: r.start_time,
        endTime: r.end_time,
        roomOrTable: r.room_name ?? '',
      }))
  }

  const { data: bookingRow } = await adminSupabase
    .from('bookings')
    .select('type')
    .eq('id', booking_id)
    .single()
  const bookingType = bookingRow?.type

  /**
   * The sessions this cancel will change, and the status each had, for the
   * Audit tab (issue #120). This button used to change statuses without
   * recording anything, so a cancelled session had no trail at all.
   */
  const readForAudit = async (): Promise<{ date: string; status: string | null }[]> => {
    if (bookingType === 'One-Time Room') {
      let q = adminSupabase.from('one_time_room_bookings').select('booking_date, status').eq('booking_id', booking_id)
      if (scope === 'occurrence' && occurrence_id) q = q.eq('id', occurrence_id)
      const { data } = await q
      return ((data ?? []) as { booking_date: string; status: string | null }[]).map(r => ({ date: r.booking_date, status: r.status }))
    }
    if (bookingType === 'Tabling') {
      let q = adminSupabase.from('tabling_sessions').select('session_date, status, tabling_bookings!inner(booking_id)').eq('tabling_bookings.booking_id', booking_id)
      if (scope === 'occurrence' && occurrence_id) q = q.eq('id', occurrence_id)
      const { data } = await q
      return ((data ?? []) as unknown as { session_date: string; status: string | null }[]).map(r => ({ date: r.session_date, status: r.status }))
    }
    return []
  }
  const beforeCancel = (await readForAudit()).filter(r => r.status !== 'Cancelled')

  if (scope === 'occurrence' && occurrence_id) {
    if (bookingType === 'One-Time Room') {
      cancelled = await readOneTimeSessions()
      const { error } = await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Cancelled' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (bookingType === 'Tabling') {
      const { error } = await adminSupabase
        .from('tabling_sessions')
        .update({ status: 'Cancelled' })
        .eq('id', occurrence_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
  } else {
    // series scope — cancel all sessions
    if (bookingType === 'One-Time Room') {
      cancelled = await readOneTimeSessions()
      const { error } = await adminSupabase
        .from('one_time_room_bookings')
        .update({ status: 'Cancelled' })
        .eq('booking_id', booking_id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    } else if (bookingType === 'Tabling') {
      const { data: tablingBooking } = await adminSupabase
        .from('tabling_bookings')
        .select('id')
        .eq('booking_id', booking_id)
        .single()

      if (tablingBooking) {
        const { error } = await adminSupabase
          .from('tabling_sessions')
          .update({ status: 'Cancelled' })
          .eq('tabling_booking_id', tablingBooking.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
    }
  }

  await insertAuditRows(adminSupabase, beforeCancel.map(r => ({
    booking_id,
    admin_id: user.id,
    new_status: 'Cancelled',
    target: 'session' as const,
    target_date: r.date,
    action: 'cancelled' as const,
    changes: [{ label: 'Status', from: r.status ?? '—', to: 'Cancelled' }],
  })))

  if (cancelled.length) {
    waitUntil(
      (async () => {
        try {
          await notifyCancelledReservations(cancelled)
        } catch (e) {
          console.error('Cancellation notice failed:', e)
        }
      })()
    )
  }

  return NextResponse.json({ success: true })
}
