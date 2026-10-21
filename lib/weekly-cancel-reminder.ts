/**
 * The Sunday nudge to #1-leadership to cancel weekly rooms nobody will use.
 *
 * A weekly room is booked for the whole semester at once, so every week of it is
 * held whether or not the body actually meets. A week that goes unused without a
 * cancellation is a room CSC kept for nobody -- and, once marked Missed, a mark
 * against the body. The fix is cheap if someone thinks of it before the week
 * starts, which is what this message is for.
 *
 * One message to one channel, not one per body: it goes to a leadership channel,
 * where the people who file cancellations already are. Which channel is
 * app_settings.cancel_reminder_channel_id, edited on the Management page, so it
 * can move without a deploy. It posts only when next week actually has something
 * to cancel, so a reading week or the gap between semesters stays quiet.
 *
 * Kept apart from the route, like lib/meeting-reminders.ts, so the rules -- which
 * week, which statuses, what the message says -- can be read and exercised
 * without a database or a Slack workspace.
 */

/**
 * What a Slack channel id looks like: C for a public channel, G for an older
 * private one. Checked when the setting is saved, so a channel *name* pasted by
 * mistake is refused there rather than failing silently every Sunday.
 */
export const SLACK_CHANNEL_ID_PATTERN = /^[CG][A-Z0-9]{8,}$/

/** The local hour, in APP_TIME_ZONE, at or after which Sunday's reminder posts. */
export const CANCEL_REMINDER_HOUR = 12

/** getUTCDay() for Sunday. */
const SUNDAY = 0

const CHAMBERS_URL = 'https://chambers.northeasternsga.com'

/**
 * The statuses that mean a room is actually being held for the body that week,
 * and so could be released: the booking as made, or as moved.
 *
 * An allow-list, for the same reason as REMINDED_STATUSES: Cancelled and Pending
 * Cancellation are already on their way out, Virtual and Unavailable hold no
 * room, Waitlisted and Tentative are not yet held, and Missed and Repurposed are
 * settled. None of those is something to remind anyone to cancel.
 */
const HELD_STATUSES = new Set([
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
])

/** Calendar arithmetic on 'YYYY-MM-DD', at UTC noon so DST cannot move the day. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  const at = new Date(Date.UTC(y, m - 1, d, 12))
  at.setUTCDate(at.getUTCDate() + days)
  return at.toISOString().slice(0, 10)
}

export function isSunday(date: string): boolean {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay() === SUNDAY
}

/**
 * The week a reminder sent on `sunday` is about: the Monday after it through the
 * Sunday after that. Not the Sunday it is sent on -- by noon that day is mostly
 * gone, and there is no realistic way to release a room for it.
 */
export function upcomingWeek(sunday: string): { start: string; end: string } {
  return { start: addDays(sunday, 1), end: addDays(sunday, 7) }
}

/** One week of a weekly booking, as the route reads it. */
export interface CancelCandidate {
  /** The occurrence's own status; null means the series'. */
  status: string | null
  seriesStatus: string | null
}

/** Whether a week is a room held for someone, with the occurrence-over-series precedence. */
export function isHeld(c: CancelCandidate): boolean {
  const status = c.status ?? c.seriesStatus
  return !!status && HELD_STATUSES.has(status)
}

/**
 * Whether next week holds any weekly room at all -- the signal to post.
 *
 * The message itself names no bodies and counts nothing (issue #254). Most
 * bodies hold one weekly room, so a per-body tally was a long list telling each
 * leader what they already knew; a short nudge reads better in the channel and
 * on a phone. Hidden bookings still count here: they hold a room as much as any.
 */
export function hasHeldRooms(candidates: CancelCandidate[]): boolean {
  return candidates.some(isHeld)
}

function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** The message, as plain mrkdwn so it reads the same in a phone notification. */
export function formatCancelReminder(week: { start: string; end: string }): string {
  return [
    `:calendar: *Weekly room check: ${formatDay(week.start)} – ${formatDay(week.end)}*`,
    `Not meeting this week? Cancel your room before the week starts, in <${CHAMBERS_URL}/my-rooms|Chambers> or with \`/chambers-cancel\`.`,
  ].join('\n')
}
