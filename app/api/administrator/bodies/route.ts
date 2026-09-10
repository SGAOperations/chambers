import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'
import { isBodyType } from '@/lib/body-types'

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: bodies } = await supabase
    .from('bodies')
    .select('id, name, division, is_active, body_open, body_type, slack_channel_id, slack_reminders_enabled')
    .order('name', { ascending: true })

  return NextResponse.json({ bodies: bodies || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Editing bodies is Management-only (#64). GET deliberately is not: the
  // Bookings page, open to every admin, reads it for its body picker.
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { name, division, body_type } = await request.json()

  if (body_type !== undefined && !isBodyType(body_type)) {
    return NextResponse.json({ error: 'Invalid body type.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('bodies')
    // Falls back to the column default rather than guessing from the name. The
    // migration's name-based backfill was a one-off for bodies that predate the
    // column; someone creating one now is looking at the type picker.
    .insert({ name, division, ...(body_type ? { body_type } : {}) })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Editing bodies is Management-only (#64). GET deliberately is not: the
  // Bookings page, open to every admin, reads it for its body picker.
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const {
    id, name, division, is_active, body_open,
    body_type, slack_channel_id, slack_reminders_enabled,
  } = await request.json()

  if (body_type !== undefined && !isBodyType(body_type)) {
    return NextResponse.json({ error: 'Invalid body type.' }, { status: 400 })
  }

  // A channel *id* (C0123ABCDEF), not a name. Storing '#committee-chat' would be
  // accepted silently by Postgres and then never resolve, leaving a committee
  // whose reminders look configured and never arrive -- so reject it here with
  // something a person can act on.
  let channelId: string | null | undefined
  if (slack_channel_id !== undefined) {
    const trimmed = (slack_channel_id ?? '').toString().trim()
    if (!trimmed) {
      channelId = null
    } else if (!/^[A-Z0-9]{6,32}$/.test(trimmed)) {
      return NextResponse.json({
        error: 'That is not a Slack channel ID. Open the channel in Slack, choose View channel details, and copy the ID at the bottom (it looks like C0123ABCDEF).',
      }, { status: 400 })
    } else {
      channelId = trimmed
    }
  }

  const updates: Record<string, unknown> = {}
  if (name !== undefined) updates.name = name
  if (division !== undefined) updates.division = division
  if (is_active !== undefined) updates.is_active = is_active
  if (body_open !== undefined) updates.body_open = body_open
  if (body_type !== undefined) updates.body_type = body_type
  if (channelId !== undefined) updates.slack_channel_id = channelId
  if (slack_reminders_enabled !== undefined) {
    updates.slack_reminders_enabled = !!slack_reminders_enabled
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { error } = await supabase
    .from('bodies')
    .update(updates)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}