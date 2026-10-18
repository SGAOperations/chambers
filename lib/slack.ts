/**
 * Posting to Slack.
 *
 * chat.postMessage was called inline in the slash-command route with its own
 * fetch and its own header block. Now that the reminder job posts too (issue
 * #95), the call lives here -- mainly so the failure path does, because Slack
 * answers a refused post with HTTP 200 and `ok: false`, and a bare fetch reads
 * that as success. A reminder that silently never arrived is the failure this
 * feature is most likely to have, so it has to be visible in the logs.
 */

const SLACK_POST_MESSAGE_URL = 'https://slack.com/api/chat.postMessage'

export interface SlackPostResult {
  ok: boolean
  /** Slack's machine-readable reason, e.g. 'not_in_channel', 'channel_not_found'. */
  error?: string
}

/**
 * Sends one message. `channel` is a channel id for a channel post, or a user id
 * for a DM.
 *
 * `text` is used as the notification fallback and as the body; pass `blocks` as
 * well for a richer layout, and Slack renders those instead while still using
 * `text` for the push notification and the accessibility label.
 */
export async function postSlackMessage(
  channel: string,
  text: string,
  blocks?: unknown[]
): Promise<SlackPostResult> {
  try {
    const res = await fetch(SLACK_POST_MESSAGE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(blocks ? { channel, text, blocks } : { channel, text }),
    })

    // A 200 from Slack is not a delivered message. The common refusals here are
    // not_in_channel (the bot was never invited) and channel_not_found (the id
    // is wrong, or the channel is private and the bot cannot see it) -- both of
    // which look like a working integration that just never posts.
    const data = (await res.json()) as { ok?: boolean; error?: string }
    if (!data.ok) {
      console.error(`Slack chat.postMessage refused for ${channel}:`, data.error)
      return { ok: false, error: data.error ?? 'unknown_error' }
    }
    return { ok: true }
  } catch (e) {
    console.error(`Slack chat.postMessage failed for ${channel}:`, e)
    return { ok: false, error: 'request_failed' }
  }
}

/**
 * One Web API call as the bot, with the same failure handling as
 * postSlackMessage: Slack's `ok: false` comes back as a failure with its reason,
 * and a network error as 'request_failed', so the caller never has to tell a
 * refused call from a successful one by reading an HTTP 200.
 */
async function callSlack<T extends object>(
  method: string,
  body: Record<string, unknown>
): Promise<({ ok: true } & T) | { ok: false; error: string }> {
  try {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    })
    const data = (await res.json()) as { ok?: boolean; error?: string } & T
    if (!data.ok) return { ok: false, error: data.error ?? 'unknown_error' }
    return data as { ok: true } & T
  } catch (e) {
    console.error(`Slack ${method} failed:`, e)
    return { ok: false, error: 'request_failed' }
  }
}

/**
 * Creates a private channel, for lib/event-channels.ts. Needs the groups:write
 * scope; without it Slack answers `missing_scope`.
 *
 * `name_taken` is returned as an error rather than handled here, so the caller
 * decides what the next name is.
 */
export async function createPrivateSlackChannel(
  name: string
): Promise<{ ok: true; id: string; name: string } | { ok: false; error: string }> {
  const res = await callSlack<{ channel: { id: string; name: string } }>('conversations.create', {
    name,
    is_private: true,
  })
  if (!res.ok) return res
  return { ok: true, id: res.channel.id, name: res.channel.name }
}

/**
 * Invites people to a channel the bot is in, one at a time.
 *
 * One call can take many users, but Slack fails the whole call when any one of
 * them cannot be added (a deactivated account, a guest), and it would then take
 * everyone else down with it. A handful of separate calls costs nothing and
 * reports exactly who did not make it.
 */
export async function inviteToSlackChannel(
  channel: string,
  slackUserIds: string[]
): Promise<{ invited: string[]; failed: { user: string; error: string }[] }> {
  const invited: string[] = []
  const failed: { user: string; error: string }[] = []
  for (const user of slackUserIds) {
    const res = await callSlack('conversations.invite', { channel, users: user })
    // already_in_channel is the outcome we wanted.
    if (res.ok || res.error === 'already_in_channel') invited.push(user)
    else failed.push({ user, error: res.error })
  }
  if (failed.length) {
    console.error(`Slack conversations.invite refused for ${channel}:`, failed)
  }
  return { invited, failed }
}

/** An ephemeral slash-command reply: visible only to whoever ran the command. */
export function ephemeral(text: string): Response {
  return Response.json({ response_type: 'ephemeral', text })
}
