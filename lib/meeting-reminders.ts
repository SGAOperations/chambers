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
 * Statuses that mean the meeting is not happening, so a reminder would be wrong.
 *
 * Deliberately short. 'Pending Cancellation' is *not* here: that week may still
 * go ahead, and the people in the channel are exactly the ones who need to know
 * it is in doubt -- so it is reported, with its status shown.
 */
const NOT_HAPPENING = new Set(['Cancelled', 'Repurposed', 'Missed'])

/** Statuses ordinary enough that naming them in the reminder would be noise. */
const UNREMARKABLE = new Set(['Reserved', 'Confirmed'])

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
  purpose: string | null
  hidden: boolean | null
  weekly_booking_id: string
  series: {
    room_name: string | null
    start_time: string | null
    end_time: string | null
    status: string | null
  }
  booking: {
    purpose: string | null
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
  status: string | null
  purpose: string | null
}

/**
 * Resolves a candidate against its series, or returns null when no reminder
 * should be posted for it.
 *
 * An occurrence field that is null inherits -- from the series for room, times
 * and status, and from the booking above it for purpose and visibility. That
 * precedence is the same one My Rooms and the update emails apply.
 */
export function resolveMeeting(c: ReminderCandidate): ResolvedMeeting | null {
  if (!c.body.slack_channel_id) return null

  // A hidden booking is visible only to the people who can manage it, so
  // announcing it to a channel would disclose it to everyone in that channel.
  // `?? booking.hidden` is the inheritance: a visible series can hide one week.
  if (c.hidden ?? c.booking.hidden) return null

  const status = c.status ?? c.series.status
  if (status && NOT_HAPPENING.has(status)) return null

  return {
    weeklyBookingId: c.weekly_booking_id,
    date: c.occurrence_date,
    channelId: c.body.slack_channel_id,
    bodyName: c.body.name,
    roomName: c.room_name ?? c.series.room_name,
    startTime: c.start_time ?? c.series.start_time,
    endTime: c.end_time ?? c.series.end_time,
    status,
    purpose: c.purpose ?? c.booking.purpose,
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
 * The reminder text.
 *
 * States what is known and stays quiet about what is not: a week with no room
 * secured says so rather than printing a dash, and an ordinary status is left
 * off entirely so that a status line always means something is unusual.
 */
export function formatReminder(m: ResolvedMeeting): string {
  const start = formatTime(m.startTime)
  const end = formatTime(m.endTime)
  const when = start && end ? `${start}–${end}` : start ?? 'time to be confirmed'

  const lines = [
    `:calendar: *${esc(m.bodyName)}* meets tomorrow — ${formatDate(m.date)}, ${when}`,
  ]

  lines.push(m.roomName ? `*Room:* ${esc(m.roomName)}` : '*Room:* not yet confirmed')

  if (m.purpose?.trim()) lines.push(`*Purpose:* ${esc(m.purpose.trim())}`)

  if (m.status && !UNREMARKABLE.has(m.status)) lines.push(`*Status:* ${esc(m.status)}`)

  return lines.join('\n')
}
