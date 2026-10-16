import type { Db } from './db/data-api'
import type { AuthedUser } from './auth-types'
import { todayInAppZone } from './app-zone'
import { fetchMyRooms } from './my-rooms-data'
import {
  flattenMyRooms,
  formatDate,
  formatTime,
  type FlatBooking,
  type MyRoomsResponse,
} from '@/app/(dashboard)/my-rooms/shared'
import type { CancellationScope, CancellationType } from './cancellation-request'

/**
 * /chambers-cancel: requesting a cancellation from Slack.
 *
 * The list offered is exactly the one My Rooms would offer a Cancel button on:
 * upcoming sessions of bookings the caller manages, minus those already pending
 * or settled (booking-detail-modal.tsx's canCancel). It is read through
 * fetchMyRooms, so the scope rules -- divisional, multi, hidden -- are the same
 * ones the web applies rather than a second copy of them.
 *
 * The submission re-reads this list and refuses anything not on it. That is the
 * authorization: the option value comes back from Slack and is not trusted, and
 * re-deriving the list proves in one step that the session exists, belongs to
 * that booking, is still cancellable, and that the caller manages it.
 */

export const CANCEL_CALLBACK_ID = 'chambers_cancel_request'

/** Statuses My Rooms does not offer a cancellation for. */
const NOT_CANCELLABLE = ['Pending Cancellation', 'Cancelled', 'Virtual']

/** Slack's limits on a static_select: 100 options, 75 characters of text each. */
const MAX_OPTIONS = 100
const MAX_OPTION_TEXT = 75

export interface CancellableSession extends FlatBooking {
  /** How many upcoming sessions the parent booking has on this list. */
  sessionCount: number
}

/**
 * The Slack-linked user as an AuthedUser, deliberately without live-verified
 * roles: hasLiveAdmin() is then false, so admin status grants nothing here and
 * an admin sees only the bookings they lead, as on My Rooms. Admins cancel
 * anything else from /administrator.
 */
function slackUser(chambersUserId: string): AuthedUser {
  return { id: chambersUserId, issuedAt: null, app_metadata: {} }
}

export async function loadCancellableSessions(
  adminSupabase: Db,
  chambersUserId: string
): Promise<CancellableSession[]> {
  // A Slack link outlives a deactivated account; refuse rather than act for it.
  const { data: profile } = await adminSupabase
    .from('users')
    .select('is_active')
    .eq('id', chambersUserId)
    .maybeSingle()
  if (!profile?.is_active) return []

  const payload = await fetchMyRooms(adminSupabase, slackUser(chambersUserId))
  const flat = flattenMyRooms(payload as unknown as MyRoomsResponse, todayInAppZone())

  const counts = new Map<string, number>()
  for (const b of flat) counts.set(b.bookingId, (counts.get(b.bookingId) ?? 0) + 1)

  return flat
    .filter(b => b.canManage && !NOT_CANCELLABLE.includes(b.status))
    .map(b => ({ ...b, sessionCount: counts.get(b.bookingId) ?? 1 }))
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function optionText(s: CancellableSession): string {
  const what = s.purpose?.trim() || s.scopeLabel
  const where = s.location ? ` — ${s.location}` : ''
  return truncate(`${formatDate(s.date)} ${formatTime(s.startTime)} · ${what}${where}`, MAX_OPTION_TEXT)
}

/** bookingId and session id, which is all the submission needs to find it again. */
export function sessionOptionValue(s: Pick<FlatBooking, 'bookingId' | 'id'>): string {
  return `${s.bookingId}|${s.id}`
}

export function buildCancelModal(sessions: CancellableSession[]) {
  const shown = sessions.slice(0, MAX_OPTIONS)
  const blocks: unknown[] = [
    {
      type: 'input',
      block_id: 'session_block',
      label: { type: 'plain_text', text: 'Booking' },
      element: {
        type: 'static_select',
        action_id: 'session_action',
        placeholder: { type: 'plain_text', text: 'Select a date' },
        options: shown.map(s => ({
          text: { type: 'plain_text', text: optionText(s) },
          value: sessionOptionValue(s),
        })),
      },
    },
    {
      type: 'input',
      block_id: 'type_block',
      label: { type: 'plain_text', text: 'Cancellation Type' },
      element: {
        type: 'radio_buttons',
        action_id: 'type_action',
        initial_option: { text: { type: 'plain_text', text: 'Full Cancellation' }, value: 'Cancellation' },
        options: [
          { text: { type: 'plain_text', text: 'Full Cancellation' }, value: 'Cancellation' },
          { text: { type: 'plain_text', text: 'Going Virtual' }, value: 'Virtual' },
        ],
      },
    },
    {
      type: 'input',
      block_id: 'scope_block',
      label: { type: 'plain_text', text: 'Scope' },
      element: {
        type: 'radio_buttons',
        action_id: 'scope_action',
        initial_option: { text: { type: 'plain_text', text: 'This date only' }, value: 'occurrence' },
        options: [
          { text: { type: 'plain_text', text: 'This date only' }, value: 'occurrence' },
          {
            text: { type: 'plain_text', text: 'The whole booking' },
            description: { type: 'plain_text', text: 'Every session or week of this booking' },
            value: 'series',
          },
        ],
      },
    },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: 'This files a request with Operational Affairs, the same as Request Cancellation in My Rooms. The booking shows as Pending Cancellation until it is settled.',
      }],
    },
  ]

  if (sessions.length > MAX_OPTIONS) {
    blocks.push({
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: `Showing the next ${MAX_OPTIONS} sessions. Later ones can be cancelled from <https://chambers.northeasternsga.com/my-rooms|My Rooms>.`,
      }],
    })
  }

  return {
    type: 'modal',
    callback_id: CANCEL_CALLBACK_ID,
    title: { type: 'plain_text', text: 'Request Cancellation' },
    submit: { type: 'plain_text', text: 'Submit' },
    close: { type: 'plain_text', text: 'Close' },
    blocks,
  }
}

export interface ParsedCancelSubmission {
  session: CancellableSession
  scope: CancellationScope
  cancellationType: CancellationType
}

/**
 * Reads a /chambers-cancel submission against a freshly loaded list, or returns
 * the block errors to show. See the module comment for why the list is re-read.
 */
export function parseCancelSubmission(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vals: any,
  sessions: CancellableSession[]
): { ok: true; value: ParsedCancelSubmission } | { ok: false; errors: Record<string, string> } {
  const picked: string | undefined = vals.session_block?.session_action?.selected_option?.value
  const session = picked ? sessions.find(s => sessionOptionValue(s) === picked) : undefined
  if (!session) {
    return {
      ok: false,
      errors: { session_block: 'That booking can no longer be cancelled from here. It may already be pending, or you may no longer lead its body.' },
    }
  }

  const cancellationType: CancellationType =
    vals.type_block?.type_action?.selected_option?.value === 'Virtual' ? 'Virtual' : 'Cancellation'

  let scope: CancellationScope =
    vals.scope_block?.scope_action?.selected_option?.value === 'series' ? 'series' : 'occurrence'

  // My Rooms offers no scope choice for a one-session room or tabling booking and
  // files it as the whole booking (cancel-modal.tsx); do the same, so the two
  // never file different requests for the same booking.
  if (session.type !== 'Weekly Room' && session.sessionCount <= 1) scope = 'series'

  return { ok: true, value: { session, scope, cancellationType } }
}
