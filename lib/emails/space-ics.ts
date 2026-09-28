/**
 * Calendar invites for SGA Space bookings.
 *
 * A one-off booking is one VEVENT of its own (issue #69). A recurring series
 * (issue #112) is a single VEVENT with an RRULE, not one VEVENT per week --
 * Outlook only auto-adds the first VEVENT of a METHOD:REQUEST file, so sending
 * one per week (even as separate attachments) only ever put the first week on
 * a calendar (issue #184). A week that has drifted from the series' pattern --
 * kept at its old time because the new pattern conflicted for it, moved to
 * another space on its own, or edited on its own through the ordinary one-off
 * booking screen -- rides along as a RECURRENCE-ID override VEVENT under the
 * same UID, exactly as Outlook itself does when an organizer reschedules one
 * occurrence of a recurring meeting.
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

/** One UID for a whole recurring series -- the master VEVENT and every RECURRENCE-ID override share it. */
export function seriesIcsUid(seriesId: string): string {
  return `series-${seriesId}@chambers.northeasternsga.com`
}

/**
 * One VCALENDAR holding every event passed in. Every caller here passes
 * exactly one -- a one-off booking's own invite or cancellation.
 *
 * `sequence` is omitted for a first invite, which calendars read as 0.
 *
 * Outlook's METHOD:REQUEST handling only reads the first VEVENT of a file
 * (issue #184) -- a REQUEST is meant to describe one instance, not a bundle of
 * unrelated ones. A series puts several weeks on a calendar in one email
 * through buildSpaceSeriesIcs below instead, which is one VEVENT with an
 * RRULE rather than several VEVENTs sharing a file.
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

/** One week of a series, as buildSpaceSeriesIcs needs it. */
export interface SeriesOccurrence {
  bookingId: string
  /**
   * The instant the series' pattern generates for this week -- this row's
   * `recurrence_id` column. Read, never computed here: a week that has already
   * been edited on its own may sit on a different day entirely, and this is the
   * only record of which generated occurrence it still replaces.
   */
  recurrenceId: string
  /** This week's actual start/end. Equal to recurrenceId's pattern slot unless the week has diverged. */
  startTime: string
  endTime: string
  /** Set only when this week sits in a space other than the series' own. */
  spaceName?: string
}

export interface SpaceSeriesIcsPlan {
  seriesId: string
  title: string
  spaceName: string
  frequency: 'weekly' | 'biweekly'
  /** The series' fixed first occurrence and its pattern's time of day, Boston wall-clock digits. */
  patternStart: string
  patternEnd: string
  /**
   * How many slots the RRULE spans, from the first occurrence through the
   * series' current end date. Counted before gaps are removed -- COUNT bounds
   * the raw recurrence set, and EXDATE is applied after (RFC 5545 §3.8.5.3) --
   * so this is simply every pattern date from the start through the end date,
   * whether or not a row exists for it.
   */
  count: number
  /**
   * Pattern dates with no booking row at all -- skipped at creation or an
   * extension -- each already at the pattern's time of day, as intervalFor(gap
   * date, pattern start, pattern end).start would produce.
   */
  gaps: string[]
  /** Every upcoming week, on-pattern or diverged alike. */
  occurrences: SeriesOccurrence[]
}

/**
 * One VCALENDAR holding a whole series: a master VEVENT carrying the RRULE,
 * plus one RECURRENCE-ID override VEVENT for each week whose own time, end
 * time or space does not match what the pattern would generate for it. A week
 * that matches needs nothing of its own -- the master's RRULE already puts it
 * on the calendar.
 */
export function buildSpaceSeriesIcs(plan: SpaceSeriesIcsPlan, sequence?: number): Buffer {
  const stamp = icsUtcStamp()
  const uid = seriesIcsUid(plan.seriesId)
  const interval = plan.frequency === 'biweekly' ? 2 : 1
  const patternDurationMs = Date.parse(plan.patternEnd) - Date.parse(plan.patternStart)

  const master: string[] = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/New_York:${toIcsLocal(plan.patternStart)}`,
    `DTEND;TZID=America/New_York:${toIcsLocal(plan.patternEnd)}`,
    `RRULE:FREQ=WEEKLY;INTERVAL=${interval};COUNT=${plan.count}`,
    ...plan.gaps.map(g => `EXDATE;TZID=America/New_York:${toIcsLocal(g)}`),
    `SUMMARY:${escapeIcs(plan.title)}`,
    `LOCATION:${escapeIcs(plan.spaceName)}`,
    'DESCRIPTION:SGA Space booking confirmed via Chambers.',
  ]
  if (sequence !== undefined) master.push(`SEQUENCE:${sequence}`)
  master.push('END:VEVENT')

  const blocks: string[][] = [master]

  for (const o of plan.occurrences) {
    const expectedEndMs = Date.parse(o.recurrenceId) + patternDurationMs
    const onPattern =
      !o.spaceName &&
      Date.parse(o.startTime) === Date.parse(o.recurrenceId) &&
      Date.parse(o.endTime) === expectedEndMs
    if (onPattern) continue

    const lines: string[] = [
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `RECURRENCE-ID;TZID=America/New_York:${toIcsLocal(o.recurrenceId)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${toIcsLocal(o.startTime)}`,
      `DTEND;TZID=America/New_York:${toIcsLocal(o.endTime)}`,
      `SUMMARY:${escapeIcs(plan.title)}`,
      `LOCATION:${escapeIcs(o.spaceName ?? plan.spaceName)}`,
      'DESCRIPTION:SGA Space booking confirmed via Chambers.',
    ]
    if (sequence !== undefined) lines.push(`SEQUENCE:${sequence}`)
    lines.push('END:VEVENT')
    blocks.push(lines)
  }

  return buildCalendar('REQUEST', blocks)
}

/**
 * Cancels an entire series in one VEVENT: no RRULE and no RECURRENCE-ID are
 * needed to cancel by UID alone, matching how buildSpaceIcs cancels a one-off
 * booking. Used both to end a series outright and to take one person off all
 * of it -- the same VEVENT, addressed to fewer people.
 */
export function buildSpaceSeriesCancelIcs(seriesId: string, sequence: number): Buffer {
  const stamp = icsUtcStamp()
  const lines = [
    'BEGIN:VEVENT',
    `UID:${seriesIcsUid(seriesId)}`,
    `DTSTAMP:${stamp}`,
    'STATUS:CANCELLED',
    `SEQUENCE:${sequence}`,
    'END:VEVENT',
  ]
  return buildCalendar('CANCEL', [lines])
}

/** One week of a series, addressed by the series' UID rather than its own. */
export interface SeriesOccurrenceEvent {
  seriesId: string
  /** The instant the series' pattern generates for this week -- read from the row's recurrence_id, never computed. */
  recurrenceId: string
  title: string
  spaceName: string
  startTime: string
  endTime: string
}

/**
 * One RECURRENCE-ID VEVENT for a single week of a series, for the ordinary
 * one-off booking screen (issue #184): editing or cancelling one week there
 * has always used the same UID the week's own invite carries, so the calendar
 * updates the right event instead of creating an unrelated one. Now that a
 * series' own UID belongs to its master event, that week's UID is the series'
 * -- with a RECURRENCE-ID naming which occurrence it is -- rather than one of
 * its own.
 */
export function buildSeriesOccurrenceIcs(
  method: 'REQUEST' | 'CANCEL',
  event: SeriesOccurrenceEvent,
  sequence: number
): Buffer {
  const stamp = icsUtcStamp()
  const lines: string[] = [
    'BEGIN:VEVENT',
    `UID:${seriesIcsUid(event.seriesId)}`,
    `RECURRENCE-ID;TZID=America/New_York:${toIcsLocal(event.recurrenceId)}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/New_York:${toIcsLocal(event.startTime)}`,
    `DTEND;TZID=America/New_York:${toIcsLocal(event.endTime)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `LOCATION:${escapeIcs(event.spaceName)}`,
  ]
  if (method === 'CANCEL') {
    lines.push('STATUS:CANCELLED')
  } else {
    lines.push('DESCRIPTION:SGA Space booking confirmed via Chambers.')
  }
  lines.push(`SEQUENCE:${sequence}`)
  lines.push('END:VEVENT')
  return buildCalendar(method, [lines])
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
