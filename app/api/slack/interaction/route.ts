import { waitUntil } from '@vercel/functions'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { verifySlackRequest } from '@/lib/slack-verify'
import { checkRateLimit } from '@/lib/check-rate-limit'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function getMinDateStr(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function blockError(errors: Record<string, string>) {
  return Response.json({ response_action: 'errors', errors })
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
  const payloadRaw = params.get('payload')
  if (!payloadRaw) return new Response(null, { status: 200 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: any = JSON.parse(payloadRaw)

  if (payload.type !== 'view_submission') {
    return new Response(null, { status: 200 })
  }

  const callbackId: string = payload.view.callback_id
  const isRoom = callbackId === 'chambers_room_request'
  const isTabling = callbackId === 'chambers_table_request'

  if (!isRoom && !isTabling) {
    return new Response(null, { status: 200 })
  }

  const slackUserId: string = payload.user.id

  const { data: connection } = await adminSupabase
    .from('slack_connections')
    .select('chambers_user_id')
    .eq('slack_user_id', slackUserId)
    .maybeSingle()

  if (!connection) {
    return blockError({ purpose_block: 'Your Slack account is not linked to Chambers. Please connect at https://chambers.northeasternsga.com/slack/connect' })
  }

  const rateLimitRes = await checkRateLimit(connection.chambers_user_id)
  if (rateLimitRes) return rateLimitRes

  const vals = payload.view.state.values
  const body_id: string = vals.body_block.body_action.selected_option?.value
  const purpose: string = vals.purpose_block.purpose_action.value

  const { data: bodyExists } = await adminSupabase
    .from('bodies')
    .select('id')
    .eq('id', body_id)
    .eq('is_active', true)
    .maybeSingle()

  if (!bodyExists) {
    return blockError({ body_block: 'Invalid body selected.' })
  }
  const room_name: string | null = vals.room_block?.room_action?.value || null
  const date: string = vals.date_block.date_action.selected_date
  const start_time: string = vals.start_time_block.start_time_action.selected_option?.value
  const end_time: string = vals.end_time_block.end_time_action.selected_option?.value
  const notes: string | null = vals.notes_block.notes_action.value || null

  if (end_time <= start_time) {
    return blockError({ end_time_block: 'End time must be after start time.' })
  }

  const { data: settings } = await adminSupabase
    .from('app_settings')
    .select('min_days_advance_room, min_days_advance_tabling')
    .eq('id', 1)
    .maybeSingle()

  const minDaysRoom = settings?.min_days_advance_room ?? 0
  const minDaysTabling = settings?.min_days_advance_tabling ?? 0

  if (isRoom && minDaysRoom > 0) {
    const minDate = getMinDateStr(minDaysRoom)
    if (date < minDate) {
      return blockError({
        date_block: `Room bookings require at least ${minDaysRoom} day${minDaysRoom === 1 ? '' : 's'} advance notice. Please select a date of ${minDate} or later.`,
      })
    }
  }

  if (isTabling && minDaysTabling > 0) {
    const minDate = getMinDateStr(minDaysTabling)
    if (date < minDate) {
      return blockError({
        date_block: `Tabling bookings require at least ${minDaysTabling} day${minDaysTabling === 1 ? '' : 's'} advance notice. Please select a date of ${minDate} or later.`,
      })
    }
  }

  const type = isRoom ? 'One-Time Room' : 'Tabling'

  const { data: roomRequest, error: requestError } = await adminSupabase
    .from('room_requests')
    .insert({
      type,
      body_id,
      purpose,
      notes: notes || null,
      requested_by: connection.chambers_user_id,
      status: 'Pending',
    })
    .select()
    .single()

  if (requestError) {
    return blockError({ purpose_block: 'Something went wrong. Please try again.' })
  }

  if (isRoom) {
    const { error: detailError } = await adminSupabase
      .from('room_request_details')
      .insert({
        request_id: roomRequest.id,
        room_name: room_name || null,
        start_date: date,
        start_time,
        end_time,
        end_date: null,
      })

    if (detailError) {
      return blockError({ purpose_block: 'Something went wrong. Please try again.' })
    }
  }

  if (isTabling) {
    const { error: sessionError } = await adminSupabase
      .from('tabling_request_sessions')
      .insert({
        request_id: roomRequest.id,
        session_date: date,
        start_time,
        end_time,
      })

    if (sessionError) {
      return blockError({ purpose_block: 'Something went wrong. Please try again.' })
    }
  }

  waitUntil(
    fetch('https://slack.com/api/chat.postEphemeral', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({
        channel: slackUserId,
        user: slackUserId,
        text: 'Your booking request has been submitted! You can view it at https://chambers.northeasternsga.com/request',
      }),
    }).catch(() => {})
  )

  return Response.json({ response_action: 'clear' })
}
