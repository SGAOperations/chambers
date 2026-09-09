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
  const lines = await collectPending(type, from, to)

  return NextResponse.json({ lines, recipient: CSC_EMAIL, scopeNote: describeScope(type, from, to) })
}

/**
 * Sends the request to CSC.
 *
 * Deliberately changes no booking status. The email asks CSC to release the
 * rooms; CSC is the authority on whether that happened, and marking anything
 * 'Cancelled' here would assert an outcome Chambers has not been told. The
 * existing "Mark as Done" control on the cancellation request stays the human
 * step for closing the loop.
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

  const lines = await collectPending(type, from, to)
  if (!lines.length) {
    return NextResponse.json(
      { error: 'Nothing is marked Pending Cancellation for those filters.' },
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
      replyTo: process.env.OPS_EMAIL || undefined,
    })
  } catch (e) {
    // Awaited, not fire-and-forget like the member-facing emails: this one is the
    // entire point of the request, and an admin who is told it sent needs that to
    // be true.
    console.error('CSC cancellation request failed:', e)
    return NextResponse.json({ error: 'The email could not be sent. Nothing was changed.' }, { status: 502 })
  }

  return NextResponse.json({ success: true, sent: lines.length, recipient: CSC_EMAIL })
}
