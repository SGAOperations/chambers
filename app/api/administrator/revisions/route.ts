import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'

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
    .eq('status', 'Pending')
    .order('created_at', { ascending: false })

  return NextResponse.json({ revisions: revisions || [] })
}

/**
 * Denies a revision request.
 *
 * Until now the only way a revision request could leave the Administrator's list
 * was for an admin to edit the booking, which the three booking routes treat as
 * granting it ("Resolve any pending revision request" -> status 'Done'). A
 * request for something that cannot be done -- a room already taken, a time
 * outside CSC hours, a series that has since ended -- had no exit, and
 * lib/pending-actions.ts kept surfacing it as a danger row for as long as it
 * stayed Pending (issue #77).
 *
 * Denying is deliberately not a delete. The row stays, with its reason, so the
 * decision is auditable and the requester's notification has something behind
 * it. The pending action clears on its own: every query that builds one filters
 * on `status = 'Pending'`.
 */
export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id, denial_reason } = await request.json()
  if (!id) return NextResponse.json({ error: 'Missing revision request id' }, { status: 400 })

  // Read before writing, for two reasons: the requester has to be known in order
  // to notify them, and the Pending check below needs the current status.
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
  if (revision.status !== 'Pending') {
    return NextResponse.json(
      { error: `This revision request has already been resolved (${revision.status}).` },
      { status: 409 }
    )
  }

  const reason = typeof denial_reason === 'string' && denial_reason.trim()
    ? denial_reason.trim()
    : null

  const { error: updateError } = await adminSupabase
    .from('revision_requests')
    .update({ status: 'Denied', denial_reason: reason })
    .eq('id', id)
    // Re-checked in the write itself: the read above can go stale between the two
    // statements, and this makes the transition Pending -> Denied rather than
    // *-> Denied.
    .eq('status', 'Pending')

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  // The requester asked for this change and would otherwise never hear back.
  //
  // Linked by booking_id, not request_id: user_alerts.request_id is a foreign key
  // to room_requests, so a revision request's id does not belong in it. The
  // booking is the thing the requester recognises anyway.
  if (revision.requested_by) {
    const { error: alertError } = await adminSupabase.from('user_alerts').insert({
      user_id: revision.requested_by,
      booking_id: revision.booking_id,
      booking_type: 'Revision Denied',
      denial_reason: reason,
    })
    // Deliberately not fatal. The denial is already recorded, and failing the
    // request here would invite the admin to deny it again -- which the Pending
    // guard above would then refuse, leaving them stuck on a row that is in fact
    // resolved.
    if (alertError) console.error('Revision denial alert failed:', alertError)
  }

  return NextResponse.json({ success: true })
}
