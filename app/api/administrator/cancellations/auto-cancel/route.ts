import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { canWriteAdmin } from '@/lib/admin-roles'
import { notifyCancelledReservations } from '@/lib/room-invites'
import { waitUntil } from '@vercel/functions'
import { sendCscCancellationRequest } from '@/lib/emails/csc-cancellation-request'
import { todayInAppZone } from '@/lib/app-zone'
import {
  applyCancellationOutcomes,
  cancellationAuditRows,
  collectPending,
  isUpcoming,
  lineKey,
  requestsFullyCovered,
} from '@/lib/pending-cancellations'
import { cscRecipientPreview, resolveCscRecipient } from '@/lib/csc-recipient'

const adminSupabase = db

/**
 * Everything currently marked for cancellation, for the admin to choose from.
 *
 * Returns the whole set rather than a filtered slice. Auto-Cancel used to take a
 * booking type and a date range and act on whatever matched, which made the
 * filter -- something you set to look around with -- decide what got cancelled.
 * The admin now picks rows explicitly, and this is the list they pick from.
 *
 * Whole, but not unbounded: a date already gone by is left out, because there is
 * no room left for CSC to release (issue #224). Mark as Done on the
 * Cancellations tab is still there for settling one of those.
 */
export async function GET() {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Closed to a view-only admin, who may read Bookings and nothing else (#217).
  if (!canWriteAdmin(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { lines, skipped } = await collectPending({ from: todayInAppZone() })

  return NextResponse.json({
    lines: lines.map(l => ({ ...l, key: lineKey(l) })),
    skipped,
    ...cscRecipientPreview(),
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
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Closed to a view-only admin, who may read Bookings and nothing else (#217).
  if (!canWriteAdmin(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

  // Collected whole and narrowed here, rather than asking collectPending for
  // the upcoming dates alone, because the two uses want different sets. What
  // can be selected is what the GET offered: today onwards. Whether a request
  // is finished is judged against every date it covers, past ones included --
  // a series request with a week that went by still pending has not been dealt
  // with just because the future weeks were sent, and closing it would hide
  // that week from the Cancellations tab, the one place left to settle it.
  const { lines } = await collectPending()
  const today = todayInAppZone()
  const available = new Map(lines.filter(l => isUpcoming(l.date, today)).map(l => [lineKey(l), l]))

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

  const recipient = resolveCscRecipient()
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

  // Shared with marking a request Done by hand, which has to reach the same
  // result: the same request resolved either way should leave the database in
  // the same state.
  const failures = await applyCancellationOutcomes(selected)

  // The body is told too (issue #69). Auto-Cancel emailed CSC to release the
  // room and nobody else, so the meeting stayed on every calendar it had
  // reached. waitUntil: the statuses are written, and the admin should not wait
  // on a Resend round trip.
  waitUntil(
    (async () => {
      try {
        await notifyCancelledReservations(selected)
      } catch (e) {
        console.error('Cancellation notice failed:', e)
      }
    })()
  )

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
  const auditRows = cancellationAuditRows(selected, user.id)
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
