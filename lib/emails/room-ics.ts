import { buildCalendar, escapeIcs, icsUtcStamp } from './ics-core'
import { calendarStateOf, weeklySeriesUid, type InvitePlan, type RoomSeries, type RoomSession } from '../room-calendar'

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

/** 'YYYY-MM-DD' plus `days`, on the calendar. */
function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' plus one day, on the calendar. */
function nextDay(date: string): string {
  return addDays(date, 1)
}

/**
 * A session ending at or before it starts runs past midnight -- 11:00 PM to
 * 12:00 AM is the common one -- so its end belongs to the next day.
 */
function endDateFor(date: string, startTime: string, endTime: string): string {
  return endTime.slice(0, 5) <= startTime.slice(0, 5) ? nextDay(date) : date
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
    const endDate = endDateFor(s.date, s.startTime, s.endTime)

    const lines = [
      'BEGIN:VEVENT',
      `UID:${s.seriesRef ? weeklySeriesUid(s.seriesRef.id) : s.uid}`,
      // One week of a series is an occurrence of the recurring event, not an
      // event of its own, so it is named by the slot it fills.
      ...(s.seriesRef
        ? [`RECURRENCE-ID;TZID=America/New_York:${toIcsLocal(s.date, s.seriesRef.startTime)}`]
        : []),
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

/** Every date the weekly pattern generates, from the series' start through its end. */
function patternDates(startDate: string, endDate: string): string[] {
  const dates: string[] = []
  for (let d = startDate; d <= endDate; d = addDays(d, 7)) dates.push(d)
  return dates
}

/** STATUS for a session or series, as its booking status translates. */
function statusLine(status: string): string {
  return calendarStateOf(status) === 'tentative' ? 'STATUS:TENTATIVE' : 'STATUS:CONFIRMED'
}

function descriptionLine(status: string): string {
  return `DESCRIPTION:${escapeIcs(`${status} in Chambers. See My Rooms for the booking.`)}`
}

/** Whether a week matches what the series' pattern would generate for it, and so needs no override. */
function onPattern(s: RoomSession, series: RoomSeries): boolean {
  return (
    s.startTime.slice(0, 5) === series.startTime.slice(0, 5) &&
    s.endTime.slice(0, 5) === series.endTime.slice(0, 5) &&
    s.location === series.location &&
    s.summary === series.summary &&
    calendarStateOf(s.status) === calendarStateOf(series.status)
  )
}

/**
 * One VCALENDAR holding a whole weekly series: a master VEVENT carrying the
 * RRULE, plus one RECURRENCE-ID override VEVENT per week whose room, time,
 * purpose or status does not match what the pattern would generate for it.
 *
 * This is what actually puts a series on a calendar (issue #184). Outlook only
 * auto-adds the first VEVENT of a METHOD:REQUEST file, and only the first .ics
 * attachment of an email -- so neither one file per week nor one attachment per
 * week ever got past week one. One recurring event does, because accepting it
 * once is what Outlook already understands a recurring meeting to be.
 *
 * Removals need nothing of their own. A week that stopped being a meeting is
 * EXDATEd out of the pattern, and weeks trimmed off the end simply fall outside
 * COUNT -- both of which take the occurrence off a calendar that holds it, the
 * same way Outlook's own "delete this occurrence" does.
 *
 * `series.meetingDates` spans the series' whole run, not just its future, so a
 * past week that happened keeps its place -- both its place in the pattern and,
 * if it drifted, its override. EXDATEing it, or letting the pattern put it back
 * at the series' room and time, would rewrite the record of what happened.
 */
export function buildRoomSeriesIcs(
  series: RoomSeries,
  sequence: number
): Buffer {
  const stamp = icsUtcStamp()
  const uid = weeklySeriesUid(series.id)
  const dates = patternDates(series.startDate, series.endDate)
  const meeting = new Set(series.meetingDates.map(d => d.date))
  const skipped = dates.filter(d => !meeting.has(d))

  const master = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    `DTSTART;TZID=America/New_York:${toIcsLocal(series.startDate, series.startTime)}`,
    `DTEND;TZID=America/New_York:${toIcsLocal(endDateFor(series.startDate, series.startTime, series.endTime), series.endTime)}`,
    `RRULE:FREQ=WEEKLY;INTERVAL=1;COUNT=${dates.length}`,
    ...skipped.map(d => `EXDATE;TZID=America/New_York:${toIcsLocal(d, series.startTime)}`),
    `SUMMARY:${escapeIcs(series.summary)}`,
    `LOCATION:${escapeIcs(series.location)}`,
    statusLine(series.status),
    descriptionLine(series.status),
    `SEQUENCE:${sequence}`,
    'END:VEVENT',
  ]

  const blocks = [master]

  for (const { date, session: s } of series.meetingDates) {
    if (onPattern(s, series)) continue
    blocks.push([
      'BEGIN:VEVENT',
      `UID:${uid}`,
      // Derived, not stored: a weekly edit cannot move an occurrence's date, so
      // the week's own date is always the pattern slot it fills.
      `RECURRENCE-ID;TZID=America/New_York:${toIcsLocal(date, series.startTime)}`,
      `DTSTAMP:${stamp}`,
      `DTSTART;TZID=America/New_York:${toIcsLocal(s.date, s.startTime)}`,
      `DTEND;TZID=America/New_York:${toIcsLocal(endDateFor(s.date, s.startTime, s.endTime), s.endTime)}`,
      `SUMMARY:${escapeIcs(s.summary)}`,
      `LOCATION:${escapeIcs(s.location)}`,
      statusLine(s.status),
      descriptionLine(s.status),
      `SEQUENCE:${sequence}`,
      'END:VEVENT',
    ])
  }

  return buildCalendar('REQUEST', blocks)
}

/**
 * Cancels an entire weekly series in one VEVENT: no RRULE and no RECURRENCE-ID
 * are needed to cancel by UID alone, matching how a one-off session is
 * cancelled. Used when nothing of the series is a meeting any more.
 */
export function buildRoomSeriesCancelIcs(seriesId: string, sequence: number): Buffer {
  return buildCalendar('CANCEL', [[
    'BEGIN:VEVENT',
    `UID:${weeklySeriesUid(seriesId)}`,
    `DTSTAMP:${icsUtcStamp()}`,
    'STATUS:CANCELLED',
    `SEQUENCE:${sequence}`,
    'END:VEVENT',
  ]])
}

/**
 * The attachments an email carries for one audience's invite, ready to spread
 * into a Resend send. Every session shares the one sequence passed in, so a
 * calendar sees the additions and the removals of a single save as one
 * revision.
 *
 * A weekly series is one recurring event, built by buildRoomSeriesIcs above --
 * one file, one VEVENT, every week. Its `cancel` list needs no attachment of
 * its own: the master's EXDATEs and COUNT already take those weeks off a
 * calendar, and a second file cancelling them by their old per-week UIDs would
 * describe events the recurrence no longer owns.
 *
 * Everything else is a one-time booking, whose sessions are unrelated dates
 * with no pattern between them, so each is its own single-VEVENT file. Note
 * Outlook auto-adds only the *first* attachment of an email, so a one-time
 * booking covering several dates still needs the later files imported by hand
 * -- there is no recurrence to express them as, and that is the remaining edge
 * of issue #184.
 */
export function roomIcsAttachments(
  plan: InvitePlan,
  sequence: number
): { filename: string; content: Buffer; contentType: string }[] {
  if (plan.series) {
    const { series } = plan
    // Nothing left of the series is a meeting -- past weeks included -- so the
    // whole recurrence comes off rather than being resent as an all-EXDATE
    // pattern with no occurrences in it.
    if (!series.meetingDates.length) {
      return [{
        filename: 'cancel.ics',
        content: buildRoomSeriesCancelIcs(series.id, sequence),
        contentType: 'text/calendar; method=CANCEL',
      }]
    }
    return [{
      filename: 'booking.ics',
      content: buildRoomSeriesIcs(series, sequence),
      contentType: 'text/calendar; method=REQUEST',
    }]
  }

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
