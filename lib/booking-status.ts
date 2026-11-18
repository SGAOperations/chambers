/**
 * Every rule about a booking's status, in one place (issue #280).
 *
 * A room booking, weekly occurrence or tabling session carries one `status`, and
 * it answers two questions at once: whether the body is meeting, and what
 * happened to the room. Epic #279 splits it in two. Before the schema moves,
 * every list of statuses and every rule that reads one lives here, so the split
 * is a change to this file rather than to the fifteen places that used to keep
 * their own copy.
 *
 * Pure and dependency-free: it is imported by client components (the booking
 * forms, My Rooms, the glossary) as well as by server code, so nothing here may
 * reach for the database or a server-only module.
 *
 * The colour maps hold whole Tailwind class strings, never assembled ones, so
 * Tailwind's source scan still finds every class.
 */

/**
 * Every status a row can hold, in the order the forms list them. Matches the
 * status CHECK constraints on one_time_room_bookings, weekly_room_bookings,
 * weekly_room_occurrences and tabling_sessions in db/neon/0001_baseline.sql;
 * tests/booking-status.test.ts fails if the two drift.
 *
 * Every map below is checked against this list with `satisfies`, so adding a
 * status fails the build until it has colours and a definition (issue #228).
 * The maps stay typed by string because callers index them with a row's raw,
 * unvalidated status.
 */
export const BOOKING_STATUSES = [
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
  'Waitlisted',
  'Unavailable',
  'Pending Cancellation',
  'Cancelled',
  'Virtual',
  'Missed',
  'Repurposed',
  'Tentative',
] as const
export type BookingStatus = typeof BOOKING_STATUSES[number]

/** What a new booking is, and what the forms and writers fall back to. */
export const DEFAULT_STATUS = 'Reserved' satisfies BookingStatus

/** What a cancellation request puts a booking on until it is settled. */
export const PENDING_CANCELLATION = 'Pending Cancellation' satisfies BookingStatus

/** What a status cell, pill, card or bar falls back to is the caller's choice. */
type StatusMap = Record<string, string>

// ─── The split (epic #279) ───────────────────────────────────────────────────
//
// `status` is being split into a meeting status the body owns, a virtual flag,
// and an ops status Operational Affairs owns (db/neon/0023_status_split.sql).
// Until the writers set them (#282) the database derives all three from
// `status`; nothing reads them yet (#284).

/** Whether and how the body is meeting. Matches the meeting_status CHECK constraints. */
export const MEETING_STATUSES = [
  'Scheduled',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
  'Cancelled',
  'Tentative',
] as const
export type MeetingStatus = typeof MEETING_STATUSES[number]

/** What Operational Affairs has done with the room. Matches the ops_status CHECK constraints. */
export const OPS_STATUSES = [
  'Reserved',
  'Tentative',
  'Waitlisted',
  'Unavailable',
  'Pending Cancellation',
  'Cancelled',
  'Missed',
  'Repurposed',
] as const
export type OpsStatus = typeof OPS_STATUSES[number]

export interface SplitStatus {
  /** Null where the meeting was never recorded (Unavailable, Missed, Repurposed). */
  meetingStatus: MeetingStatus | null
  /** Null only for a row with no status at all (an occurrence inheriting its series). */
  isVirtual: boolean | null
  opsStatus: OpsStatus | null
}

/**
 * The three new values one old status maps to: public.status_split_of() in
 * db/neon/0023_status_split.sql, in TypeScript. tests/status-split.test.ts
 * checks the two agree on every status.
 *
 * `requestType` is the cancellation_type of the request behind a Pending
 * Cancellation row; with none, it reads as a cancellation, the same default
 * Auto-Cancel applies. Going virtual keeps the meeting Scheduled and releases
 * the room, so a Virtual row's room is Cancelled.
 */
export function splitStatus(status: string | null | undefined, requestType?: string | null): SplitStatus {
  if (status == null) return { meetingStatus: null, isVirtual: null, opsStatus: null }
  switch (status) {
    case 'Reserved':
      return { meetingStatus: 'Scheduled', isVirtual: false, opsStatus: 'Reserved' }
    case 'Alternate Room':
    case 'Alternate Time':
    case 'Alternate Room and Time':
      return { meetingStatus: status, isVirtual: false, opsStatus: 'Reserved' }
    case 'Waitlisted':
      return { meetingStatus: 'Scheduled', isVirtual: false, opsStatus: 'Waitlisted' }
    case 'Tentative':
      return { meetingStatus: 'Tentative', isVirtual: false, opsStatus: 'Tentative' }
    case PENDING_CANCELLATION:
      return requestType === 'Virtual'
        ? { meetingStatus: 'Scheduled', isVirtual: true, opsStatus: PENDING_CANCELLATION }
        : { meetingStatus: 'Cancelled', isVirtual: false, opsStatus: PENDING_CANCELLATION }
    case 'Cancelled':
      return { meetingStatus: 'Cancelled', isVirtual: false, opsStatus: 'Cancelled' }
    case 'Virtual':
      return { meetingStatus: 'Scheduled', isVirtual: true, opsStatus: 'Cancelled' }
    case 'Unavailable':
    case 'Missed':
    case 'Repurposed':
      return { meetingStatus: null, isVirtual: false, opsStatus: status }
    default:
      // Not a status the CHECK constraint allows; the database would refuse it.
      return { meetingStatus: null, isVirtual: false, opsStatus: null }
  }
}

// ─── Occurrence inheritance ──────────────────────────────────────────────────

/**
 * The status one week of a weekly series actually has.
 *
 * A null on the occurrence means "inherit the series", and only null: the status
 * CHECK constraints reject an empty string, so there is no blank to tell apart
 * from it. Every reader that resolves a week -- My Rooms, the Bookings tab and
 * grid, Auto-Cancel, the Slack reminders, the committee display, the calendar
 * invites and the Sunday reminder -- goes through this one function.
 */
export function resolveOccurrenceStatus<S extends string | null | undefined>(
  occurrenceStatus: string | null | undefined,
  seriesStatus: S
): string | S {
  return occurrenceStatus ?? seriesStatus
}

// ─── Rules ───────────────────────────────────────────────────────────────────
//
// Each rule is an allow-list or a block-list on purpose, and which one matters.
// An allow-list (the meeting-is-on rules) says nothing for a status added later,
// which is the safe answer for anything that tells people where to go. A
// block-list (the cancellable and revisable rules) keeps offering an action for
// a status added later, which is the safe answer for anything that lets a body
// fix its own booking.

/**
 * The statuses that say plainly the body is meeting: the booking as made, as
 * moved, or moved online.
 */
const MEETING_ON = new Set<string>([
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
  'Virtual',
])

/** The meeting-is-on statuses that still hold a room: everything but Virtual. */
const HOLDS_ROOM = new Set<string>([
  'Reserved',
  'Alternate Room',
  'Alternate Time',
  'Alternate Room and Time',
])

const ALTERNATE_ROOM = new Set<string>(['Alternate Room', 'Alternate Room and Time'])
const ALTERNATE_TIME = new Set<string>(['Alternate Time', 'Alternate Room and Time'])

/** Statuses My Rooms and /chambers-cancel do not offer a cancellation for. */
const NOT_CANCELLABLE = new Set<string>([PENDING_CANCELLATION, 'Cancelled', 'Virtual'])

/** Statuses My Rooms does not offer a revision request for. */
const NOT_REVISABLE = new Set<string>(['Cancelled', 'Missed', 'Repurposed'])

/**
 * Whether a room is actually being held for the body, and so could be released:
 * the booking as made, or as moved. Read by the Sunday weekly-cancel reminder.
 *
 * Cancelled and Pending Cancellation are already on their way out, Virtual and
 * Unavailable hold no room, Waitlisted and Tentative are not yet held, and
 * Missed and Repurposed are settled. None of those is something to remind
 * anyone to cancel.
 */
export function holdsRoom(status: string | null | undefined): boolean {
  return !!status && HOLDS_ROOM.has(status)
}

/** What a status says about whether a session is on a calendar. */
export type CalendarState =
  /** On the calendar, as a meeting that is happening. */
  | 'confirmed'
  /** On the calendar, marked tentative -- Outlook hatches it. */
  | 'tentative'
  /** Not on the calendar; taken off if it was. */
  | 'off'
  /** Left exactly as it is, neither added nor removed. */
  | 'leave'

/**
 * What each status does to a calendar (issue #69).
 *
 *   Reserved, the alternates, Virtual
 *                         go on as confirmed. Virtual is included: the meeting
 *                         still happens, and its location says so.
 *   Tentative             goes on hatched: it is a real plan, not yet settled.
 *   Waitlisted            stays off until an administrator settles it, since
 *                         there is no room to go to yet.
 *   Pending Cancellation  leaves the calendar alone. The request has not been
 *                         decided, and removing the event now would mean putting
 *                         it back if the request is denied.
 *   Cancelled, Unavailable, Missed, Repurposed, and anything added later
 *                         come off: none of them is a meeting in that room.
 */
export function calendarStateOf(status: string | null | undefined): CalendarState {
  if (!status) return 'off'
  if (MEETING_ON.has(status)) return 'confirmed'
  if (status === 'Tentative') return 'tentative'
  if (status === PENDING_CANCELLATION) return 'leave'
  return 'off'
}

/**
 * Whether the day-before Slack reminder is written for this status (issue #104).
 *
 * The meeting-is-on statuses, plus Cancelled: a channel should hear that
 * tomorrow's meeting is off. Waitlisted, Tentative, Pending Cancellation,
 * Unavailable, Missed, Repurposed and anything added later post nothing, because
 * none of them says plainly whether or where the body is meeting.
 */
export function isReminded(status: string | null | undefined): boolean {
  return !!status && (MEETING_ON.has(status) || status === 'Cancelled')
}

/**
 * Whether the committee display draws this status (issue #187). The same rule as
 * the Slack reminder, and for the same reason: a screen in a corridor is the
 * wrong place to be equivocal. Cancelled is drawn deliberately -- someone
 * walking to a meeting that is not happening is exactly who the screen exists
 * to catch.
 */
export function isDisplayed(status: string | null | undefined): boolean {
  return isReminded(status)
}

/** Whether the meeting moved to a different room. */
export function hasAlternateRoom(status: string | null | undefined): boolean {
  return !!status && ALTERNATE_ROOM.has(status)
}

/** Whether the meeting moved to a different time. */
export function hasAlternateTime(status: string | null | undefined): boolean {
  return !!status && ALTERNATE_TIME.has(status)
}

/** A meeting that moved online: still happening, with no room to point at. */
export function isVirtual(status: string | null | undefined): boolean {
  return status === 'Virtual'
}

export function isCancelled(status: string | null | undefined): boolean {
  return status === 'Cancelled'
}

/**
 * Whether a body's leadership may ask to cancel this booking, from My Rooms or
 * /chambers-cancel. Not once a request is already open, and not once it is
 * already cancelled or online.
 */
export function isCancellable(status: string | null | undefined): boolean {
  return !NOT_CANCELLABLE.has(status as string)
}

/** Whether a body's leadership may ask for a revision to this booking. */
export function isRevisable(status: string | null | undefined): boolean {
  return !NOT_REVISABLE.has(status as string)
}

/**
 * Whether a NUSSO release has nothing left to do for this session: it already
 * landed on what a release lands on (lib/nusso/cancel-booking.ts).
 */
export function isNussoSettled(status: string | null | undefined): boolean {
  return status === 'Cancelled' || status === 'Virtual'
}

/**
 * Whether a weekly series is no longer a booking the body has, so the Call for
 * Programs does not offer to renew it.
 */
export function isGone(status: string | null | undefined): boolean {
  return status === 'Cancelled' || status === 'Unavailable'
}

// ─── Colours ─────────────────────────────────────────────────────────────────

/** My Rooms cards: a tinted fill and a border. */
export const statusCardClasses: StatusMap = {
  'Reserved': 'bg-[#0f3d20] border-[#22c55e]',
  'Alternate Room': 'bg-[#0e2f4f] border-[#4285f4]',
  'Alternate Time': 'bg-[#0e2f4f] border-[#4285f4]',
  'Alternate Room and Time': 'bg-[#0e2f4f] border-[#4285f4]',
  'Waitlisted': 'bg-[#3d0f0f] border-[#ef4444]',
  'Unavailable': 'bg-[#3d0f0f] border-[#ef4444]',
  'Pending Cancellation': 'bg-[#3d2200] border-[#f97316]',
  'Cancelled': 'bg-[#2a1042] border-[#a855f7]',
  'Virtual': 'bg-[#062f3b] border-[#06b6d4]',
  'Missed': 'bg-[#1a1a2e] border-[#a78bfa]',
  'Repurposed': 'bg-[#1a1a1a] border-white',
  'Tentative': 'bg-[#2d2800] border-[#fef08a]',
} satisfies Record<BookingStatus, string>

/** My Rooms list rows and calendar dots: a solid bar. */
export const statusBarClasses: StatusMap = {
  'Reserved': 'bg-[#22c55e]',
  'Alternate Room': 'bg-[#4285f4]',
  'Alternate Time': 'bg-[#4285f4]',
  'Alternate Room and Time': 'bg-[#4285f4]',
  'Waitlisted': 'bg-[#ef4444]',
  'Unavailable': 'bg-[#ef4444]',
  'Pending Cancellation': 'bg-[#f97316]',
  'Cancelled': 'bg-[#a855f7]',
  'Virtual': 'bg-[#06b6d4]',
  'Missed': 'bg-[#a78bfa]',
  'Repurposed': 'bg-white',
  'Tentative': 'bg-[#fef08a]',
} satisfies Record<BookingStatus, string>

/** The status label's own colour, wherever it is written as text. */
export const statusTextClasses: StatusMap = {
  'Reserved': 'text-[#4ade80]',
  'Alternate Room': 'text-[#4285f4]',
  'Alternate Time': 'text-[#4285f4]',
  'Alternate Room and Time': 'text-[#4285f4]',
  'Waitlisted': 'text-[#f87171]',
  'Unavailable': 'text-[#f87171]',
  'Pending Cancellation': 'text-[#fb923c]',
  'Cancelled': 'text-[#c084fc]',
  'Virtual': 'text-[#22d3ee]',
  'Missed': 'text-[#a78bfa]',
  'Repurposed': 'text-white',
  'Tentative': 'text-[#fef08a]',
} satisfies Record<BookingStatus, string>

/** Admin pills (Bookings, Audit, Archive): a tinted fill and coloured text. */
export const statusPillClasses: StatusMap = {
  'Reserved': 'bg-[#0f3d20] text-[#4ade80]',
  'Alternate Room': 'bg-[#0e2f4f] text-[#4285f4]',
  'Alternate Time': 'bg-[#0e2f4f] text-[#4285f4]',
  'Alternate Room and Time': 'bg-[#0e2f4f] text-[#4285f4]',
  'Waitlisted': 'bg-[#3d0f0f] text-[#f87171]',
  'Unavailable': 'bg-[#3d0f0f] text-[#f87171]',
  'Pending Cancellation': 'bg-[#3d2200] text-[#fb923c]',
  'Cancelled': 'bg-[#2a1042] text-[#c084fc]',
  'Virtual': 'bg-[#062f3b] text-[#22d3ee]',
  'Missed': 'bg-[#1a1a2e] text-[#a78bfa]',
  'Repurposed': 'bg-[#1a1a1a] text-white',
  'Tentative': 'bg-[#2d2800] text-[#fef08a]',
} satisfies Record<BookingStatus, string>

/** The weekly grid's cells, which are drawn with an inline hex, not a class. */
export const statusCellHex: StatusMap = {
  'Reserved': '#4ade80',
  'Alternate Room': '#4285f4',
  'Alternate Time': '#4285f4',
  'Alternate Room and Time': '#4285f4',
  'Waitlisted': '#f87171',
  'Unavailable': '#f87171',
  'Pending Cancellation': '#fb923c',
  'Cancelled': '#c084fc',
  'Virtual': '#22d3ee',
  'Missed': '#a78bfa',
  'Repurposed': '#ffffff',
  'Tentative': '#fef08a',
} satisfies Record<BookingStatus, string>

// ─── Glossary ────────────────────────────────────────────────────────────────

/**
 * What each status means to someone reading My Rooms, and what they should do
 * about it -- the copy behind the status glossary (issue #228).
 *
 * Written from what Chambers does with each status rather than from the label,
 * and so from the rules above: which ones still get a Slack reminder and a spot
 * on the calendar (isReminded, calendarStateOf), which are set by a cancellation
 * request or a NUSSO release, and which alert Operational Affairs (Missed). When
 * one of those rules changes, the sentence here describing it should change with
 * it; tests/booking-status.test.ts pins the ones that name a rule.
 */
export const STATUS_DEFINITIONS = {
  'Reserved': {
    meaning: 'The room is booked for your body at the date and time shown.',
    action: 'Nothing. Go to the room listed.',
  },
  'Alternate Room': {
    meaning: 'The meeting is on, at the usual time, but in a different room from usual.',
    action: 'Check the location before you go.',
  },
  'Alternate Time': {
    meaning: 'The meeting is on, in the usual room, but at a different time from usual.',
    action: 'Check the start time before you go.',
  },
  'Alternate Room and Time': {
    meaning: 'The meeting is on, but both the room and the time have changed.',
    action: 'Check the location and the start time before you go.',
  },
  'Waitlisted': {
    meaning: 'The room has been asked for but not confirmed. CSC has put the booking on its waitlist, so there is no room to go to yet.',
    action: "Don't count on the room until the status changes. No meeting reminder is posted in the meantime.",
  },
  'Unavailable': {
    meaning: 'The room could not be booked for this date. There is no room for this meeting.',
    action: "Ask your body's leadership whether you are meeting somewhere else.",
  },
  'Pending Cancellation': {
    meaning: "Your body's leadership has asked to cancel this booking or move it online, and Operational Affairs hasn't settled the request yet.",
    action: 'Nothing. It changes to Cancelled or Virtual once the request is settled.',
  },
  'Cancelled': {
    meaning: 'The meeting is not happening, and the room has been given up.',
    action: "Don't go.",
  },
  'Virtual': {
    meaning: 'The meeting is still happening, but online rather than in a room.',
    action: "Ask your body's leadership for the link.",
  },
  'Missed': {
    meaning: 'An administrator recorded that this reservation went unused. Operational Affairs is alerted automatically when this happens.',
    action: 'If you think it is a mistake, reach out to the Comptroller.',
  },
  'Repurposed': {
    meaning: "The reservation has been put to another use, so it is no longer your body's meeting in this room.",
    action: "Ask your body's leadership if you aren't sure where you are meeting.",
  },
  'Tentative': {
    meaning: 'The plan is real, but not confirmed yet, and it may still change.',
    action: 'Expect it to happen, but check back before you go.',
  },
} satisfies Record<BookingStatus, { meaning: string; action: string }>
