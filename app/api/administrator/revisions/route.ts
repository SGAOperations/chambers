import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import {
  OPEN_REQUEST_STATUSES,
  OPS_REVIEW,
  REVISION_AWAITING_CSC_ALERT,
  isOpenRequestStatus,
} from '@/lib/request-status'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: revisions } = await supabase
    .from('revision_requests')
    .select(`
      id, change_type, new_start_time, new_end_time, new_room, more_info, status, created_at,
      bookings(id, type, purpose, bodies(name)),
      users(full_name)
    `)
    .in('status', OPEN_REQUEST_STATUSES)
    .order('created_at', { ascending: false })

  return NextResponse.json({ revisions: revisions || [] })
}

/**
 * Moves an open revision request to another status: between Ops Review and
 * Awaiting CSC (issue #128), or to Denied.
 *
 * Granting is not here. It happens by editing the booking, which the three
 * booking routes treat as granting the request ("Resolve any pending revision
 * request" -> status 'Done').
 *
 * Denying was added for a request that cannot be made -- a room already taken, a
 * time outside CSC hours, a series that has since ended -- which otherwise had
 * no exit and stayed a danger pending action forever (issue #77). It is
 * deliberately not a delete. The row stays, with its reason, so the decision is
 * auditable and the requester's notification has something behind it.
 *
 * `status` defaults to 'Denied', which is all this route used to do.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id, denial_reason, status = 'Denied' } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing revision request id' }, { status: 400 })
  if (status !== 'Denied' && !isOpenRequestStatus(status)) {
    return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
  }

  // Read before writing, for two reasons: the requester has to be known in order
  // to notify them, and the open check below needs the current status.
  const { data: revision, error: readError } = await adminSupabase
    .from('revision_requests')
    .select('id, status, booking_id, requested_by')
    .eq('id', id)
    .single()

  if (readError || !revision) {
    return NextResponse.json({ error: 'Revision request not found' }, { status: 404 })
  }

  // Two admins on the Requests tab at once, or one who left it open while the
  // booking was edited elsewhere. Denying something already granted would
  // silently overwrite that, and tell the requester their revision was refused
  // when it had in fact been made.
  if (!isOpenRequestStatus(revision.status)) {
    return NextResponse.json(
      { error: `This revision request has already been resolved (${revision.status}).` },
      { status: 409 }
    )
  }
  if (revision.status === status) {
    return NextResponse.json({ error: `This revision request is already ${status}.` }, { status: 409 })
  }

  const reason = status === 'Denied' && typeof denial_reason === 'string' && denial_reason.trim()
    ? denial_reason.trim()
    : null

  const { data: updated, error: updateError } = await adminSupabase
    .from('revision_requests')
    .update(status === 'Denied' ? { status, denial_reason: reason } : { status })
    .eq('id', id)
    // Re-checked in the write itself: the read above can go stale between the two
    // statements, and this makes the transition from the status just read rather
    // than from whatever the row holds by now.
    .eq('status', revision.status)
    .select('id')

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })
  if (!updated?.length) {
    return NextResponse.json(
      { error: 'This revision request was changed by someone else. Refresh and try again.' },
      { status: 409 }
    )
  }

  // The requester asked for this change and would otherwise never hear back.
  //
  // Linked by booking_id, not request_id: user_alerts.request_id is a foreign key
  // to room_requests, so a revision request's id does not belong in it. The
  // booking is the thing the requester recognises anyway.
  if (revision.requested_by && status !== OPS_REVIEW) {
    const { error: alertError } = await adminSupabase.from('user_alerts').insert({
      user_id: revision.requested_by,
      booking_id: revision.booking_id,
      booking_type: status === 'Denied' ? 'Revision Denied' : REVISION_AWAITING_CSC_ALERT,
      denial_reason: reason,
    })
    // Deliberately not fatal. The status is already recorded, and failing the
    // request here would invite the admin to change it again -- which the guard
    // above would then refuse, leaving them stuck on a row that has in fact moved.
    if (alertError) console.error('Revision status alert failed:', alertError)
  }

  return NextResponse.json({ success: true })
}
