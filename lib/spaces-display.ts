/**
 * What the All Spaces card on the corridor display shows.
 *
 * Kept apart from the route and the page, like lib/committee-display.ts, so the
 * rules -- which order the spaces stand in, where a booking sits on the bar,
 * whether a space is free right now -- can be read and exercised without a
 * database or a browser.
 *
 * ## The time domain
 *
 * Space booking times are Boston wall-clock digits with a Z on the end: a 6 PM
 * booking is stored as T18:00:00.000Z whatever the offset is that month. That is
 * the convention lib/boston-time.ts documents and the whole SGA Spaces feature
 * is built on, so the minutes below are read with getUTCHours/getUTCMinutes and
 * never by asking a Date for its local fields.
 *
 * Nothing here compares a booking against a real instant. That is the trap of
 * issue #87 -- measuring these values against Date.now() made every booking look
 * four hours early through EDT -- and the reason `nowMinutes` is passed in as
 * minutes-since-midnight rather than as a Date.
 */

/**
 * The order the three spaces stand in, left to right, as given for this screen.
 *
 * By name, because `spaces` has no ordering column and adding one to serve a
 * single display would be the wrong place to put a fact about one wall. The
 * layout is fixed rather than alphabetical so the columns do not swap around
 * under a reader who has learned where to look -- which is the entire value of a
 * screen someone walks past twice a day.
 */
export const SPACE_DISPLAY_ORDER = ["President's Corner", 'Recess Corner', 'Conference Room']

/**
 * The window the bar covers, matching the per-space kiosk in
 * app/display/[spaceId]/page.tsx.
 *
 * 7 AM to midnight. Earlier than anything gets booked and later than anything
 * runs, so a day fits without the bar having to scroll or rescale.
 */
export const BAR_START_MINUTES = 7 * 60
export const BAR_END_MINUTES = 24 * 60
export const BAR_RANGE_MINUTES = BAR_END_MINUTES - BAR_START_MINUTES

export interface DisplayBooking {
  id: string
  title: string | null
  /** Naive-UTC ISO, per the note above. */
  start_time: string
  end_time: string
}

export interface DisplayBlackout {
  id: string
  start_time: string
  end_time: string
}

export interface DisplaySpace {
  id: string
  name: string
  capacity: number
  bookings: DisplayBooking[]
  blackouts: DisplayBlackout[]
}

/** Minutes since midnight for a naive-UTC ISO string. */
export function startMinutesOf(iso: string): number {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

/**
 * The same, for an end time, where midnight means the end of the day.
 *
 * A booking running to T00:00:00Z ends at the far edge of the bar, not at its
 * near edge. Reading it as 0 collapsed such a booking to nothing and left the
 * space looking free for the hour it was actually in use -- the same class of
 * bug splitByTime carries a note about in lib/committee-display.ts.
 */
export function endMinutesOf(iso: string): number {
  const mins = startMinutesOf(iso)
  return mins === 0 ? BAR_END_MINUTES : mins
}

export type SegmentKind = 'booking' | 'blackout'

/** One block on a space's bar, already clamped to the visible window. */
export interface Segment {
  id: string
  kind: SegmentKind
  /** Null for a blackout, which has nothing to call itself. */
  title: string | null
  startMinutes: number
  endMinutes: number
  /** Offset and length along the bar, as percentages, ready to position with. */
  offsetPct: number
  lengthPct: number
}

function clampToBar(
  id: string,
  kind: SegmentKind,
  title: string | null,
  rawStart: number,
  rawEnd: number
): Segment | null {
  const startMinutes = Math.max(rawStart, BAR_START_MINUTES)
  const endMinutes = Math.min(rawEnd, BAR_END_MINUTES)

  // Entirely outside the window, or clamped down to nothing. A 6 AM blackout is
  // real but there is nowhere on this bar to draw it, and a zero-length block
  // would render as a hairline that reads as a rendering fault.
  if (endMinutes <= startMinutes) return null

  return {
    id,
    kind,
    title,
    startMinutes,
    endMinutes,
    offsetPct: ((startMinutes - BAR_START_MINUTES) / BAR_RANGE_MINUTES) * 100,
    lengthPct: ((endMinutes - startMinutes) / BAR_RANGE_MINUTES) * 100,
  }
}

/**
 * Every block to draw for one space, in start order.
 *
 * Drawing only -- occupancyAt reads the space directly, because these are
 * clamped to the bar and a clamped interval is the wrong thing to answer
 * questions about the room with.
 *
 * Blackouts come through as segments of their own rather than being subtracted
 * from the bookings: the two can overlap -- a blackout laid over an existing
 * booking is how a space gets closed at short notice -- and a reader is better
 * served seeing both than seeing a booking silently disappear.
 */
export function toSegments(space: DisplaySpace): Segment[] {
  const segments: Segment[] = []

  for (const b of space.bookings) {
    const seg = clampToBar(b.id, 'booking', b.title, startMinutesOf(b.start_time), endMinutesOf(b.end_time))
    if (seg) segments.push(seg)
  }

  for (const b of space.blackouts) {
    const seg = clampToBar(b.id, 'blackout', null, startMinutesOf(b.start_time), endMinutesOf(b.end_time))
    if (seg) segments.push(seg)
  }

  return segments.sort((a, b) => a.startMinutes - b.startMinutes)
}

/**
 * Three members rather than two with a shared `state`, so each narrows on its
 * own. `{ state: 'in-use' | 'closed' }` as one member does not: testing for
 * 'closed' cannot remove a member that might still be 'in-use', and the caller
 * is left unable to reach the free case's fields.
 */
export type Occupancy =
  | { state: 'free'; nextStartMinutes: number | null }
  | { state: 'in-use'; untilMinutes: number; title: string | null }
  | { state: 'closed'; untilMinutes: number; title: null }

/**
 * What a space is doing at `nowMinutes`.
 *
 * Deliberately computed from the space itself rather than from toSegments'
 * output. Those segments are clamped to the drawable window, and clamping is a
 * fact about the bar, not about the room: asked at 06:10 with a blackout
 * running 06:00-08:00, the clamped version answered "free until 7:00 AM" of a
 * space nobody could get into. Bookings cannot start before 07:00 --
 * touchesDeadZone in lib/space-series.ts refuses them -- but blackouts carry no
 * such rule, so the window and the truth genuinely come apart.
 *
 * A blackout outranks a booking: if the space is closed it does not matter who
 * had it booked, and saying "in use" of a room nobody can get into would send
 * someone to a locked door.
 *
 * `nextStartMinutes` is null when nothing further is scheduled, which the caller
 * has to render as "free for the rest of the day" rather than as a blank -- an
 * empty field beside a space name is indistinguishable from a failure to load.
 */
export function occupancyAt(space: DisplaySpace, nowMinutes: number): Occupancy {
  const intervals = [
    ...space.blackouts.map(b => ({
      kind: 'blackout' as const,
      title: null,
      start: startMinutesOf(b.start_time),
      end: endMinutesOf(b.end_time),
    })),
    ...space.bookings.map(b => ({
      kind: 'booking' as const,
      title: b.title,
      start: startMinutesOf(b.start_time),
      end: endMinutesOf(b.end_time),
    })),
  ]

  const active = intervals.filter(i => nowMinutes >= i.start && nowMinutes < i.end)

  const blackout = active.find(i => i.kind === 'blackout')
  if (blackout) return { state: 'closed', untilMinutes: blackout.end, title: null }

  const booking = active.find(i => i.kind === 'booking')
  if (booking) return { state: 'in-use', untilMinutes: booking.end, title: booking.title }

  const later = intervals.filter(i => i.start > nowMinutes)
  const nextStartMinutes = later.length
    ? later.reduce((min, i) => (i.start < min ? i.start : min), later[0].start)
    : null

  return { state: 'free', nextStartMinutes }
}

/**
 * The spaces in the order the screen wants them.
 *
 * A space missing from SPACE_DISPLAY_ORDER is appended rather than dropped, and
 * a name in the order that no space matches simply does not appear. Adding a
 * fourth space should put it on the board immediately -- at the end, where it is
 * obvious it needs placing -- rather than make it invisible until someone
 * remembers this file.
 */
export function orderSpaces(spaces: DisplaySpace[]): DisplaySpace[] {
  const rank = (name: string) => {
    const i = SPACE_DISPLAY_ORDER.indexOf(name)
    return i === -1 ? SPACE_DISPLAY_ORDER.length : i
  }
  return [...spaces].sort((a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name))
}

/** Minutes since midnight to '7:00 PM'. */
export function formatBarTime(minutes: number): string {
  const h = Math.floor(minutes / 60) % 24
  const m = minutes % 60
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}
