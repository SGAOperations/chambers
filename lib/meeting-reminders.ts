import { APP_TIME_ZONE } from '@/lib/app-zone'
import { resolveMeetingTime } from '@/lib/meeting-time'
import { scopedBodyName, type BookingScope, type Division } from '@/lib/booking-scope'

/**
 * Working out which meetings the Slack bot should remind a channel about, and
 * what to say (issues #95, #104).
 *
 * Applies to any body with a channel linked, not just committees; nothing here
 * ever looked at the body type.
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
 * or where the body is meeting.
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

/** A body a reminder could be posted to, as the cron reads it. */
export interface ReminderBody {
  id: string
  name: string
  division: string | null
  slack_channel_id: string | null
  slack_reminders_enabled: boolean | null
}

/** The scope-bearing columns of the booking a candidate belongs to. */
export interface ReminderBooking {
  body_id: string
  scope: BookingScope
  division: Division | null
  hidden: boolean | null
  /** Its booking_bodies rows, for a multi booking. Ignored for any other scope. */
  linkedBodyIds: string[]
}

/**
 * Every body a booking's reminder is for (issue #212).
 *
 * The same rule resolveBookingBodyIds() applies to emails and alerts -- the
 * division for a divisional booking, the listed bodies for a multi one, the
 * owner alone otherwise -- answered from a list of bodies already in hand rather
 * than a query per booking, because the cron reads every active body once and
 * then settles the whole day from it.
 *
 * Live, not stored: a body added to a division is in the audience of that
 * division's existing bookings from the next morning on. That is what divisional
 * means, and it is the same choice resolveBookingBodyIds() makes.
 *
 * The owner is always included even where its own division has since moved,
 * because the booking is still attributed to it.
 */
export function audienceBodies(booking: ReminderBooking, bodies: ReminderBody[]): ReminderBody[] {
  const owner = bodies.find(b => b.id === booking.body_id)

  let audience: ReminderBody[]
  if (booking.scope === 'divisional' && booking.division) {
    audience = bodies.filter(b => b.division === booking.division)
  } else if (booking.scope === 'multi') {
    audience = bodies.filter(b => booking.linkedBodyIds.includes(b.id))
  } else {
    audience = owner ? [owner] : []
  }

  if (owner && !audience.some(b => b.id === owner.id)) audience = [owner, ...audience]
  return audience
}

/**
 * One occurrence as the reminder query returns it, with its series, its booking
 * and its audience attached. Only the fields the rules below touch are declared.
 */
export interface ReminderCandidate {
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  meeting_time: string | null
  status: string | null
  hidden: boolean | null
  weekly_booking_id: string
  series: {
    room_name: string | null
    start_time: string | null
    end_time: string | null
    meeting_time: string | null
    status: string | null
  }
  booking: ReminderBooking
  /** The owning body: who the booking is attributed to, whatever its scope. */
  body: {
    name: string
  }
  /** Every body the reminder is for, the owner among them (issue #212). */
  audience: ReminderBody[]
}

/** A candidate resolved to the values that actually apply to that week. */
export interface ResolvedMeeting {
  weeklyBookingId: string
  date: string
  /**
   * Every channel this reminder posts to: one per body in the audience that has
   * a channel linked and reminders switched on. One entry for the ordinary
   * single-body booking, which is every booking but one today.
   */
  channelIds: string[]
  /** The owning body. Attribution, not necessarily who the reminder names. */
  bodyName: string
  scope: BookingScope
  division: Division | null
  /** The other bodies a multi booking is shared with, for the line that says so. */
  peerNames: string[]
  roomName: string | null
  startTime: string | null
  endTime: string | null
  /**
   * The time the meeting itself starts, already resolved (issue #126). This is
   * the only time the reminder prints; startTime and endTime stay on the shape
   * because the resolution below falls back to startTime and because a future
   * reminder may want to say what the room is held for.
   */
  meetingTime: string | null
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
  // Each body in the audience decides for itself: its own channel, its own
  // switch. The owner's settings used to gate the whole thing, which is the
  // wrong lever now that a divisional booking reminds bodies the owner does not
  // speak for -- a committee that has turned reminders off should not be posted
  // to, and should not silence its division either.
  const channelIds = [
    ...new Set(
      c.audience
        .filter(b => b.slack_reminders_enabled && b.slack_channel_id)
        .map(b => b.slack_channel_id as string)
    ),
  ]
  if (!channelIds.length) return null

  // A hidden booking is visible only to the people who can manage it, so
  // announcing it to a channel would disclose it to everyone in that channel.
  // `?? booking.hidden` is the inheritance: a visible series can hide one week.
  if (c.hidden ?? c.booking.hidden) return null

  const status = c.status ?? c.series.status
  if (!status || !REMINDED_STATUSES.has(status)) return null

  const startTime = c.start_time ?? c.series.start_time

  return {
    weeklyBookingId: c.weekly_booking_id,
    date: c.occurrence_date,
    channelIds,
    bodyName: c.body.name,
    scope: c.booking.scope,
    division: c.booking.division,
    peerNames: c.audience
      .filter(b => b.id !== c.booking.body_id)
      .map(b => b.name)
      .sort((a, b) => a.localeCompare(b)),
    roomName: c.room_name ?? c.series.room_name,
    startTime,
    endTime: c.end_time ?? c.series.end_time,
    // Same precedence as everything above it, with one extra level on the end:
    // a series that has never had a meeting time set falls back to the start
    // time this week resolved to, so the reminder reads exactly as it did
    // before the field existed (issue #126).
    meetingTime: resolveMeetingTime(c.meeting_time, c.series.meeting_time, startTime),
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

/** 'A', 'A and B', 'A, B and C'. */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Who the reminder says is meeting (issue #212).
 *
 * Naming the owner of a divisional booking announced to four other committees
 * in the division that a group they are not part of was meeting -- in channels
 * the reminder had no business being wrong in. scopedBodyName() is that rule,
 * shared with My Rooms and the corridor display so the name in Slack is the
 * name everywhere else (issue #218).
 */
function meetingName(m: ResolvedMeeting): string {
  return scopedBodyName(m, m.bodyName)
}

/**
 * The line that says who a shared booking is for, or null for an ordinary
 * single-body one.
 *
 * A reminder landing in a channel whose body did not make the booking has to
 * account for itself, and for a divisional booking this is also the only place
 * the owning body still gets named.
 */
function sharingLine(m: ResolvedMeeting): string | null {
  if (m.scope === 'divisional' && m.division) {
    return `A divisional booking by ${esc(m.bodyName)}, open to every body in ${esc(m.division)}.`
  }
  if (m.scope === 'multi' && m.peerNames.length) {
    return `A shared booking with ${listNames(m.peerNames.map(esc))}.`
  }
  return null
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
 *
 * A booking shared beyond one body closes with a line saying so (issue #212),
 * on every status including Cancelled: a channel being told a meeting is off
 * should still be told whose.
 */
export function formatReminder(m: ResolvedMeeting): string {
  const body = `*${esc(meetingName(m))}*`
  const sharing = sharingLine(m)
  const lines = (...rest: string[]) => [...rest, ...(sharing ? [sharing] : [])].join('\n')

  if (m.status === 'Cancelled') return lines(`${body} has no meeting tomorrow.`)

  const opening = `${body} meets tomorrow! Join us on ${formatDate(m.date)}.`

  if (m.status === 'Virtual') {
    return lines(opening, 'Check with your Chair/Director for virtual meeting information.')
  }

  // The meeting time alone, not the reservation window (issue #126). The window
  // is what Chambers holds the room for -- it usually opens before the meeting
  // does and runs past the end of it -- and printing it here told a channel to
  // turn up at a time nobody meant. Still labelled "Time", the colloquial
  // reading the issue asks for.
  const when = formatTime(m.meetingTime) ?? 'to be confirmed'
  const room = m.roomName ? esc(m.roomName) : 'not yet confirmed'

  const roomLabel = ALTERNATE_ROOM.has(m.status) ? '*Alternate* Room' : 'Room'
  const timeLabel = ALTERNATE_TIME.has(m.status) ? '*Alternate* Time' : 'Time'

  return lines(opening, `${roomLabel}: ${room}`, `${timeLabel}: ${when}`)
}
