import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { requireBookingManager } from '@/lib/booking-scope'
import { OPEN_REQUEST_STATUSES, OPS_REVIEW } from '@/lib/request-status'
import { queueBookingRequestAlert } from '@/lib/admin-slack-alerts'

const adminSupabase = db

/**
 * What the revision actually asks for, as one line of the admin Slack alert
 * (issue #219).
 *
 * change_type alone ('Time', 'Room' or 'Both') says which fields moved but not
 * where to, which is the part an admin needs before they can judge whether it is
 * worth chasing CSC for. A field left blank is omitted rather than printed
 * empty -- change_type is the only required one of the three.
 */
function revisionDetail(
  changeType: string,
  newStartTime: string | null,
  newEndTime: string | null,
  newRoom: string | null
): string {
  const parts: string[] = []
  if (newStartTime || newEndTime) {
    parts.push(`new time ${[newStartTime, newEndTime].filter(Boolean).join('–')}`)
  }
  if (newRoom) parts.push(`new room ${newRoom}`)
  return parts.length ? `Asks to change ${changeType}: ${parts.join(', ')}` : `Asks to change ${changeType}`
}

/**
 * The open revision request on a booking, if there is one, so the booking's
 * detail view can say where it stands (issue #128). Any leader who may request
 * a revision may see it -- only one can be open per booking, and the leader who
 * did not file it is the one most likely to try filing it again.
 */
export async function GET(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const bookingId = new URL(request.url).searchParams.get('booking_id')
  if (!bookingId) return NextResponse.json({ error: 'Missing booking_id' }, { status: 400 })

  const guard = await requireBookingManager(supabase, adminSupabase, user, bookingId)
  if (guard.error) return guard.error

  const { data, error } = await adminSupabase
    .from('revision_requests')
    .select('id, status, change_type, created_at')
    .eq('booking_id', bookingId)
    .in('status', OPEN_REQUEST_STATUSES)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ revision: data })
}

export async function POST(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, change_type, new_start_time, new_end_time, new_room, more_info } = await request.json()

  // Leadership of any body the booking is scoped to may request a revision -- for a divisional or
  // multi booking that is wider than the owning body.
  const guard = await requireBookingManager(supabase, adminSupabase, user, booking_id)
  if (guard.error) return guard.error

  // Block if an open revision request already exists for this booking
  const { data: existing } = await adminSupabase
    .from('revision_requests')
    .select('id')
    .eq('booking_id', booking_id)
    .in('status', OPEN_REQUEST_STATUSES)
    .maybeSingle()

  if (existing) {
    return NextResponse.json(
      { error: 'A revision request for this booking is already open.' },
      { status: 409 }
    )
  }

  const { error } = await adminSupabase
    .from('revision_requests')
    .insert({
      booking_id,
      requested_by: user.id,
      change_type,
      new_start_time: new_start_time || null,
      new_end_time: new_end_time || null,
      new_room: new_room || null,
      more_info,
      status: OPS_REVIEW,
    })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Operational Affairs and the Comptroller, over Slack (issue #219). Queued,
  // and it swallows its own failures: the request is filed, and a Slack outage
  // must not answer the leader with an error they would only retry.
  queueBookingRequestAlert(adminSupabase, {
    kind: 'revision',
    bookingId: booking_id,
    requestedBy: user.id,
    detail: revisionDetail(change_type, new_start_time, new_end_time, new_room),
  })

  return NextResponse.json({ success: true })
}
