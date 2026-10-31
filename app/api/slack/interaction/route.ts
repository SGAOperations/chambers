import { db } from '@/lib/db/data-api'
import { waitUntil } from '@vercel/functions'
import { verifySlackRequest } from '@/lib/slack-verify'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { OPS_REVIEW } from '@/lib/request-status'
import { queueAdminRequestAlert } from '@/lib/admin-slack-alerts'
import {
  LOCATION_ERROR,
  LOCATION_REQUIRED_ERROR,
  TABLES_ERROR,
  cleanLocation,
  invalidTableCount,
} from '@/lib/tabling-request'
import { fileCancellationRequest } from '@/lib/cancellation-request'
import { resolveSlackUser, slackAccountHref } from '@/lib/slack-identity'
import {
  CANCEL_CALLBACK_ID,
  loadCancellableSessions,
  parseCancelSubmission,
} from '@/lib/slack-cancel'

const adminSupabase = db

function getMinDateStr(days: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function blockError(errors: Record<string, string>) {
  return Response.json({ response_action: 'errors', errors })
}

function confirmToUser(slackUserId: string, text: string) {
  waitUntil(
    fetch('https://slack.com/api/chat.postEphemeral', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify({ channel: slackUserId, user: slackUserId, text }),
    }).catch(() => {})
  )
}

/**
 * A /chambers-cancel submission. The request itself is filed by the same code
 * as My Rooms' (lib/cancellation-request.ts); what is Slack's own is finding
 * the session again and proving the caller may cancel it (lib/slack-cancel.ts).
 */
/**
 * The Chambers user who submitted a modal, or the message to show them instead.
 * Through SGAuth under SGAUTH_ENABLED, slack_connections otherwise (#268). They
 * opened the modal with a linked account, so a miss here means the link went
 * away in between, or SGAuth could not be asked.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function connectionFor(payload: any): Promise<{ chambers_user_id: string } | string> {
  const resolved = await resolveSlackUser(payload.user.id, payload.user.team_id ?? payload.team?.id)
  switch (resolved.status) {
    case 'linked':
      return { chambers_user_id: resolved.chambersUserId }
    case 'error':
      return "Chambers couldn't check your SGA account just now. Please try again in a minute."
    case 'no_chambers_account':
      return 'Sign in to Chambers once at https://chambers.northeasternsga.com, then try again.'
    case 'unlinked':
      return `Your Slack account is not linked to Chambers. Run the command again for a new link, or manage it at ${slackAccountHref()}`
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function handleCancelSubmission(payload: any): Promise<Response> {
  const slackUserId: string = payload.user.id

  const connection = await connectionFor(payload)
  if (typeof connection === 'string') return blockError({ session_block: connection })

  const rateLimitRes = await checkRateLimit(connection.chambers_user_id)
  if (rateLimitRes) return rateLimitRes

  const sessions = await loadCancellableSessions(adminSupabase, connection.chambers_user_id)
  const parsed = parseCancelSubmission(payload.view.state.values, sessions)
  if (!parsed.ok) return blockError(parsed.errors)

  const { session, scope, cancellationType } = parsed.value

  const { error } = await fileCancellationRequest(adminSupabase, {
    bookingId: session.bookingId,
    bookingType: session.type,
    occurrenceId: scope === 'occurrence' ? session.id : null,
    scope,
    cancellationType,
    requestedBy: connection.chambers_user_id,
  })

  if (error) {
    console.error('slack /chambers-cancel failed:', error)
    return blockError({ session_block: 'Something went wrong. Please try again.' })
  }

  const purpose = session.purpose?.trim()
  // Names the body too (issue #241): someone leading several bodies otherwise
  // gets a confirmation that could be about any of them.
  const what = purpose && purpose !== session.scopeLabel
    ? `${purpose} (${session.scopeLabel})`
    : session.scopeLabel
  const which = scope === 'occurrence' ? `on ${session.date}` : '(the whole booking)'
  confirmToUser(
    slackUserId,
    `Your ${cancellationType === 'Virtual' ? 'request to go virtual' : 'cancellation request'} for ${what} ${which} has been submitted. You can follow it at https://chambers.northeasternsga.com/my-rooms`
  )

  return Response.json({ response_action: 'clear' })
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

  if (callbackId === CANCEL_CALLBACK_ID) return handleCancelSubmission(payload)

  const isRoom = callbackId === 'chambers_room_request'
  const isTabling = callbackId === 'chambers_table_request'

  if (!isRoom && !isTabling) {
    return new Response(null, { status: 200 })
  }

  const slackUserId: string = payload.user.id

  const connection = await connectionFor(payload)
  if (typeof connection === 'string') return blockError({ purpose_block: connection })

  const rateLimitRes = await checkRateLimit(connection.chambers_user_id)
  if (rateLimitRes) return rateLimitRes

  const vals = payload.view.state.values
  const body_id: string = vals.body_block.body_action.selected_option?.value
  const purpose: string = vals.purpose_block.purpose_action.value

  // `name` for the admin alert below (issue #219); the row is read either way to
  // check the body is real and active.
  const { data: bodyExists } = await adminSupabase
    .from('bodies')
    .select('id, name')
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

  // Checked again here although Slack marks both blocks required: a modal
  // opened before this release has neither block, and its submission must be
  // refused rather than filed as a request Auto-Request can never send. The
  // rules are the request form's, from the same module.
  let tablingLocation: string | null = null
  let tablingTables: number | null = null
  if (isTabling) {
    const location = cleanLocation(vals.location_block?.location_action?.value)
    if (location === undefined) return blockError({ location_block: LOCATION_ERROR })
    // A modal from before this change has no location_block to attach the
    // error to, and Slack drops errors for unknown blocks, so it goes on purpose.
    if (location === null) {
      return blockError(vals.location_block
        ? { location_block: LOCATION_REQUIRED_ERROR }
        : { purpose_block: `${LOCATION_REQUIRED_ERROR} Close this form and run /chambers-table again.` })
    }
    const tables = vals.tables_block?.tables_action?.value
    if (invalidTableCount(tables)) {
      return blockError(vals.tables_block
        ? { tables_block: TABLES_ERROR }
        : { purpose_block: `${TABLES_ERROR} Close this form and run /chambers-table again.` })
    }
    tablingLocation = location
    tablingTables = Number(tables)
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
      status: OPS_REVIEW,
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
        location: tablingLocation,
        tables: tablingTables,
      })

    if (sessionError) {
      return blockError({ purpose_block: 'Something went wrong. Please try again.' })
    }
  }

  // A quick request from Slack is still a new booking request, so Operational
  // Affairs and the Comptroller hear about it the same way (issue #219). A
  // request made from here is always a single body on a single date.
  queueAdminRequestAlert(adminSupabase, {
    kind: 'booking',
    bookingType: type,
    audience: bodyExists.name,
    requestedBy: connection.chambers_user_id,
    room: isTabling ? tablingLocation : room_name,
    date,
    startTime: start_time,
    endTime: end_time,
    detail: purpose,
  })

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
