import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { canWriteAdmin } from '@/lib/admin-roles'
import { cscRecipientPreview, resolveCscRecipient } from '@/lib/csc-recipient'
import { sendCscTablingRequest } from '@/lib/emails/csc-tabling-request'
import { collectRequestable } from '@/lib/pending-tabling-requests'
import { alertAwaitingCsc } from '@/lib/request-alerts'
import { AWAITING_CSC, OPS_REVIEW } from '@/lib/request-status'

/**
 * Auto-Request (issue #226): Auto-Cancel's counterpart for new tabling requests.
 *
 * An admin picks tabling requests still in Ops Review, CSC gets one email asking
 * for each of their dates, and the requests move to Awaiting CSC -- the status
 * "Mark Sent to CSC" sets by hand, which is what this replaces for tabling.
 *
 * Admin-selected, not fired when a request is submitted. The issue reads as
 * though the request should go out on its own, but every request starts in Ops
 * Review because Operational Affairs is meant to look at it first, and some
 * never reach CSC at all -- denied, or fulfilled without them. Mailing CSC on
 * submission would put every one of those in a university office's inbox, with
 * no one having read it, and Chambers cannot take an email back. What the issue
 * asks for is the part that is tedious, the writing to CSC, and that is
 * automated here; the deciding stays with a person.
 *
 * Rooms are left out, as the issue says. A room request names a preferred room
 * the admin usually works out with CSC rather than forwards.
 */

async function authorise() {
  const user = await getAuthedUserWithLiveRoles(db)
  if (!user || !user.app_metadata?.is_admin) {
    return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  // Closed to a view-only admin, who may read Bookings and nothing else (#217).
  if (!canWriteAdmin(user.app_metadata?.admin_role)) {
    return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return { res: rateLimitRes }
  return { user }
}

/**
 * Every tabling request that could go to CSC, for the admin to choose from.
 * Nothing is preselected on the other end; this is only the list.
 */
export async function GET() {
  const auth = await authorise()
  if ('res' in auth) return auth.res

  try {
    const { lines, skipped, incomplete } = await collectRequestable()
    return NextResponse.json({ lines, skipped, incomplete, ...cscRecipientPreview() })
  } catch (e) {
    console.error('Auto-Request could not load:', e)
    return NextResponse.json({ error: 'Could not load tabling requests.' }, { status: 500 })
  }
}

/**
 * Emails CSC for the selected requests, then moves them to Awaiting CSC.
 *
 * The same rules as Auto-Cancel, for the same reasons:
 *
 * - The selection is a choice among what the server finds, never the source of
 *   truth. Each posted id is matched against a fresh collection, and the email
 *   is built from the server's rows -- a client cannot add a date, change a
 *   location, slip in a room request, or send one missing a detail CSC needs.
 * - One stale id refuses the whole send. Quietly sending the rest would mail a
 *   different set from the one the admin reviewed.
 * - The email goes first and statuses move only once it has been accepted.
 *   Moving first and failing to send would leave a request saying it is with
 *   CSC when CSC has never heard of it, and nobody would think to chase it.
 */
export async function POST(request: Request) {
  const auth = await authorise()
  if ('res' in auth) return auth.res
  const { user } = auth

  const body = await request.json().catch(() => ({}))
  const requested: string[] = Array.isArray(body?.ids)
    ? [...new Set(body.ids.filter((k: unknown): k is string => typeof k === 'string'))] as string[]
    : []

  if (!requested.length) {
    return NextResponse.json({ error: 'Select at least one tabling request to send.' }, { status: 400 })
  }

  let lines
  try {
    ({ lines } = await collectRequestable())
  } catch (e) {
    console.error('Auto-Request could not load:', e)
    return NextResponse.json({ error: 'Could not load tabling requests. Nothing was sent.' }, { status: 500 })
  }

  const available = new Map(lines.map(l => [l.id, l]))
  const selected = requested.map(id => available.get(id)).filter(l => l !== undefined)
  const missing = requested.filter(id => !available.has(id))

  if (missing.length) {
    return NextResponse.json(
      {
        error: `${missing.length} of the ${requested.length} selected request${requested.length === 1 ? '' : 's'} ${missing.length === 1 ? 'is' : 'are'} no longer in Ops Review with an upcoming date and every detail filled in. Nothing was sent. Reload the list and choose again.`,
        stale: missing,
      },
      { status: 409 }
    )
  }

  const recipient = resolveCscRecipient()
  if ('error' in recipient) {
    // After the selection resolves, before anything leaves or moves, so a
    // misconfigured environment can neither send nor change a status.
    return NextResponse.json({ error: recipient.error }, { status: 400 })
  }

  const { data: profile } = await db.from('users').select('full_name').eq('id', user.id).single()

  try {
    await sendCscTablingRequest({
      requests: selected,
      requestedBy: profile?.full_name || user.email || 'Chambers administrator',
      to: recipient.to,
      cc: process.env.OPS_EMAIL || undefined,
      replyTo: process.env.OPS_EMAIL || undefined,
    })
  } catch (e) {
    // Awaited, and its failure read (see lib/emails/csc-send.ts): the admin is
    // about to be told this went, and nothing has moved yet.
    console.error('CSC tabling request failed:', e)
    return NextResponse.json({ error: 'The email could not be sent. No requests were changed.' }, { status: 502 })
  }

  // Guarded on Ops Review, so a request someone fulfilled, denied or moved while
  // the modal was open keeps what they gave it. The mail has already gone, so a
  // request that slipped through is reported rather than forced.
  const { data: updated, error: updateError } = await db
    .from('room_requests')
    .update({ status: AWAITING_CSC, csc_requested_at: new Date().toISOString(), csc_requested_by: user.id })
    .in('id', selected.map(l => l.id))
    .eq('status', OPS_REVIEW)
    .select('id')

  if (updateError) console.error('Auto-Request could not move requests to Awaiting CSC:', updateError)

  const movedIds = new Set(((updated ?? []) as { id: string }[]).map(r => r.id))
  const moved = selected.filter(l => movedIds.has(l.id))
  const notMoved = selected.filter(l => !movedIds.has(l.id))

  // The requester hears it went to CSC, exactly as when an admin marks it by hand.
  await alertAwaitingCsc(moved.map(l => ({ id: l.id, requestedBy: l.requestedBy })))

  return NextResponse.json({
    success: true,
    sent: selected.length,
    sessions: selected.reduce((n, l) => n + l.sessions.length, 0),
    moved: moved.length,
    recipient: recipient.to,
    // The email is out either way. These are named so the admin can set them by
    // hand rather than sending again.
    ...(notMoved.length
      ? { statusUpdateFailed: notMoved.map(l => `${l.bodyName} — ${l.purpose}`) }
      : {}),
  })
}
