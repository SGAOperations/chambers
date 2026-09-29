import { resolveMeetingTime } from '@/lib/meeting-time'

/**
 * What the committee display shows, and how it works out which way to point
 * (issue #187).
 *
 * Kept apart from the route and the page so the rules -- which meetings count,
 * how an occurrence resolves against its series, which way the room is -- can be
 * read and exercised without a database or a browser.
 */

/**
 * The statuses the display draws, matching the allow-list Slack reminders use
 * (lib/meeting-reminders.ts).
 *
 * An allow-list rather than a block-list: Waitlisted, Tentative, Pending
 * Cancellation, Unavailable, Missed, Repurposed and anything added later say
 * nothing plain about whether or where the committee is meeting, and a screen
 * in a corridor is the wrong place to be equivocal.
 *
 * Cancelled is included deliberately. Someone walking to a meeting that is not
 * happening is exactly who this screen exists to catch, so it is drawn -- called
 * out as cancelled, and without a direction to walk in.
 */
const DISPLAYED_STATUSES = new Set([
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
  'Virtual',
  'Cancelled',
])

/** A meeting moved online has no room to point at. */
export function isVirtual(status: string): boolean {
  return status === 'Virtual'
}

export function isCancelled(status: string): boolean {
  return status === 'Cancelled'
}

/**
 * The floor a room is on, read off its number.
 *
 * Rooms here are written free-hand -- 'Curry 318', 'Curry Student Center - 333'
 * -- but they are numbered the way the building is, so the hundreds digit of a
 * three-digit number is the floor. That is the only structured thing about a
 * room name in this system: there is no rooms table, no floor column, and
 * nothing else to derive wayfinding from.
 *
 * Deliberately narrow. A name with no three-digit number in it (the Crossroads,
 * a virtual meeting, 'Room to be confirmed') returns null and the display simply
 * does not point anywhere, which is the right answer rather than a guess.
 */
export function floorOf(roomName: string | null | undefined): number | null {
  if (!roomName) return null
  const match = roomName.match(/\b([1-9])\d{2}\b/)
  return match ? Number(match[1]) : null
}

/** Which way someone standing at the display has to travel to reach the room. */
export type Direction = 'up' | 'down' | 'same-floor'

/**
 * Which way to point, given where the screen is hanging.
 *
 * `viewerFloor` comes from the display's own URL, so one page can serve a screen
 * on any floor. Without it -- and for a room whose floor cannot be read -- there
 * is no direction to give, and the display falls back to naming the room.
 */
export function directionTo(
  roomName: string | null | undefined,
  viewerFloor: number | null
): Direction | null {
  const floor = floorOf(roomName)
  if (floor === null || viewerFloor === null) return null
  if (floor > viewerFloor) return 'up'
  if (floor < viewerFloor) return 'down'
  return 'same-floor'
}

/** '3' -> '3rd'. */
export function ordinalFloor(floor: number): string {
  const suffix = floor === 1 ? 'st' : floor === 2 ? 'nd' : floor === 3 ? 'rd' : 'th'
  return `${floor}${suffix}`
}

/** One committee meeting, as the display draws it. */
export interface CommitteeMeeting {
  id: string
  bodyName: string
  /** What the meeting is for, when the booking says. */
  purpose: string | null
  roomName: string | null
  /** 'HH:MM:SS', Boston local, as the booking tables store it. */
  startTime: string
  endTime: string
  /** When people should actually arrive, which can be later than the reservation (issue #126). */
  meetingTime: string
  status: string
}

/** A weekly occurrence with its series and body attached, as the route selects it. */
export interface WeeklyCandidate {
  id: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  meeting_time: string | null
  status: string | null
  hidden: boolean | null
  purpose: string | null
  series: {
    room_name: string | null
    start_time: string
    end_time: string
    meeting_time: string | null
    status: string | null
  }
  booking: {
    hidden: boolean | null
    purpose: string | null
    bodyName: string
  }
}

/**
 * Resolves one week against its series, or returns null when it should not be
 * drawn.
 *
 * A null occurrence column inherits -- from the series for room, times and
 * status, and from the booking above it for visibility and purpose. That
 * precedence is the one My Rooms, the update emails and the Slack reminders all
 * apply.
 */
export function resolveWeekly(c: WeeklyCandidate): CommitteeMeeting | null {
  // A hidden booking is visible only to those who can manage it, and this screen
  // hangs in a corridor. `?? booking.hidden` is the inheritance: a visible series
  // can hide one week, and a hidden one can expose one.
  if (c.hidden ?? c.booking.hidden) return null

  const status = c.status ?? c.series.status
  if (!status || !DISPLAYED_STATUSES.has(status)) return null

  const startTime = c.start_time ?? c.series.start_time
  const endTime = c.end_time ?? c.series.end_time

  return {
    id: c.id,
    bodyName: c.booking.bodyName,
    purpose: c.purpose ?? c.booking.purpose,
    roomName: c.room_name ?? c.series.room_name,
    startTime,
    endTime,
    meetingTime: resolveMeetingTime(c.meeting_time, c.series.meeting_time, startTime),
    status,
  }
}

/** A one-off committee booking, which has no series to inherit from. */
export interface OneTimeCandidate {
  id: string
  room_name: string | null
  start_time: string
  end_time: string
  meeting_time: string | null
  status: string | null
  booking: {
    hidden: boolean | null
    purpose: string | null
    bodyName: string
  }
}

export function resolveOneTime(c: OneTimeCandidate): CommitteeMeeting | null {
  if (c.booking.hidden) return null
  if (!c.status || !DISPLAYED_STATUSES.has(c.status)) return null

  return {
    id: c.id,
    bodyName: c.booking.bodyName,
    purpose: c.booking.purpose,
    roomName: c.room_name,
    startTime: c.start_time,
    endTime: c.end_time,
    meetingTime: resolveMeetingTime(c.meeting_time, c.start_time),
    status: c.status,
  }
}

/**
 * Splits the day's meetings around a moment.
 *
 * `nowHm` is 'HH:MM' in Boston. Times compare as strings because the booking
 * tables store a plain clock time against a plain date -- there is no instant to
 * reconstruct, and reconstructing one is how a booking ends up an hour out
 * across a DST change.
 *
 * A meeting is ongoing from its reservation start, not its meeting time: the
 * room is occupied for the whole window, which is what someone reading the door
 * needs to know. A cancelled one is never ongoing -- nothing is happening in
 * there -- but it stays in the upcoming list until its slot passes, so anyone
 * walking over still learns it is off.
 */
export function splitByTime(
  meetings: CommitteeMeeting[],
  nowHm: string
): { ongoing: CommitteeMeeting[]; upcoming: CommitteeMeeting[] } {
  const hm = (t: string) => t.slice(0, 5)
  const ongoing: CommitteeMeeting[] = []
  const upcoming: CommitteeMeeting[] = []

  for (const m of meetings) {
    if (hm(m.startTime) > nowHm) upcoming.push(m)
    else if (hm(m.endTime) > nowHm && !isCancelled(m.status)) ongoing.push(m)
  }

  const byStart = (a: CommitteeMeeting, b: CommitteeMeeting) => a.startTime.localeCompare(b.startTime)
  return { ongoing: ongoing.sort(byStart), upcoming: upcoming.sort(byStart) }
}
