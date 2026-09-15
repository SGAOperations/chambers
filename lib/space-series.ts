import { advanceNoticeError, type BookingInterval } from './spaces-advance-notice'
import { bostonWallClockNow } from './boston-time'

/**
 * Recurring weekly SGA Space bookings (issue #112).
 *
 * A series is a pattern -- a space, a weekday, a time of day, a date range --
 * and every week of it is an ordinary space_bookings row carrying series_id.
 * Keeping the weeks real means the calendar, the room display, overlap and
 * blackout checks, the blackout cascade and the weekly hours limit all go on
 * working without knowing series exist, and a single week can still be edited
 * or cancelled on its own exactly as before.
 *
 * Space times are Boston wall-clock digits stored with a Z (see
 * lib/boston-time.ts), which is what makes "the same time next week" plain
 * arithmetic here: adding seven UTC days to 18:00Z is 18:00Z, whichever side of
 * a DST change the week lands on.
 *
 * Everything in this file is pure so the rules can be read and exercised without
 * a database. The routes gather the rows; this decides what they mean.
 */

/** Hours a person may hold per Sun-Sat week when they have no override. */
export const DEFAULT_WEEKLY_HOURS = 18

export function minutesOf(iso: string): number {
  return new Date(iso).getUTCMinutes()
}

/**
 * Whether a booking starts or ends in the 12am-7am window the CSC is closed.
 * One that ends exactly at midnight the following day is allowed.
 */
export function touchesDeadZone(startIso: string, endIso: string): boolean {
  const startDate = startIso.slice(0, 10)
  const endDate = endIso.slice(0, 10)
  if (endDate > startDate) {
    const end = new Date(endIso)
    const endsAtMidnight = end.getUTCHours() === 0 && end.getUTCMinutes() === 0 && end.getUTCSeconds() === 0
    const isConsecutiveDay = endDate === addDays(startDate, 1)
    if (!endsAtMidnight || !isConsecutiveDay) return true
  }
  const start = new Date(startIso)
  return start.getUTCHours() + start.getUTCMinutes() / 60 < 7
}

/** The Sunday 00:00 and following Sunday 00:00 bounding the week `iso` falls in. */
export function weekBoundsOf(iso: string): { weekStart: string; weekEnd: string } {
  const d = new Date(iso)
  const sun = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - d.getUTCDay()))
  const next = new Date(sun)
  next.setUTCDate(sun.getUTCDate() + 7)
  return { weekStart: sun.toISOString(), weekEnd: next.toISOString() }
}

/** 'YYYY-MM-DD' plus `days`, on the calendar. */
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/**
 * The interval a week of a series occupies. An end time of 00:00 means the end
 * of that day, as it does in the booking modal, so it lands on the next date.
 */
export function intervalFor(date: string, startTime: string, endTime: string): BookingInterval {
  const start = new Date(`${date}T${startTime.slice(0, 5)}:00Z`)
  const end = new Date(`${date}T${endTime.slice(0, 5)}:00Z`)
  if (endTime.slice(0, 5) === '00:00') end.setUTCDate(end.getUTCDate() + 1)
  return { start: start.toISOString(), end: end.toISOString() }
}

/** 'HH:MM' of a stored space time. */
export function timeOfDay(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16)
}

/** Every date from `first` to `until` inclusive, a week apart. */
export function weeklyDates(first: string, until: string): string[] {
  const dates: string[] = []
  for (let d = first; d <= until; d = addDays(d, 7)) dates.push(d)
  return dates
}

/** The weekday name of a 'YYYY-MM-DD' date. */
export function weekdayOf(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' })
}

function overlaps(a: BookingInterval, b: { start_time: string; end_time: string }): boolean {
  return Date.parse(a.start) < Date.parse(b.end_time) && Date.parse(a.end) > Date.parse(b.start_time)
}

function durationMs(start: string, end: string): number {
  return Date.parse(end) - Date.parse(start)
}

export type SeriesConflictReason = 'booked' | 'blackout' | 'weekly_limit' | 'notice'

export const SERIES_CONFLICT_LABELS: Record<SeriesConflictReason, string> = {
  booked: 'Already booked',
  blackout: 'Blocked by a blackout',
  weekly_limit: 'Would go over the weekly hours limit',
  notice: 'Inside the advance notice window',
}

export interface SeriesConflict {
  date: string
  reason: SeriesConflictReason
}

/** One week a series wants to create or move. */
export interface PlannedWeek {
  date: string
  interval: BookingInterval
  /**
   * The existing row this week replaces, when editing a series. Its current
   * interval is what advance notice measures newly claimed time against, and
   * its own hours are not counted twice against the weekly limit.
   */
  existing?: { id: string; start_time: string; end_time: string }
}

interface StoredBooking {
  id: string
  start_time: string
  end_time: string
}

export interface PlanInput {
  weeks: PlannedWeek[]
  /** Bookings in the same space that the weeks must not overlap. */
  spaceBookings: StoredBooking[]
  /** Blackouts on this space or on every space. */
  blackouts: { start_time: string; end_time: string }[]
  /** Every booking the series' creator holds across the range, in any space. */
  creatorBookings: StoredBooking[]
  limitHours: number
  minHoursAdvance: number
  now?: number
}

/**
 * Splits the weeks into those that can go ahead and those that conflict, with
 * the reason for each.
 *
 * Weeks are taken in date order, and each accepted week counts toward its own
 * Sun-Sat total before the next is considered -- so a series is measured
 * against every week it lands in, not only the first, and a 2-hour weekly
 * meeting uses 2 hours of each of those weeks.
 *
 * A week an edit leaves exactly where it was is accepted without checks. It
 * claims nothing new, and a rename should not fail because a blackout was later
 * drawn over time the booking already held.
 */
export function planSeries(input: PlanInput): { ok: PlannedWeek[]; conflicts: SeriesConflict[] } {
  const now = input.now ?? bostonWallClockNow().getTime()
  const limitMs = input.limitHours * 60 * 60 * 1000

  const ok: PlannedWeek[] = []
  const conflicts: SeriesConflict[] = []

  const sorted = [...input.weeks].sort((a, b) => a.interval.start.localeCompare(b.interval.start))

  for (const week of sorted) {
    const { interval, existing } = week

    if (
      existing &&
      Date.parse(existing.start_time) === Date.parse(interval.start) &&
      Date.parse(existing.end_time) === Date.parse(interval.end)
    ) {
      ok.push(week)
      continue
    }

    const prev = existing ? { start: existing.start_time, end: existing.end_time } : null
    if (advanceNoticeError(interval, prev, input.minHoursAdvance, now)) {
      conflicts.push({ date: week.date, reason: 'notice' })
      continue
    }

    if (input.blackouts.some(b => overlaps(interval, b))) {
      conflicts.push({ date: week.date, reason: 'blackout' })
      continue
    }

    // Only this week's own row is set aside. Another week of the same series is
    // seven days away and cannot overlap it -- and one that conflicts keeps its
    // current time, so it must still count as occupying that time.
    const isOwnRow = (b: StoredBooking) => b.id === existing?.id

    if (input.spaceBookings.some(b => !isOwnRow(b) && overlaps(interval, b))) {
      conflicts.push({ date: week.date, reason: 'booked' })
      continue
    }

    // Parsed rather than compared as strings: PostgREST returns '+00:00' where
    // toISOString writes '.000Z', and the two do not sort alike at the boundary.
    const { weekStart, weekEnd } = weekBoundsOf(interval.start)
    const inWeek = (b: { start_time: string; end_time: string }) =>
      Date.parse(b.start_time) < Date.parse(weekEnd) && Date.parse(b.end_time) > Date.parse(weekStart)

    // The row this week replaces drops out, so moving a week is not charged for
    // both its old and new time. Weeks this plan has already accepted count at
    // their new interval, which only matters for a booking that runs to midnight
    // on a Saturday and so touches two Sun-Sat weeks.
    const usedMs =
      input.creatorBookings
        .filter(b => !isOwnRow(b) && inWeek(b))
        .filter(b => !ok.some(w => w.existing?.id === b.id))
        .reduce((acc, b) => acc + durationMs(b.start_time, b.end_time), 0) +
      ok
        .filter(w => inWeek({ start_time: w.interval.start, end_time: w.interval.end }))
        .reduce((acc, w) => acc + durationMs(w.interval.start, w.interval.end), 0)

    if (usedMs + durationMs(interval.start, interval.end) > limitMs) {
      conflicts.push({ date: week.date, reason: 'weekly_limit' })
      continue
    }

    ok.push(week)
  }

  return { ok, conflicts }
}
