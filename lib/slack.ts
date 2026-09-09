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

/** An ephemeral slash-command reply: visible only to whoever ran the command. */
export function ephemeral(text: string): Response {
  return Response.json({ response_type: 'ephemeral', text })
}
