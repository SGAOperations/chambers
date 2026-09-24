import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import {
  AWAITING_CSC,
  AWAITING_CSC_ALERT,
  OPEN_REQUEST_STATUSES,
  isOpenRequestStatus,
  type RoomRequestStatus,
} from '@/lib/request-status'

const ROOM_REQUEST_STATUSES: RoomRequestStatus[] = [...OPEN_REQUEST_STATUSES, 'Fulfilled', 'Denied']

const adminSupabase = db

export async function GET() {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: requests } = await supabase
    .from('room_requests')
    .select(`
      id, type, purpose, capacity, status, notes, created_at, body_id, scope, division,
      bodies(name),
      users(full_name),
      room_request_details(room_name, start_date, start_time, end_time, end_date),
      tabling_request_sessions(session_date, start_time, end_time, location, tables),
      room_request_bodies(body_id, bodies(name))
    `)
    .order('created_at', { ascending: false })

  return NextResponse.json({ requests: requests || [] })
}

export async function PATCH(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id, status, booking_id, notes, denial_reason, is_event } = await request.json()

  if (!id) return NextResponse.json({ error: 'Missing request id' }, { status: 400 })
  if (!ROOM_REQUEST_STATUSES.includes(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  const { data: current, error: readError } = await adminSupabase
    .from('room_requests')
    .select('status, requested_by')
    .eq('id', id)
    .single()

  if (readError || !current) return NextResponse.json({ error: 'Request not found' }, { status: 404 })

  // Admins move requests between statuses freely (issue #128), with one
  // exception: a fulfilled request has a booking linked to it, and reopening it
  // would leave that booking pointing at a request that says it is still open.
  if (current.status === 'Fulfilled') {
    return NextResponse.json({ error: 'This request has already been fulfilled.' }, { status: 409 })
  }
  if (current.status === status) {
    return NextResponse.json({ error: `This request is already ${status}.` }, { status: 409 })
  }

  // Only an open-status move leaves the notes alone; fulfilling and denying are
  // where notes are written.
  const update: Record<string, unknown> = { status }
  if (!isOpenRequestStatus(status)) update.notes = notes || null

  // Guarded on the status just read, so two admins acting on the same request
  // cannot both win -- the second is told to refresh instead.
  const { data: updated, error: requestError } = await adminSupabase
    .from('room_requests')
    .update(update)
    .eq('id', id)
    .eq('status', current.status)
    .select('id')

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })
  if (!updated?.length) {
    return NextResponse.json({ error: 'This request was changed by someone else. Refresh and try again.' }, { status: 409 })
  }

  // Tell the requester their request has gone to CSC. Not fatal: the status has
  // moved, and failing here would invite the admin to move it again.
  if (status === AWAITING_CSC && current.requested_by) {
    const { error: alertError } = await adminSupabase.from('user_alerts').insert({
      user_id: current.requested_by,
      request_id: id,
      booking_type: AWAITING_CSC_ALERT,
    })
    if (alertError) console.error('Awaiting CSC alert failed:', alertError)
  }

  // Link booking if fulfilling
  if (status === 'Fulfilled' && booking_id) {
    const bookingUpdate: Record<string, unknown> = { request_id: id }
    if (is_event) bookingUpdate.is_event = true

    const { error: bookingError } = await adminSupabase
      .from('bookings')
      .update(bookingUpdate)
      .eq('id', booking_id)

    if (bookingError) return NextResponse.json({ error: bookingError.message }, { status: 500 })
  }

  // Create denial notification for the requester
  if (status === 'Denied') {
    if (current.requested_by) {
      const { error: alertError } = await adminSupabase.from('user_alerts').insert({
        user_id: current.requested_by,
        request_id: id,
        booking_type: 'Denied',
        denial_reason: denial_reason ?? null,
      })
      if (alertError) return NextResponse.json({ error: alertError.message }, { status: 500 })
    }
  }

  return NextResponse.json({ success: true })
}