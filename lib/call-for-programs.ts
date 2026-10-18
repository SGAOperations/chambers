import { invalidWeeklyStartTime, WEEKLY_START_TIME_ERROR } from './request-times'

/**
 * The call for programs: before a semester's weekly rooms are booked,
 * Operational Affairs asks each body's leadership whether to keep last fall or
 * spring's weekly booking as it was, or move its room, its time, or both.
 *
 * Kept free of server imports, like lib/request-times.ts, so the form and the
 * route validate a submission with the same code. The database side is in
 * lib/call-for-programs-data.ts.
 */

export const CHANGE_TYPES = ['keep', 'room', 'time', 'both', 'new'] as const
export type ChangeType = (typeof CHANGE_TYPES)[number]

/** What each answer reads as, on the form and in the admin list. */
export const CHANGE_TYPE_LABELS: Record<ChangeType, string> = {
  keep: 'Keep everything the same',
  room: 'Change the room',
  time: 'Change the time',
  both: 'Change the room and the time',
  new: 'New weekly booking',
}

export const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] as const
export type Day = (typeof DAYS)[number]

export const SEMESTER_TERMS = ['Fall', 'Spring', 'Summer'] as const
export type SemesterTerm = (typeof SEMESTER_TERMS)[number]

export const MAX_ROOM = 200
export const MAX_COMMENTS = 2000

export function needsRoom(c: ChangeType): boolean {
  return c === 'room' || c === 'both' || c === 'new'
}

export function needsTime(c: ChangeType): boolean {
  return c === 'time' || c === 'both' || c === 'new'
}

export interface ProgramCall {
  id: string
  opened_at: string
  closes_at: string | null
  closed_at: string | null
}

/**
 * Open means not closed by hand and not past its automatic close. Worked out on
 * read rather than by a job that closes it, so the close happens on time
 * whether or not anything runs at that minute.
 */
export function isCallOpen(call: ProgramCall | null, now: Date = new Date()): boolean {
  if (!call || call.closed_at) return false
  return !call.closes_at || new Date(call.closes_at) > now
}

/** The weekly booking a body is answering about, as the form shows it. */
export interface PriorWeeklyBooking {
  weekly_booking_id: string
  semester_name: string
  purpose: string
  room_name: string
  day: Day
  start_time: string
  end_time: string
  start_date: string
  end_date: string
}

/** The day of the week a 'YYYY-MM-DD' falls on, at UTC noon so DST cannot move it. */
export function dayOfWeek(date: string): Day {
  const [y, m, d] = date.split('-').map(Number)
  const jsDay = new Date(Date.UTC(y, m - 1, d, 12)).getUTCDay()
  return DAYS[(jsDay + 6) % 7]
}

export interface SubmissionInput {
  change_type: ChangeType
  requested_room: string | null
  requested_capacity: number | null
  requested_day: Day | null
  requested_start_time: string | null
  requested_end_time: string | null
  time_is_range: boolean
  comments: string | null
}

function minutesOf(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return h * 60 + m
}

const TIME_PATTERN = /^\d{2}:\d{2}(:\d{2})?$/

/**
 * Checks a submission and returns it cleaned -- fields the chosen answer does
 * not ask for are dropped, so a room typed and then abandoned for "keep" is not
 * stored as if it were asked for.
 *
 * Whether the body has a prior booking to keep is the route's to check; this
 * only checks the answer is complete and well-formed.
 */
export function validateSubmission(raw: Record<string, unknown>):
  | { ok: true; value: SubmissionInput }
  | { ok: false; error: string } {
  const change = raw.change_type
  if (typeof change !== 'string' || !(CHANGE_TYPES as readonly string[]).includes(change)) {
    return { ok: false, error: 'Choose whether to keep the booking or change it.' }
  }
  const change_type = change as ChangeType

  const value: SubmissionInput = {
    change_type,
    requested_room: null,
    requested_capacity: null,
    requested_day: null,
    requested_start_time: null,
    requested_end_time: null,
    time_is_range: false,
    comments: null,
  }

  if (needsRoom(change_type)) {
    const room = typeof raw.requested_room === 'string' ? raw.requested_room.trim() : ''
    if (!room) return { ok: false, error: 'Say which room or type of room you want.' }
    if (room.length > MAX_ROOM) return { ok: false, error: `Keep the room to ${MAX_ROOM} characters.` }
    const n = Number(raw.requested_capacity)
    if (raw.requested_capacity === '' || raw.requested_capacity == null || !Number.isInteger(n) || n < 1 || n > 10000) {
      return { ok: false, error: 'Enter the capacity you need as a whole number of people.' }
    }
    value.requested_room = room
    value.requested_capacity = n
  }

  if (needsTime(change_type)) {
    const day = raw.requested_day
    if (typeof day !== 'string' || !(DAYS as readonly string[]).includes(day)) {
      return { ok: false, error: 'Choose the day of the week you want.' }
    }
    const start = raw.requested_start_time
    const end = raw.requested_end_time
    if (typeof start !== 'string' || !TIME_PATTERN.test(start) || typeof end !== 'string' || !TIME_PATTERN.test(end)) {
      return { ok: false, error: 'Enter a start and an end time.' }
    }
    if (invalidWeeklyStartTime(start)) return { ok: false, error: WEEKLY_START_TIME_ERROR }
    if (minutesOf(end) % 15 !== 0) return { ok: false, error: 'End times go in 15-minute steps.' }
    if (minutesOf(end) <= minutesOf(start)) return { ok: false, error: 'The end time must be after the start time.' }
    value.requested_day = day as Day
    value.requested_start_time = start.slice(0, 5)
    value.requested_end_time = end.slice(0, 5)
    value.time_is_range = raw.time_is_range === true
  }

  if (raw.comments != null && typeof raw.comments !== 'string') {
    return { ok: false, error: 'Comments must be text.' }
  }
  const comments = typeof raw.comments === 'string' ? raw.comments.trim() : ''
  if (comments.length > MAX_COMMENTS) {
    return { ok: false, error: `Keep comments to ${MAX_COMMENTS} characters.` }
  }
  value.comments = comments || null

  return { ok: true, value }
}

const CHAMBERS_URL = 'https://chambers.northeasternsga.com'

/** Boston wall-clock, for the Slack message and the admin list. */
export function formatCallTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/** The one message posted when a call opens. */
export function formatCallOpenedMessage(closesAt: string | null): string {
  const deadline = closesAt ? ` It closes ${formatCallTime(closesAt)}.` : ''
  return (
    `:mega: *The call for programs is open.*${deadline}\n` +
    `Body leadership: tell Operational Affairs whether to keep your weekly booking as it is or change its room or time. ` +
    `<${CHAMBERS_URL}/request?type=programs|Submit in Chambers>`
  )
}
