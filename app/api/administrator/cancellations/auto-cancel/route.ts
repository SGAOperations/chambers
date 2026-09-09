import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { sendCscCancellationRequest, type CancellationLine } from '@/lib/emails/csc-cancellation-request'
import { collectPending, lineKey, requestsFullyCovered } from '@/lib/pending-cancellations'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const DEFAULT_CSC_EMAIL = 'cscreservations@northeastern.edu'

/**
 * Where the cancellation request goes, and whether it may be sent at all.
 *
 * The default used to apply everywhere CSC_EMAIL was unset, which made a test
 * run safe only if an environment variable had been set, in the right Vercel
 * scope, on a deployment created after it was added -- and gave no sign when any
 * of that was not true. It mailed CSC instead. That happened.
 *
 * So outside production the real address is refused rather than defaulted to.
 * A preview deployment or a local server must name its recipient explicitly, and
 * if it has not, the request fails with an explanation instead of reaching a
 * university office. The failure mode is now "your test did not send", which
 * costs a minute, rather than "CSC received a real cancellation request", which
 * costs an apology and a retraction.
 *
 * Production is unchanged: VERCEL_ENV is 'production' there and the default
 * applies, so nothing has to be configured for the feature to work in earnest.
 */
function resolveRecipient(): { to: string; isDefault: boolean } | { error: string } {
  const override = process.env.CSC_EMAIL?.trim()
  if (override) return { to: override, isDefault: false }

  // Vercel sets this to 'production' | 'preview' | 'development'. It is absent
  // under `next dev`, which is treated as not-production -- the safe reading.
  if (process.env.VERCEL_ENV !== 'production') {
    return {
      error:
        `Refusing to send: this is not the production deployment, and CSC_EMAIL is not set, so the request would go to ${DEFAULT_CSC_EMAIL}. ` +
        `Set CSC_EMAIL to a test address for this environment and redeploy, then try again.`,
    }
  }

  return { to: DEFAULT_CSC_EMAIL, isDefault: true }
}

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
  const recipient = resolveRecipient()

  return NextResponse.json({
    lines: lines.map(l => ({ ...l, key: lineKey(l) })),
    skipped,
    // Surfaced before anything is selected, so the modal can say where this is
    // headed -- or refuse up front rather than at the click.
    recipient: 'to' in recipient ? recipient.to : null,
    recipientIsReal: 'to' in recipient ? recipient.isDefault : false,
    blocked: 'error' in recipient ? recipient.error : null,
    cc: process.env.OPS_EMAIL || null,
  })
}

/**
 * Sends the request to CSC for the reservations the admin selected, and applies
 * the status each one is due.
 *
 * Not always 'Cancelled'. A cancellation request records whether the meeting is
 * off or moving online, and Auto-Cancel applies the one that was actually asked
 * for -- 'Virtual' means the meeting still happens without the room. CSC's side
 * is identical either way: the reservation is released.
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
 * Cancellation requests that this send fully covers are marked Done, so nobody
 * has to close by hand what Auto-Cancel already did. A request covering more
 * dates than were sent stays open -- see the note at the update itself.
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

  const recipient = resolveRecipient()
  if ('error' in recipient) {
    // Checked after the selection resolves but before anything leaves or moves,
    // so a misconfigured environment cannot send and cannot cancel.
    return NextResponse.json({ error: recipient.error }, { status: 400 })
  }

  const { data: profile } = await adminSupabase
    .from('users').select('full_name').eq('id', user.id).single()

  try {
    await sendCscCancellationRequest({
      lines: selected,
      requestedBy: profile?.full_name || user.email || 'Chambers administrator',
      scopeNote: `${selected.length} reservation${selected.length === 1 ? '' : 's'}, selected individually in Chambers.`,
      to: recipient.to,
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

  // Grouped by table *and* by the status each row is due, so a batch containing
  // both kinds writes each its own value. Marking everything 'Cancelled' would
  // be wrong for a booking whose request said it was going virtual: that meeting
  // still happens, it just does not need the room.
  //
  // An occurrence whose status was inherited gets its value written onto the
  // occurrence itself, which is correct -- only the dates actually sent stop
  // being pending, and the rest of the series is untouched.
  const TABLE_OF: Record<CancellationLine['source'], string> = {
    one_time: 'one_time_room_bookings',
    occurrence: 'weekly_room_occurrences',
    tabling_session: 'tabling_sessions',
  }

  const batches = new Map<string, { table: string; status: string; ids: string[] }>()
  for (const l of selected) {
    const table = TABLE_OF[l.source]
    const bucket = `${table}:${l.resultingStatus}`
    if (!batches.has(bucket)) batches.set(bucket, { table, status: l.resultingStatus, ids: [] })
    batches.get(bucket)!.ids.push(l.id)
  }

  const failures: string[] = []
  for (const { table, status, ids } of batches.values()) {
    const { error } = await adminSupabase.from(table).update({ status }).in('id', ids)
    if (error) {
      console.error(`Auto-Cancel could not mark ${table} as ${status}:`, error)
      failures.push(`${table} (${status})`)
    }
  }

  // Close the cancellation requests this send acted on, so nobody has to go and
  // press "Mark as Done" for work Auto-Cancel already did.
  //
  // Only when every pending reservation a request covers was included. An
  // occurrence-scoped request covers exactly one row and is therefore closed
  // whenever it is selected, but a series-scoped one covers the whole run: if the
  // admin sent three weeks of a five-week cancellation, the request is not
  // finished, and marking it Done would drop the remaining two off the
  // Cancellations tab with nothing done about them.
  const fullyHandled = requestsFullyCovered(lines, new Set(selected.map(lineKey)))

  if (fullyHandled.length) {
    // Guarded on Pending so this cannot reopen or re-close a request someone
    // resolved by hand while the modal was open.
    const { error } = await adminSupabase
      .from('cancellation_requests')
      .update({ status: 'Done' })
      .in('id', fullyHandled)
      .eq('status', 'Pending')
    // Best effort, like the audit rows: the mail is out and the statuses have
    // moved, and failing the request over this would invite a resend.
    if (error) console.error('Auto-Cancel could not close cancellation requests:', error)
  }

  // One entry per booking touched, so the change shows up in the Audit tab
  // beside every other status change rather than appearing to have happened by
  // itself. Best effort: the email is out and the statuses are moved, and
  // failing the request over a missing log would invite a resend.
  // Keyed on booking *and* status: one booking can contribute both a cancelled
  // week and a virtual one in the same batch, and a single row saying 'Cancelled'
  // would misreport the other.
  const auditRows = [...new Map(
    selected
      .filter(l => l.bookingId)
      .map(l => [`${l.bookingId}:${l.resultingStatus}`, { booking_id: l.bookingId, admin_id: user.id, new_status: l.resultingStatus }])
  ).values()]
  if (auditRows.length) {
    const { error } = await adminSupabase.from('audit_logs').insert(auditRows)
    if (error) console.error('Auto-Cancel audit log failed:', error)
  }

  return NextResponse.json({
    success: true,
    sent: selected.length,
    cancelled: selected.filter(l => l.resultingStatus === 'Cancelled').length,
    virtual: selected.filter(l => l.resultingStatus === 'Virtual').length,
    requestsClosed: fullyHandled.length,
    recipient: recipient.to,
    // The mail is already gone, so a failure here is reported rather than thrown:
    // the admin needs to know the request went but the statuses did not move.
    ...(failures.length ? { statusUpdateFailed: failures } : {}),
  })
}
