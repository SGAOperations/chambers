/**
 * Calendar invites for SGA Space bookings.
 *
 * Shared by the one-off and recurring emails (issue #112) so that a week of a
 * series and a one-off booking produce the same UID shape. That is what lets
 * cancelling a single week of a series -- which goes through the one-off
 * cancellation email -- remove exactly that week from a calendar that received
 * the whole series in one invite.
 */

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

// DTSTAMP records when the ICS was generated — must be real UTC with Z.
function toIcsUtc(date: Date): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function spaceIcsUid(bookingId: string): string {
  return `${bookingId}@chambers.northeasternsga.com`
}

/**
 * A SEQUENCE that is always higher than any this app issued before.
 *
 * Calendars ignore an update or cancellation whose SEQUENCE is not above the
 * one they hold, and an event may be updated any number of times, so a fixed
 * value cannot work once series edits send updated invites. Whole seconds since
 * the epoch only ever increase and fit the 32-bit integer calendars expect.
 */
export function icsSequenceNow(): number {
  return Math.floor(Date.now() / 1000)
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
  const stamp = toIcsUtc(new Date())

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chambers//SGA Room Manager//EN',
    `METHOD:${method}`,
    // VTIMEZONE lets Outlook resolve the TZID on DTSTART/DTEND correctly.
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
    'END:STANDARD',
    'END:VTIMEZONE',
  ]

  for (const e of events) {
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
  }

  lines.push('END:VCALENDAR')
  return Buffer.from(lines.join('\r\n'))
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
