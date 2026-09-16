/**
 * The parts of an iCalendar file every Chambers invite shares (issue #69).
 *
 * SGA Spaces has sent invites since its confirmation email was written, and room
 * bookings now send them too. Both need the same VTIMEZONE block, the same
 * escaping and the same monotonic SEQUENCE, and two copies of that would drift.
 * What differs is where the times come from -- a Space stores an instant, a room
 * booking stores a date and a clock time -- so each builds its own VEVENT lines
 * and hands them here to be wrapped.
 */

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** DTSTAMP: when the file was generated, in real UTC. */
export function icsUtcStamp(date: Date = new Date()): string {
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
}

export function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

/**
 * A SEQUENCE that is always higher than any this app issued before.
 *
 * Calendars ignore an update or cancellation whose SEQUENCE is not above the one
 * they hold, and an event may be updated any number of times, so a fixed value
 * cannot work. Whole seconds since the epoch only ever increase and fit the
 * 32-bit integer calendars expect.
 */
export function icsSequenceNow(): number {
  return Math.floor(Date.now() / 1000)
}

/** Lets Outlook resolve the TZID on DTSTART/DTEND correctly. */
export const VTIMEZONE_LINES = [
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

/** One VCALENDAR holding every event, as the file a mail client attaches. */
export function buildCalendar(method: 'REQUEST' | 'CANCEL', events: string[][]): Buffer {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chambers//SGA Room Manager//EN',
    `METHOD:${method}`,
    ...VTIMEZONE_LINES,
    ...events.flat(),
    'END:VCALENDAR',
  ]
  return Buffer.from(lines.join('\r\n'))
}
