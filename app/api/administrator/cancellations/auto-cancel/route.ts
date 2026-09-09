import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { sendCscCancellationRequest } from '@/lib/emails/csc-cancellation-request'
import { collectPending, lineKey } from '@/lib/pending-cancellations'

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
 * Everything currently marked for cancellation, for the admin to choose from.
 *
 * Returns the whole set rather than a filtered slice. Auto-Cancel used to take a
 * booking type and a date range and act on whatever matched, which made the
 * filter -- something you set to look around with -- decide what got cancelled.
 * The admin now picks rows explicitly, and this is the list they pick from.
 */
export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { lines, skipped } = await collectPending()

  return NextResponse.json({
    lines: lines.map(l => ({ ...l, key: lineKey(l) })),
    skipped,
    recipient: CSC_EMAIL,
    cc: process.env.OPS_EMAIL || null,
  })
}

/**
 * Sends the request to CSC for the reservations the admin selected, and marks
 * those as Cancelled.
 *
 * The selection is a choice among what the server finds, never the source of
 * truth. Every submitted key is matched back against a freshly collected set: a
 * client cannot introduce a date, a code or a booking that is not currently
 * pending with a code on file, and the list that goes to CSC is built from the
 * server's own rows rather than from anything posted.
 *
 * Order matters. The email goes first, and the statuses move only once it has
 * actually been accepted. Marking first and failing to send would leave a
 * booking cancelled in Chambers that CSC still holds a room for -- the one
 * outcome worth designing against, since nobody would be looking for it.
 *
 * A reservation with no code on file can never be selected: CSC identifies a
 * booking by its code, so there is nothing to ask them to release, and
 * cancelling it here on the strength of a request they could not act on would
 * put the two systems out of step. Those are surfaced separately for an admin to
 * chase by hand -- see collectPending.
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
  const requested: string[] = Array.isArray(body?.keys)
    ? body.keys.filter((k: unknown): k is string => typeof k === 'string')
    : []

  if (!requested.length) {
    return NextResponse.json(
      { error: 'Select at least one reservation to cancel.' },
      { status: 400 }
    )
  }

  const { lines } = await collectPending()
  const available = new Map(lines.map(l => [lineKey(l), l]))

  const selected = requested.map(k => available.get(k)).filter(l => l !== undefined)
  const missing = requested.filter(k => !available.has(k))

  // Something the admin ticked is no longer pending, or lost its reservation
  // code, while the modal was open. Refusing the whole request is deliberate:
  // quietly sending the remainder would cancel a different set from the one they
  // reviewed, and they would have no way to tell.
  if (missing.length) {
    return NextResponse.json(
      {
        error: `${missing.length} of the ${requested.length} selected reservation${requested.length === 1 ? '' : 's'} ${missing.length === 1 ? 'is' : 'are'} no longer pending cancellation. Nothing was sent. Reload the list and choose again.`,
        stale: missing,
      },
      { status: 409 }
    )
  }

  const { data: profile } = await adminSupabase
    .from('users').select('full_name').eq('id', user.id).single()

  try {
    await sendCscCancellationRequest({
      lines: selected,
      requestedBy: profile?.full_name || user.email || 'Chambers administrator',
      scopeNote: `${selected.length} reservation${selected.length === 1 ? '' : 's'}, selected individually in Chambers.`,
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
  for (const l of selected) byTable[l.source].push(l.id)

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
  const bookingIds = [...new Set(selected.map(l => l.bookingId).filter(Boolean))]
  if (bookingIds.length) {
    const { error } = await adminSupabase.from('audit_logs').insert(
      bookingIds.map(id => ({ booking_id: id, admin_id: user.id, new_status: 'Cancelled' }))
    )
    if (error) console.error('Auto-Cancel audit log failed:', error)
  }

  return NextResponse.json({
    success: true,
    sent: selected.length,
    recipient: CSC_EMAIL,
    // The mail is already gone, so a failure here is reported rather than thrown:
    // the admin needs to know the request went but the statuses did not move.
    ...(failures.length ? { statusUpdateFailed: failures } : {}),
  })
}
