import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { sendCscCancellationRequest } from '@/lib/emails/csc-cancellation-request'
import { collectPending, parseFilters, describeScope } from '@/lib/pending-cancellations'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

/**
 * Where the cancellation request goes.
 *
 * Overridable so a staging deployment can point at an inbox that is not CSC's.
 * Nothing else in Chambers emails outside the university's student government,
 * so this is the one address worth being able to redirect.
 */
const CSC_EMAIL = process.env.CSC_EMAIL || 'cscreservations@northeastern.edu'

/**
 * Preview. Returns exactly what a POST would send, so the admin confirms against
 * the list that will actually go out rather than a description of it.
 */
export async function GET(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { type, from, to } = parseFilters(new URL(request.url))
  const { lines, skipped } = await collectPending(type, from, to)

  return NextResponse.json({
    lines,
    skipped,
    recipient: CSC_EMAIL,
    cc: process.env.OPS_EMAIL || null,
    scopeNote: describeScope(type, from, to),
  })
}

/**
 * Sends the request to CSC and marks what was sent as Cancelled.
 *
 * Order matters: the email goes first, and the statuses move only once it has
 * actually been accepted. Marking first and failing to send would leave a
 * booking cancelled in Chambers that CSC still holds a room for -- the one
 * outcome worth designing against, since nobody would be looking for it.
 *
 * A reservation with no code on file is never cancelled here. CSC identifies a
 * booking by its code, so there is nothing to ask them to release, and
 * cancelling it in Chambers on the strength of a request they could not act on
 * would put the two systems out of step. Those are set aside for an admin to
 * chase by hand -- see collectPending.
 *
 * The list is recomputed here rather than taken from the request body. A client
 * could otherwise post any set of dates and codes it liked to an external
 * address, and the preview could in any case be minutes stale.
 */
export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json().catch(() => ({}))
  const url = new URL(request.url)
  for (const k of ['type', 'from', 'to']) {
    if (typeof body?.[k] === 'string') url.searchParams.set(k, body[k])
  }
  const { type, from, to } = parseFilters(url)

  const { lines } = await collectPending(type, from, to)
  if (!lines.length) {
    return NextResponse.json(
      { error: 'Nothing with a reservation code is marked Pending Cancellation for those filters.' },
      { status: 400 }
    )
  }

  // The admin confirmed a specific number of reservations. If the set has moved
  // since -- someone edited a booking in another tab -- stop rather than mail CSC
  // a list nobody approved.
  if (typeof body?.expectedCount === 'number' && body.expectedCount !== lines.length) {
    return NextResponse.json(
      {
        error: `The list changed while you were reviewing it: ${body.expectedCount} reservation${body.expectedCount === 1 ? '' : 's'} became ${lines.length}. Reload the preview and check it before sending.`,
      },
      { status: 409 }
    )
  }

  const { data: profile } = await adminSupabase
    .from('users').select('full_name').eq('id', user.id).single()

  try {
    await sendCscCancellationRequest({
      lines,
      requestedBy: profile?.full_name || user.email || 'Chambers administrator',
      scopeNote: describeScope(type, from, to),
      to: CSC_EMAIL,
      cc: process.env.OPS_EMAIL || undefined,
      replyTo: process.env.OPS_EMAIL || undefined,
    })
  } catch (e) {
    // Awaited, not fire-and-forget like the member-facing emails: this one is the
    // entire point of the request, and an admin who is told it sent needs that to
    // be true. Nothing has been marked at this point.
    console.error('CSC cancellation request failed:', e)
    return NextResponse.json({ error: 'The email could not be sent. No bookings were changed.' }, { status: 502 })
  }

  // Grouped by table so this is three statements rather than one per
  // reservation. An occurrence whose status was inherited gets 'Cancelled'
  // written onto the occurrence itself, which is correct: only the dates that
  // were actually sent stop being pending, and the rest of the series is
  // untouched.
  const byTable: Record<string, string[]> = { one_time: [], occurrence: [], tabling_session: [] }
  for (const l of lines) byTable[l.source].push(l.id)

  const targets: [string, string[]][] = [
    ['one_time_room_bookings', byTable.one_time],
    ['weekly_room_occurrences', byTable.occurrence],
    ['tabling_sessions', byTable.tabling_session],
  ]

  const failures: string[] = []
  for (const [table, ids] of targets) {
    if (!ids.length) continue
    const { error } = await adminSupabase.from(table).update({ status: 'Cancelled' }).in('id', ids)
    if (error) {
      console.error(`Auto-Cancel could not mark ${table}:`, error)
      failures.push(table)
    }
  }

  // One entry per booking touched, so the change shows up in the Audit tab
  // beside every other status change rather than appearing to have happened by
  // itself. Best effort: the email is out and the statuses are moved, and
  // failing the request over a missing log would invite a resend.
  const bookingIds = [...new Set(lines.map(l => l.bookingId).filter(Boolean))]
  if (bookingIds.length) {
    const { error } = await adminSupabase.from('audit_logs').insert(
      bookingIds.map(id => ({ booking_id: id, admin_id: user.id, new_status: 'Cancelled' }))
    )
    if (error) console.error('Auto-Cancel audit log failed:', error)
  }

  return NextResponse.json({
    success: true,
    sent: lines.length,
    recipient: CSC_EMAIL,
    // The mail is already gone, so a failure here is reported rather than thrown:
    // the admin needs to know the request went but the statuses did not move.
    ...(failures.length ? { statusUpdateFailed: failures } : {}),
  })
}
