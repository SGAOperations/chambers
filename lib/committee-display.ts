import { resolveMeetingTime } from '@/lib/meeting-time'
import { scopedBodyName, type BookingScope, type Division } from '@/lib/booking-scope'

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
  // A trailing letter is part of the room, not a reason to give up: 'Suite 228B'
  // is on the second floor just as much as '228' would be.
  const match = roomName.match(/\b([1-9])\d{2}[A-Za-z]?\b/)
  return match ? Number(match[1]) : null
}

/** The room number itself, so a bearing can be looked up by it. */
function roomNumber(roomName: string | null | undefined): number | null {
  if (!roomName) return null
  const match = roomName.match(/\b([1-9]\d{2})[A-Za-z]?\b/)
  return match ? Number(match[1]) : null
}

/**
 * The building the screen hangs in, and the only one it will point inside.
 *
 * A room number says nothing about its building: 'Egan 306' and 'Curry 336' are
 * the same digit, and bookings in Snell, Egan, Ryder and Blackman are a quarter
 * of the day's meetings. Without this, a meeting across campus drew a confident
 * arrow up Curry's stairs.
 */
const DISPLAY_BUILDING = 'curry'

export function isInDisplayBuilding(roomName: string | null | undefined): boolean {
  const name = roomName?.trim().toLowerCase()
  if (!name) return false
  // 'Suite 228B' is booked without its building, but the suites are Curry's --
  // there is no other 'Suite' in the booking tables.
  return name.startsWith(DISPLAY_BUILDING) || name.startsWith('suite')
}

/** Which way someone standing at the display has to travel to reach the room. */
export type Bearing = 'up' | 'down' | 'left' | 'right' | 'up-left' | 'up-right'

export interface Wayfinding {
  bearing: Bearing
  /** Replaces the computed wording when the bearing alone would mislead. */
  note?: string
  /**
   * The room is in another building, so the arrow means "leave and walk", not
   * "take the stairs".
   *
   * The display draws these differently -- a double chevron, and wording that
   * does not say "Upstairs" of a building across campus -- and it cannot work
   * that out from the bearing alone, because 'up' is the same glyph either way.
   */
  offBuilding?: boolean
  /**
   * The room is in this building but not on this floor.
   *
   * Resolved from the room number against DISPLAY_FLOOR, so a new fourth-floor
   * room needs no thought. Set explicitly only where there is no number to read
   * it from, which is every entry in NAMED_BEARINGS.
   *
   * The display draws one chevron for these, against a plain arrow for the
   * floor you are standing on and two for another building. That is the whole
   * scale: how far the arrow is asking you to go.
   */
  offFloor?: boolean
}

/**
 * Which way the screen points for each room.
 *
 * There is one screen -- in the SGA office, facing the hallway -- so these are
 * absolute, given by the people who sit there, not derived. 'left' means left as
 * you stand in the hallway reading it. A floor number cannot produce any of
 * this: which way to turn on the floor you are already on depends entirely on
 * where the screen hangs, and 333 is behind the reader despite being on it.
 *
 * Keyed by room number so the free-text name can vary ('Curry 333', 'Curry 333
 * (Senate Chambers)') without needing an entry each.
 */
/**
 * The floor the screen itself hangs on.
 *
 * Everything on it gets a plain arrow: 333 is behind you and 334 to your left,
 * and neither is a journey. A room off this floor gets a chevron instead, which
 * is what makes the bare arrow mean "you are already here".
 */
const DISPLAY_FLOOR = 3

const ROOM_BEARINGS: Record<number, Wayfinding> = {
  333: { bearing: 'down', note: 'Right behind you' },
  334: { bearing: 'left' },
  335: { bearing: 'left' },
  336: { bearing: 'left' },
  340: { bearing: 'left' },
  342: { bearing: 'left' },
  344: { bearing: 'left' },
  346: { bearing: 'left' },
  348: { bearing: 'left' },
  433: { bearing: 'up-right' },
  435: { bearing: 'up-left' },
}

/** Rooms named rather than numbered, matched on the name. */
const NAMED_BEARINGS: [RegExp, Wayfinding][] = [
  [/indoor quad/i, { bearing: 'down', offFloor: true }],
  [/2nd floor/i, { bearing: 'down', offFloor: true }],
]

/**
 * Everything on a floor, for rooms with no bearing of their own.
 *
 * The second-floor suites are down from here whichever one is meant, so the
 * floor answers for all of them.
 */
const FLOOR_BEARINGS: Record<number, Wayfinding> = {
  2: { bearing: 'down' },
}

/**
 * Fills in offFloor from the room number, leaving an explicit one alone.
 *
 * Derived rather than tabulated so adding a fourth-floor room is one line in
 * ROOM_BEARINGS and not two facts to keep in step. A room with no number in it
 * has nothing to derive from, and keeps whatever its table entry said.
 */
function withFloor(found: Wayfinding, roomName: string): Wayfinding {
  if (found.offFloor !== undefined) return found
  const floor = floorOf(roomName)
  if (floor === null) return found
  return { ...found, offFloor: floor !== DISPLAY_FLOOR }
}

/**
 * Which way each other building lies from the screen.
 *
 * Given for this screen, exactly as ROOM_BEARINGS is: nothing in the booking
 * tables says which way Snell is from a hallway in Curry, and a room number
 * says less than nothing, since 'Egan 306' and 'Curry 336' share a digit.
 *
 * Keyed on the first word of the room name, which is how these are written --
 * 'Snell 001', 'Egan 206', 'Krentzman Quad', 'West Village Quad', 'Centennial
 * Common', 'Blackman Auditorium', 'Ryder 145'. A first word not listed here
 * gets no arrow, which is the same silence an unrecognised Curry room gets:
 * 'No Room' is in the data too, and it is not a place.
 */
const BUILDING_BEARINGS: Record<string, Bearing> = {
  snell: 'up-left',
  egan: 'up-left',
  krentzman: 'right',
  blackman: 'right',
  ryder: 'up',
  west: 'up',
  centennial: 'up',
}

/** The first word of a room name, lowercased, or null if there isn't one. */
function buildingWord(roomName: string | null | undefined): string | null {
  const word = roomName?.trim().split(/\s+/)[0]?.toLowerCase()
  return word || null
}

/**
 * Which way to point for a room outside this building, or null when the
 * building is not one we have been given a direction for.
 */
function directionToBuilding(roomName: string | null | undefined): Wayfinding | null {
  const word = buildingWord(roomName)
  if (!word) return null
  const bearing = BUILDING_BEARINGS[word]
  return bearing ? { bearing, offBuilding: true } : null
}

/**
 * Which way to point, or null to name the room and point nowhere.
 *
 * Null for a room this screen has no direction for -- a building missing from
 * BUILDING_BEARINGS, or a room in this one that nothing above recognises. A
 * corridor screen that points the wrong way is worse than one that names the
 * room and stops, so an unknown room gets silence rather than a guess from its
 * floor.
 */
export function directionTo(roomName: string | null | undefined): Wayfinding | null {
  // Another building is now answerable rather than silent, where we have been
  // given its direction.
  if (!isInDisplayBuilding(roomName)) return directionToBuilding(roomName)

  for (const [pattern, found] of NAMED_BEARINGS) {
    if (pattern.test(roomName!)) return withFloor(found, roomName!)
  }

  const number = roomNumber(roomName)
  if (number !== null && ROOM_BEARINGS[number]) {
    return withFloor(ROOM_BEARINGS[number], roomName!)
  }

  const floor = floorOf(roomName)
  if (floor !== null && FLOOR_BEARINGS[floor]) {
    return withFloor(FLOOR_BEARINGS[floor], roomName!)
  }

  return null
}

/** '3' -> '3rd'. */
export function ordinalFloor(floor: number): string {
  const suffix = floor === 1 ? 'st' : floor === 2 ? 'nd' : floor === 3 ? 'rd' : 'th'
  return `${floor}${suffix}`
}

/** One committee meeting or event, as the display draws it. */
export interface CommitteeMeeting {
  id: string
  /** 'YYYY-MM-DD'. The board can be showing a day other than today. */
  date: string
  /**
   * Who the board says is meeting -- already resolved through scopedBodyName(),
   * so a divisional booking reads as its division and not as the body that
   * filed it (issue #218).
   */
  bodyName: string
  /** An IEMS event rather than an ordinary meeting, badged as such. */
  isEvent: boolean
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
  date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  meeting_time: string | null
  status: string | null
  hidden: boolean | null
  purpose: string | null
  /** Authoritative per occurrence, inheriting nothing from the series. */
  is_event: boolean | null
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
    /** The owning body. Attribution, not necessarily who the board names. */
    bodyName: string
    scope: BookingScope
    division: Division | null
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
    date: c.date,
    bodyName: scopedBodyName(c.booking, c.booking.bodyName),
    isEvent: c.is_event ?? false,
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
  date: string
  room_name: string | null
  start_time: string
  end_time: string
  meeting_time: string | null
  status: string | null
  booking: {
    hidden: boolean | null
    purpose: string | null
    /** The owning body. Attribution, not necessarily who the board names. */
    bodyName: string
    scope: BookingScope
    division: Division | null
    /** On the booking for a one-off, unlike weekly's per-occurrence flag. */
    isEvent: boolean
  }
}

export function resolveOneTime(c: OneTimeCandidate): CommitteeMeeting | null {
  if (c.booking.hidden) return null
  if (!c.status || !DISPLAYED_STATUSES.has(c.status)) return null

  return {
    id: c.id,
    date: c.date,
    bodyName: scopedBodyName(c.booking, c.booking.bodyName),
    isEvent: c.booking.isEvent,
    purpose: c.booking.purpose,
    roomName: c.room_name,
    startTime: c.start_time,
    endTime: c.end_time,
    meetingTime: resolveMeetingTime(c.meeting_time, c.start_time),
    status: c.status,
  }
}

/**
 * When a booking ends, in minutes from the start of the day it began on.
 *
 * An end at or before the start is the clock having gone round: 23:00-00:00 is
 * an hour long, not minus twenty-three of them. Comparing the raw strings made
 * such a booking look finished from the instant its day began -- an 11pm meeting
 * ending at midnight was invisible for the whole hour it was actually running.
 *
 * Minutes rather than a Date: the booking tables hold a plain clock time against
 * a plain date, and building an instant out of them is how a meeting ends up an
 * hour out across a DST change. This is still only clock arithmetic.
 */
function endMinutesOf(m: { startTime: string; endTime: string }): number {
  const start = minutesOf(m.startTime)
  const end = minutesOf(m.endTime)
  return end <= start ? end + MINUTES_IN_DAY : end
}

/**
 * Splits the day's meetings around a moment.
 *
 * `nowHm` is 'HH:MM' in Boston.
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
  const now = minutesOf(nowHm)
  const ongoing: CommitteeMeeting[] = []
  const upcoming: CommitteeMeeting[] = []

  for (const m of meetings) {
    if (now >= endMinutesOf(m)) continue
    // Past its start but nothing is happening in there, so it is not ongoing --
    // it stays listed until its slot ends, which is the whole point of drawing a
    // cancellation. Someone arriving mid-slot is exactly who needs to be told.
    if (isCancelled(m.status) || minutesOf(m.startTime) > now) upcoming.push(m)
    else ongoing.push(m)
  }

  const byStart = (a: CommitteeMeeting, b: CommitteeMeeting) => a.startTime.localeCompare(b.startTime)
  return { ongoing: ongoing.sort(byStart), upcoming: upcoming.sort(byStart) }
}

/**
 * How long before a meeting starts that pointing at it becomes useful.
 *
 * Long enough to get up and walk there, short enough that the arrow still means
 * "now" rather than "at some point".
 */
export const ARROW_LEAD_MINUTES = 30

const MINUTES_IN_DAY = 24 * 60

function minutesOf(hm: string): number {
  return Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5))
}

/**
 * Whether the screen should point at this meeting, as opposed to merely saying
 * where it is.
 *
 * An arrow is an instruction to walk, so it has to be wrong to follow it at any
 * other time. A meeting tomorrow, or at four this afternoon, is not somewhere to
 * go now -- the board still names the room and the floor, it just stops
 * gesturing. Cancelled never points: there is nothing at the other end of it.
 */
export function shouldPointAt(
  meeting: CommitteeMeeting,
  daysAhead: number,
  nowHm: string
): boolean {
  if (daysAhead !== 0) return false
  if (isCancelled(meeting.status) || isVirtual(meeting.status)) return false

  const now = minutesOf(nowHm)
  if (now >= endMinutesOf(meeting)) return false
  // Negative once it has started, which is the ongoing case.
  return minutesOf(meeting.startTime) - now <= ARROW_LEAD_MINUTES
}

/** What the board is currently showing, and which day it belongs to. */
export interface Board {
  /** 'YYYY-MM-DD' of the day on screen, which is not always today. */
  date: string
  /** 0 for today, 1 for tomorrow, and so on. */
  daysAhead: number
  ongoing: CommitteeMeeting[]
  upcoming: CommitteeMeeting[]
}

/** Whole days between two 'YYYY-MM-DD' dates, read as dates rather than instants. */
function daysBetween(from: string, to: string): number {
  const at = (d: string) => Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10))
  return Math.round((at(to) - at(from)) / 86_400_000)
}

/**
 * Picks the day to show: today while anything is left of it, otherwise the next
 * day that has something.
 *
 * A wall screen is never blank on purpose. "Nothing left today" is true but
 * useless to someone reading it at nine in the evening, and it looks
 * indistinguishable from a broken display -- so once today is spent the board
 * rolls forward to whatever is next, however far off that is. Only a genuinely
 * empty lookahead returns null, and the caller has to say so in as many words.
 *
 * A future day has nothing in progress by definition, so everything on it is
 * upcoming no matter what the clock says.
 */
export function selectBoard(
  meetings: CommitteeMeeting[],
  today: string,
  nowHm: string
): Board | null {
  const todayLeft = splitByTime(meetings.filter(m => m.date === today), nowHm)
  if (todayLeft.ongoing.length || todayLeft.upcoming.length) {
    return { date: today, daysAhead: 0, ...todayLeft }
  }

  const later = meetings.filter(m => m.date > today)
  if (!later.length) return null

  const nextDate = later.reduce((a, m) => (m.date < a ? m.date : a), later[0].date)
  const onThatDay = later
    .filter(m => m.date === nextDate)
    .sort((a, b) => a.startTime.localeCompare(b.startTime))

  return { date: nextDate, daysAhead: daysBetween(today, nextDate), ongoing: [], upcoming: onThatDay }
}
