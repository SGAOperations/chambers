import { scopedBodyName, type BookingScope, type Division } from '@/lib/booking-scope'

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
  /** The occurrence's own visibility; null means the booking's. */
  hidden: boolean | null
  seriesStatus: string | null
  bookingHidden: boolean | null
  bodyName: string
  scope: BookingScope
  division: Division | null
}

/** Whether a week is a room held for someone, with the occurrence-over-series precedence. */
export function isHeld(c: CancelCandidate): boolean {
  const status = c.status ?? c.seriesStatus
  return !!status && HELD_STATUSES.has(status)
}

export interface CancelSummary {
  /** Every held week next week, hidden ones included. */
  total: number
  /** Held weeks per named booker, largest first. Hidden bookings are not named. */
  byBody: { name: string; count: number }[]
  /** Held weeks belonging to hidden bookings: counted, never named. */
  hiddenCount: number
}

/**
 * Tallies next week's held rooms, or returns null when there are none -- the
 * signal not to post at all.
 *
 * A hidden booking still holds a room, so it still counts towards whether the
 * reminder goes out and towards the total. It is just never named: hidden means
 * only its managers can see it, and a channel is not its managers.
 */
export function summarize(candidates: CancelCandidate[]): CancelSummary | null {
  const held = candidates.filter(isHeld)
  if (!held.length) return null

  const counts = new Map<string, number>()
  let hiddenCount = 0
  for (const c of held) {
    if (c.hidden ?? c.bookingHidden) {
      hiddenCount++
      continue
    }
    const name = scopedBodyName(c, c.bodyName)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }

  const byBody = [...counts]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))

  return { total: held.length, byBody, hiddenCount }
}

/** Slack mrkdwn escaping: only these three characters carry meaning in message text. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
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

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

/** The message, as plain mrkdwn so it reads the same in a phone notification. */
export function formatCancelReminder(week: { start: string; end: string }, summary: CancelSummary): string {
  const lines = [
    `:calendar: *Weekly room check: ${formatDay(week.start)} – ${formatDay(week.end)}*`,
    `SGA is holding ${plural(summary.total, 'weekly room reservation')} next week:`,
    ...summary.byBody.map(b => `• ${esc(b.name)}: ${b.count}`),
  ]
  if (summary.hiddenCount) {
    lines.push(`• ${plural(summary.hiddenCount, 'other reservation')} not listed`)
  }
  lines.push(
    '',
    'If your body is not meeting one of these weeks, request a cancellation before the week starts so the room can be released.',
    `<${CHAMBERS_URL}/my-rooms|Open My Rooms>`
  )
  return lines.join('\n')
}
