import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'
import { postSlackMessage } from '@/lib/slack'
import { formatCallOpenedMessage, isCallOpen, type ProgramCall } from '@/lib/call-for-programs'
import { getLatestCall } from '@/lib/call-for-programs-data'

/**
 * The call for programs, from the Management page: open it, close it, move its
 * automatic close, and read what bodies submitted.
 *
 * Management roles only (#64), like the settings it sits beside.
 */

async function authorize() {
  const user = await getAuthedUserWithLiveRoles(db)
  if (!user || !user.app_metadata?.is_admin) {
    return { res: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return { res: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return { res: rateLimitRes }
  return { user }
}

/** A future instant as ISO, null for "no automatic close", undefined if invalid. */
function parseClosesAt(v: unknown): string | null | undefined {
  if (v === null || v === '' || v === undefined) return null
  if (typeof v !== 'string') return undefined
  const at = new Date(v)
  if (Number.isNaN(at.getTime()) || at <= new Date()) return undefined
  return at.toISOString()
}

const CLOSES_AT_ERROR = 'The automatic close has to be a time in the future.'

export async function GET(request: Request) {
  const auth = await authorize()
  if (auth.res) return auth.res

  const { data: callRows, error } = await db
    .from('program_calls')
    .select('id, opened_at, closes_at, closed_at')
    .order('opened_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const calls = (callRows ?? []) as ProgramCall[]

  const requested = new URL(request.url).searchParams.get('call_id')
  const selected = calls.find(c => c.id === requested) ?? calls[0] ?? null

  if (!selected) {
    return NextResponse.json({ calls: [], open: false, selectedId: null, submissions: [], missing: [] })
  }

  const [{ data: submissions, error: subError }, { data: bodies }] = await Promise.all([
    db
      .from('program_submissions')
      .select(`
        id, body_id, created_at, prior_snapshot, change_type, requested_room, requested_capacity,
        requested_day, requested_start_time, requested_end_time, time_is_range, comments,
        bodies(name), users(full_name)
      `)
      .eq('call_id', selected.id),
    db.from('bodies').select('id, name').eq('is_active', true).order('name', { ascending: true }),
  ])
  if (subError) return NextResponse.json({ error: subError.message }, { status: 500 })

  const rows = ((submissions ?? []) as unknown as { body_id: string; bodies: { name: string } | null }[])
    .sort((a, b) => (a.bodies?.name ?? '').localeCompare(b.bodies?.name ?? ''))
  const answered = new Set(rows.map(s => s.body_id))
  const missing = ((bodies ?? []) as { id: string; name: string }[])
    .filter(b => !answered.has(b.id))
    .map(b => b.name)

  return NextResponse.json({
    calls,
    open: isCallOpen(calls[0] ?? null),
    selectedId: selected.id,
    submissions: rows,
    missing,
  })
}

/** Opens a new call, closing any still open, and posts the one Slack message. */
export async function POST(request: Request) {
  const auth = await authorize()
  if (auth.res) return auth.res
  const { user } = auth

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
  const closesAt = parseClosesAt(body.closes_at)
  if (closesAt === undefined) return NextResponse.json({ error: CLOSES_AT_ERROR }, { status: 400 })

  // Close whatever is unclosed first: one unclosed call at a time is a unique
  // index, and a call that passed its automatic close is still unclosed.
  const now = new Date().toISOString()
  const { error: closeError } = await db
    .from('program_calls')
    .update({ closed_at: now, closed_by: user.id })
    .is('closed_at', null)
  if (closeError) return NextResponse.json({ error: closeError.message }, { status: 500 })

  const { error } = await db
    .from('program_calls')
    .insert({ opened_by: user.id, closes_at: closesAt })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // The leadership channel the Sunday reminder uses. The call is open whether
  // or not Slack takes the message; the admin is told if it did not.
  const { data: settings } = await db
    .from('app_settings')
    .select('cancel_reminder_channel_id')
    .eq('id', 1)
    .maybeSingle()
  const channel = (settings?.cancel_reminder_channel_id as string | null)?.trim()

  let slack: { ok: boolean; error?: string }
  if (!channel) {
    slack = { ok: false, error: 'No Slack channel is set under Weekly Cancellation Reminder.' }
  } else if (!process.env.SLACK_BOT_TOKEN) {
    slack = { ok: false, error: 'SLACK_BOT_TOKEN is not set.' }
  } else {
    slack = await postSlackMessage(channel, formatCallOpenedMessage(closesAt))
  }

  return NextResponse.json({ success: true, slack })
}

/** { action: 'close' } closes the open call now; { closes_at } moves or clears its automatic close. */
export async function PATCH(request: Request) {
  const auth = await authorize()
  if (auth.res) return auth.res
  const { user } = auth

  const body = (await request.json()) as Record<string, unknown>

  const call = await getLatestCall(db)
  if (!isCallOpen(call)) {
    return NextResponse.json({ error: 'There is no open call.' }, { status: 409 })
  }

  let patch: Record<string, string | null>
  if (body.action === 'close') {
    patch = { closed_at: new Date().toISOString(), closed_by: user.id }
  } else if ('closes_at' in body) {
    const closesAt = parseClosesAt(body.closes_at)
    if (closesAt === undefined) return NextResponse.json({ error: CLOSES_AT_ERROR }, { status: 400 })
    patch = { closes_at: closesAt }
  } else {
    return NextResponse.json({ error: 'Nothing to change.' }, { status: 400 })
  }

  const { error } = await db.from('program_calls').update(patch).eq('id', call!.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
