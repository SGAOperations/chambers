import { randomBytes } from 'crypto'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifySlackRequest } from '@/lib/slack-verify'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function generateTimeOptions() {
  const opts = []
  for (let h = 7; h < 24; h++) {
    for (let m = 0; m < 60; m += 15) {
      const h12 = h % 12 || 12
      const ampm = h < 12 ? 'AM' : 'PM'
      const label = `${h12}:${String(m).padStart(2, '0')} ${ampm}`
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
      opts.push({ text: { type: 'plain_text', text: label }, value })
    }
  }
  return opts
}

function buildRoomModal(bodies: { id: string; name: string }[]) {
  const timeOptions = generateTimeOptions()
  return {
    type: 'modal',
    callback_id: 'chambers_room_request',
    title: { type: 'plain_text', text: 'Room Booking Request' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'body_block',
        label: { type: 'plain_text', text: 'Body' },
        element: {
          type: 'static_select',
          action_id: 'body_action',
          placeholder: { type: 'plain_text', text: 'Select a body' },
          options: bodies.map(b => ({
            text: { type: 'plain_text', text: b.name },
            value: b.id,
          })),
        },
      },
      {
        type: 'input',
        block_id: 'purpose_block',
        label: { type: 'plain_text', text: 'Purpose' },
        element: {
          type: 'plain_text_input',
          action_id: 'purpose_action',
          placeholder: { type: 'plain_text', text: 'What is this room for?' },
        },
      },
      {
        type: 'input',
        block_id: 'room_block',
        label: { type: 'plain_text', text: 'Preferred Room (optional)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'room_action',
          placeholder: { type: 'plain_text', text: 'e.g. 209 Ell Hall' },
        },
      },
      {
        type: 'input',
        block_id: 'date_block',
        label: { type: 'plain_text', text: 'Date' },
        element: {
          type: 'datepicker',
          action_id: 'date_action',
          placeholder: { type: 'plain_text', text: 'Select a date' },
        },
      },
      {
        type: 'input',
        block_id: 'start_time_block',
        label: { type: 'plain_text', text: 'Start Time' },
        element: {
          type: 'static_select',
          action_id: 'start_time_action',
          placeholder: { type: 'plain_text', text: 'Select start time' },
          options: timeOptions,
        },
      },
      {
        type: 'input',
        block_id: 'end_time_block',
        label: { type: 'plain_text', text: 'End Time' },
        element: {
          type: 'static_select',
          action_id: 'end_time_action',
          placeholder: { type: 'plain_text', text: 'Select end time' },
          options: timeOptions,
        },
      },
      {
        type: 'input',
        block_id: 'notes_block',
        label: { type: 'plain_text', text: 'Additional Notes (optional)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'notes_action',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Any additional details...' },
        },
      },
    ],
  }
}

function buildTablingModal(bodies: { id: string; name: string }[]) {
  const timeOptions = generateTimeOptions()
  return {
    type: 'modal',
    callback_id: 'chambers_table_request',
    title: { type: 'plain_text', text: 'Tabling Request' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Cancel' },
    blocks: [
      {
        type: 'input',
        block_id: 'body_block',
        label: { type: 'plain_text', text: 'Body' },
        element: {
          type: 'static_select',
          action_id: 'body_action',
          placeholder: { type: 'plain_text', text: 'Select a body' },
          options: bodies.map(b => ({
            text: { type: 'plain_text', text: b.name },
            value: b.id,
          })),
        },
      },
      {
        type: 'input',
        block_id: 'purpose_block',
        label: { type: 'plain_text', text: 'Purpose' },
        element: {
          type: 'plain_text_input',
          action_id: 'purpose_action',
          placeholder: { type: 'plain_text', text: 'What is this tabling session for?' },
        },
      },
      {
        type: 'input',
        block_id: 'date_block',
        label: { type: 'plain_text', text: 'Date' },
        element: {
          type: 'datepicker',
          action_id: 'date_action',
          placeholder: { type: 'plain_text', text: 'Select a date' },
        },
      },
      {
        type: 'input',
        block_id: 'start_time_block',
        label: { type: 'plain_text', text: 'Start Time' },
        element: {
          type: 'static_select',
          action_id: 'start_time_action',
          placeholder: { type: 'plain_text', text: 'Select start time' },
          options: timeOptions,
        },
      },
      {
        type: 'input',
        block_id: 'end_time_block',
        label: { type: 'plain_text', text: 'End Time' },
        element: {
          type: 'static_select',
          action_id: 'end_time_action',
          placeholder: { type: 'plain_text', text: 'Select end time' },
          options: timeOptions,
        },
      },
      {
        type: 'input',
        block_id: 'notes_block',
        label: { type: 'plain_text', text: 'Additional Notes (optional)' },
        optional: true,
        element: {
          type: 'plain_text_input',
          action_id: 'notes_action',
          multiline: true,
          placeholder: { type: 'plain_text', text: 'Any additional details...' },
        },
      },
    ],
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()

  const valid = await verifySlackRequest(
    rawBody,
    request.headers.get('X-Slack-Request-Timestamp'),
    request.headers.get('X-Slack-Signature')
  )
  if (!valid) return new Response('Unauthorized', { status: 401 })

  const params = new URLSearchParams(rawBody)
  const command = params.get('command')
  const triggerId = params.get('trigger_id')
  const slackUserId = params.get('user_id')

  if (!triggerId || !slackUserId) {
    return new Response('Bad Request', { status: 400 })
  }

  const { data: connection } = await adminSupabase
    .from('slack_connections')
    .select('chambers_user_id')
    .eq('slack_user_id', slackUserId)
    .maybeSingle()

  if (!connection) {
    const token = randomBytes(32).toString('hex')
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

    await adminSupabase
      .from('slack_connect_tokens')
      .insert({ token, slack_user_id: slackUserId, expires_at: expiresAt })

    await fetch('https://slack.com/api/chat.postMessage', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: slackUserId,
        text: `To use Chambers from Slack, link your account here (expires in 15 minutes): https://chambers.northeasternsga.com/slack/connect?token=${token}`,
      }),
    })

    return Response.json({
      response_type: 'ephemeral',
      text: "Check your DMs — we've sent you a link to connect your Chambers account.",
    })
  }

  const { data: bodies } = await adminSupabase
    .from('bodies')
    .select('id, name')
    .eq('is_active', true)
    .order('name', { ascending: true })

  const modal =
    command === '/chambers-table'
      ? buildTablingModal(bodies ?? [])
      : buildRoomModal(bodies ?? [])

  await fetch('https://slack.com/api/views.open', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
    },
    body: JSON.stringify({ trigger_id: triggerId, view: modal }),
  })

  return new Response(null, { status: 200 })
}
