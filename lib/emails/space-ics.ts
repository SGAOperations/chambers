/**
 * Calendar invites for SGA Space bookings.
 *
 * Shared by the one-off and recurring emails (issue #112) so that a week of a
 * series and a one-off booking produce the same UID shape. That is what lets
 * cancelling a single week of a series -- which goes through the one-off
 * cancellation email -- remove exactly that week from a calendar that received
 * the whole series in one invite.
 *
 * The VCALENDAR around the events, the escaping and the SEQUENCE are shared with
 * room booking invites in ics-core (issue #69).
 */
import { buildCalendar, escapeIcs, icsUtcStamp } from './ics-core'

export { icsSequenceNow } from './ics-core'

export interface SpaceIcsEvent {
  bookingId: string
  title: string
  spaceName: string
  startTime: string // ISO, Boston wall-clock digits
  endTime: string   // ISO, Boston wall-clock digits
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

// Times are stored as UTC wall-clock (T18:15Z = 6:15 PM Eastern).
// Reading UTC fields gives the correct local-time digits to pair with TZID=America/New_York.
function toIcsLocal(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
}

export function spaceIcsUid(bookingId: string): string {
  return `${bookingId}@chambers.northeasternsga.com`
}

/**
 * One VCALENDAR holding every event. A series goes out as a single file with a
 * VEVENT per week, so one email puts the whole series on a calendar.
 *
 * `sequence` is omitted for a first invite, which calendars read as 0.
 */
export function buildSpaceIcs(
  method: 'REQUEST' | 'CANCEL',
  events: SpaceIcsEvent[],
  sequence?: number
): Buffer {
  const stamp = icsUtcStamp()

  const blocks: string[][] = []

  for (const e of events) {
    const lines: string[] = []
    lines.push(
      'BEGIN:VEVENT',
      `UID:${spaceIcsUid(e.bookingId)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${toIcsLocal(e.startTime)}`,
      `DTEND;TZID=America/New_York:${toIcsLocal(e.endTime)}`,
      `SUMMARY:${escapeIcs(e.title)}`,
      `LOCATION:${escapeIcs(e.spaceName)}`,
    )
    if (method === 'CANCEL') {
      lines.push('STATUS:CANCELLED')
    } else {
      lines.push('DESCRIPTION:SGA Space booking confirmed via Chambers.')
    }
    if (sequence !== undefined) lines.push(`SEQUENCE:${sequence}`)
    lines.push('END:VEVENT')
    blocks.push(lines)
  }

  return buildCalendar(method, blocks)
}

/** "Tuesday, September 16, 2026, 6:00 PM" from a stored space time. */
export function formatSpaceDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
}

/** "Tue, Sep 16" from a stored space time or a 'YYYY-MM-DD' date. */
export function formatSpaceShortDate(isoOrDate: string): string {
  const iso = isoOrDate.length === 10 ? `${isoOrDate}T12:00:00Z` : isoOrDate
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** "6:00 PM" from a stored space time. */
export function formatSpaceTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'UTC',
  })
}
