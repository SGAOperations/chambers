import { APP_TIME_ZONE } from '@/lib/app-zone'

/**
 * Working out which committee meetings the Slack bot should remind a channel
 * about, and what to say (issue #95).
 *
 * Kept apart from the route so the selection rules -- which weeks count, which
 * are suppressed, how an override resolves against its series -- can be read and
 * exercised without a database or a Slack workspace.
 */

/** The local hour, in APP_TIME_ZONE, at or after which the day-before reminder posts. */
export const REMINDER_HOUR = 9

/**
 * The statuses a reminder is written for, and which lines of it each one calls
 * out as alternate (issue #104).
 *
 * An allow-list rather than a block-list: anything not named here -- Waitlisted,
 * Tentative, Pending Cancellation, Unavailable, Missed, Repurposed, and any
 * status added later -- posts nothing, because none of them says plainly whether
 * or where the committee is meeting.
 */
const REMINDED_STATUSES = new Set([
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
  'Virtual',
  'Cancelled',
])

const ALTERNATE_ROOM = new Set(['Alternate Room', 'Alternate Room and Time'])
const ALTERNATE_TIME = new Set(['Alternate Time', 'Alternate Room and Time'])

/** 'YYYY-MM-DD' and the hour, in APP_TIME_ZONE, for an instant. */
export function appZoneParts(now: Date = new Date()): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(now)

  const get = (type: string) => parts.find(p => p.type === type)?.value ?? ''
  // Intl renders midnight as '24' in some ICU versions under hour12: false.
  const hour = Number(get('hour')) % 24

  return { date: `${get('year')}-${get('month')}-${get('day')}`, hour }
}

/** The day after `date` ('YYYY-MM-DD'), computed on the calendar rather than by adding hours. */
export function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  // UTC noon, so a DST boundary cannot push the arithmetic onto the wrong day.
  const at = new Date(Date.UTC(y, m - 1, d, 12))
  at.setUTCDate(at.getUTCDate() + 1)
  return at.toISOString().slice(0, 10)
}

/**
 * One occurrence as the reminder query returns it, with its series and body
 * attached. Only the fields the rules below touch are declared.
 */
export interface ReminderCandidate {
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  hidden: boolean | null
  weekly_booking_id: string
  series: {
    room_name: string | null
    start_time: string | null
    end_time: string | null
    status: string | null
  }
  booking: {
    hidden: boolean | null
  }
  body: {
    name: string
    slack_channel_id: string | null
  }
}

/** A candidate resolved to the values that actually apply to that week. */
export interface ResolvedMeeting {
  weeklyBookingId: string
  date: string
  channelId: string
  bodyName: string
  roomName: string | null
  startTime: string | null
  endTime: string | null
  status: string
}

/**
 * Resolves a candidate against its series, or returns null when no reminder
 * should be posted for it.
 *
 * An occurrence field that is null inherits -- from the series for room, times
 * and status, and from the booking above it for visibility. That precedence is
 * the same one My Rooms and the update emails apply.
 */
export function resolveMeeting(c: ReminderCandidate): ResolvedMeeting | null {
  if (!c.body.slack_channel_id) return null

  // A hidden booking is visible only to the people who can manage it, so
  // announcing it to a channel would disclose it to everyone in that channel.
  // `?? booking.hidden` is the inheritance: a visible series can hide one week.
  if (c.hidden ?? c.booking.hidden) return null

  const status = c.status ?? c.series.status
  if (!status || !REMINDED_STATUSES.has(status)) return null

  return {
    weeklyBookingId: c.weekly_booking_id,
    date: c.occurrence_date,
    channelId: c.body.slack_channel_id,
    bodyName: c.body.name,
    roomName: c.room_name ?? c.series.room_name,
    startTime: c.start_time ?? c.series.start_time,
    endTime: c.end_time ?? c.series.end_time,
    status,
  }
}

function formatTime(time: string | null): string | null {
  if (!time) return null
  const [h, m] = time.split(':').map(Number)
  if (Number.isNaN(h) || Number.isNaN(m)) return null
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** Slack mrkdwn escaping: only these three characters carry meaning in message text. */
function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/**
 * The reminder text, in the wording set out in issue #104.
 *
 * Cancelled gets a single line, Virtual points members to their Chair or
 * Director rather than naming a room, and every other reminded status names the
 * room and the time -- with "Alternate" in bold on whichever of the two moved,
 * so a member reading quickly sees what is different from the usual week.
 *
 * A room or time that is missing says so rather than printing a blank.
 */
export function formatReminder(m: ResolvedMeeting): string {
  const body = `*${esc(m.bodyName)}*`

  if (m.status === 'Cancelled') return `${body} has no meeting tomorrow.`

  const opening = `${body} meets tomorrow! Join us on ${formatDate(m.date)}.`

  if (m.status === 'Virtual') {
    return [opening, 'Check with your Chair/Director for virtual meeting information.'].join('\n')
  }

  const start = formatTime(m.startTime)
  const end = formatTime(m.endTime)
  const when = start && end ? `${start}–${end}` : start ?? 'to be confirmed'
  const room = m.roomName ? esc(m.roomName) : 'not yet confirmed'

  const roomLabel = ALTERNATE_ROOM.has(m.status) ? '*Alternate* Room' : 'Room'
  const timeLabel = ALTERNATE_TIME.has(m.status) ? '*Alternate* Time' : 'Time'

  return [opening, `${roomLabel}: ${room}`, `${timeLabel}: ${when}`].join('\n')
}
