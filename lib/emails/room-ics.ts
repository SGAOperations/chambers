import { buildCalendar, escapeIcs, icsUtcStamp } from './ics-core'
import { calendarStateOf, type RoomSession } from '../room-calendar'

/**
 * Calendar invites for room bookings (issue #69).
 *
 * Unlike a Space booking, which stores an instant, a room session stores a date
 * and a clock time in Boston local terms -- '2026-09-17' and '18:00:00'. Those
 * digits pair directly with TZID=America/New_York, so no conversion is wanted
 * here; doing one is how a booking ends up an hour out across a DST change.
 */

/** '2026-09-17' + '18:00:00' -> '20260917T180000'. */
function toIcsLocal(date: string, time: string): string {
  const [h, m] = time.split(':')
  return `${date.replace(/-/g, '')}T${h}${m}00`
}

/** 'YYYY-MM-DD' plus one day, on the calendar. */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/**
 * One VCALENDAR holding every session passed in.
 *
 * `sequence` is omitted for a first invite, which calendars read as 0.
 *
 * Outlook's METHOD:REQUEST handling only reads the first VEVENT of a file
 * (issue #184) -- a REQUEST is meant to describe one instance, not a bundle of
 * unrelated ones. roomIcsAttachments below is what puts a whole weekly series
 * on a calendar in one email without hitting that: it gives each session its
 * own single-VEVENT file rather than passing several sessions here.
 */
export function buildRoomIcs(
  method: 'REQUEST' | 'CANCEL',
  sessions: RoomSession[],
  sequence?: number
): Buffer {
  const stamp = icsUtcStamp()

  const blocks = sessions.map(s => {
    // A session ending at or before it starts runs past midnight -- 11:00 PM to
    // 12:00 AM is the common one -- so its end belongs to the next day.
    const endDate = s.endTime.slice(0, 5) <= s.startTime.slice(0, 5) ? nextDay(s.date) : s.date

    const lines = [
      'BEGIN:VEVENT',
      `UID:${s.uid}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${toIcsLocal(s.date, s.startTime)}`,
      `DTEND;TZID=America/New_York:${toIcsLocal(endDate, s.endTime)}`,
      `SUMMARY:${escapeIcs(s.summary)}`,
      `LOCATION:${escapeIcs(s.location)}`,
    ]

    if (method === 'CANCEL') {
      lines.push('STATUS:CANCELLED')
    } else {
      // Tentative rides on the event itself rather than on the wording, so
      // Outlook hatches it and it counts as busy-tentative.
      lines.push(calendarStateOf(s.status) === 'tentative' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED')
      lines.push(`DESCRIPTION:${escapeIcs(`${s.status} in Chambers. See My Rooms for the booking.`)}`)
    }

    if (sequence !== undefined) lines.push(`SEQUENCE:${sequence}`)
    lines.push('END:VEVENT')
    return lines
  })

  return buildCalendar(method, blocks)
}

/** A session's UID with the domain dropped, for a filename unique to it. */
function attachmentId(uid: string): string {
  return uid.replace(/@.*$/, '')
}

/**
 * The attachments an email carries for one audience's invite, ready to spread
 * into a Resend send. Every session shares the one sequence passed in, so a
 * calendar sees the additions and the removals of a single save as one
 * revision.
 *
 * Each session is its own single-VEVENT file rather than the request sessions
 * sharing one file and the cancel sessions another: Outlook only reads the
 * first VEVENT of a METHOD:REQUEST file (issue #184), so a weekly series'
 * later sessions never reached a calendar when they rode along in one file
 * with the first. Separate attachments in the same email still land in a
 * single message.
 */
export function roomIcsAttachments(
  plan: { request: RoomSession[]; cancel: RoomSession[] },
  sequence: number
): { filename: string; content: Buffer; contentType: string }[] {
  return [
    ...plan.request.map(s => ({
      filename: `booking-${attachmentId(s.uid)}.ics`,
      content: buildRoomIcs('REQUEST', [s], sequence),
      contentType: 'text/calendar; method=REQUEST',
    })),
    ...plan.cancel.map(s => ({
      filename: `cancel-${attachmentId(s.uid)}.ics`,
      content: buildRoomIcs('CANCEL', [s], sequence),
      contentType: 'text/calendar; method=CANCEL',
    })),
  ]
}
