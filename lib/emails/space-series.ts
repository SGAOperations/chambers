import { emailFrom, resend } from '@/lib/resend'
import { sanitize, buildEmailHtml, escapeHtml } from './utils'
import {
  buildSpaceSeriesCancelIcs,
  buildSpaceSeriesIcs,
  formatSpaceShortDate,
  formatSpaceTime,
  icsSequenceNow,
  type SeriesOccurrence,
} from './space-ics'
import {
  SERIES_CADENCE,
  SERIES_CONFLICT_LABELS,
  weekdayOf,
  type SeriesConflict,
  type SeriesFrequency,
} from '@/lib/space-series'

/**
 * Emails for recurring SGA Space bookings (issue #112).
 *
 * One email per series action rather than one per week: a semester-long series
 * would otherwise land a dozen or more near-identical messages at once. The
 * calendar file is one VEVENT with an RRULE, not one VEVENT per week (issue
 * #184 -- Outlook only reads the first VEVENT of a file that holds several, so
 * a series sent that way never put its later weeks on a calendar). A week that
 * has drifted from the pattern rides along as a RECURRENCE-ID override under
 * the same UID; the routes are what decide which weeks those are and compute
 * each one's recurrenceId (see space-ics.ts).
 */

/** One week of a series, as the routes pass it in. */
export interface SeriesWeek {
  bookingId: string
  startTime: string
  endTime: string
  /** Set only for a week in a space other than the series' own. */
  spaceName?: string
  /**
   * The instant the series' pattern generates for this week -- this row's
   * recurrence_id column. Equal to startTime unless the week has diverged.
   */
  recurrenceId: string
}

interface SeriesBase {
  seriesId: string
  title: string
  spaceName: string
  /**
   * How often the series repeats (issue #173). Optional, defaulting to weekly,
   * so a caller that predates biweekly bookings still reads correctly.
   */
  frequency?: SeriesFrequency
}

/** 'weekly' | 'biweekly', however the caller left it. */
function cadenceOf(base: SeriesBase): SeriesFrequency {
  return base.frequency ?? 'weekly'
}

/** "Weekly" / "Biweekly", for the start of a subject line. */
function Cadence(base: SeriesBase): string {
  const word = SERIES_CADENCE[cadenceOf(base)].adjective
  return word.charAt(0).toUpperCase() + word.slice(1)
}

function toOccurrences(weeks: SeriesWeek[]): SeriesOccurrence[] {
  return weeks.map(w => ({
    bookingId: w.bookingId,
    recurrenceId: w.recurrenceId,
    startTime: w.startTime,
    endTime: w.endTime,
    spaceName: w.spaceName,
  }))
}

/**
 * "Every Tuesday, 6:00 PM – 7:00 PM" from the first week -- or "Every other
 * Tuesday" for a biweekly series, which is the only place the cadence is
 * visible in the body, since the dates below it are listed in full either way.
 */
function patternLine(base: SeriesBase, weeks: SeriesWeek[]): string {
  const first = weeks[0]
  const every = SERIES_CADENCE[cadenceOf(base)].every
  return `${every} ${weekdayOf(first.startTime.slice(0, 10))}, ${formatSpaceTime(first.startTime)} – ${formatSpaceTime(first.endTime)}`
}

/** A week whose time differs from the first is shown with its own time. */
function weekLabel(w: SeriesWeek, first: SeriesWeek): string {
  const sameTime =
    w.startTime.slice(11, 16) === first.startTime.slice(11, 16) &&
    w.endTime.slice(11, 16) === first.endTime.slice(11, 16)
  const date = formatSpaceShortDate(w.startTime)
  const label = sameTime ? date : `${date} (${formatSpaceTime(w.startTime)} – ${formatSpaceTime(w.endTime)})`
  return w.spaceName ? `${label} in ${w.spaceName}` : label
}

function conflictLines(conflicts: SeriesConflict[]): string[] {
  return conflicts.map(c => `${formatSpaceShortDate(c.date)} — ${SERIES_CONFLICT_LABELS[c.reason]}`)
}

/**
 * The body both the text and HTML versions are built from, so the two can never
 * say different things.
 */
function sections(
  intro: string,
  base: SeriesBase,
  groups: { heading: string; lines: string[] }[]
): { text: string; html: string } {
  const sTitle = sanitize(base.title)
  const visible = groups.filter(g => g.lines.length > 0)

  const text = [
    intro,
    '',
    `Booking Title: ${sTitle}`,
    `Space: ${base.spaceName}`,
    ...visible.flatMap(g => ['', `${g.heading}:`, ...g.lines.map(l => `  ${l}`)]),
    '',
    'If you have questions, please reach out to sgaOperations@northeastern.edu.',
  ].join('\n')

  const html = buildEmailHtml(`
      <p style="margin:0 0 16px;">${escapeHtml(intro)}</p>
      <p style="margin:0 0 16px;line-height:1.8;">
        <strong>Booking Title:</strong> ${escapeHtml(sTitle)}<br>
        <strong>Space:</strong> ${escapeHtml(base.spaceName)}
      </p>
      ${visible.map(g => `
      <p style="margin:0 0 4px;"><strong>${escapeHtml(g.heading)}</strong></p>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;">
        ${g.lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
      </ul>`).join('')}
    `)

  return { text, html }
}

export async function sendSpaceSeriesConfirmedEmail(params: SeriesBase & {
  /** The first occurrence's DTSTART/DTEND, Boston wall-clock digits. */
  patternStart: string
  patternEnd: string
  /** Every pattern slot from the first occurrence through the end date, gaps included (see SpaceSeriesIcsPlan.count). */
  count: number
  /** Skipped dates, each at the pattern's time of day. */
  gaps: string[]
  weeks: SeriesWeek[]
  skipped: SeriesConflict[]
  recipients: string[]
}) {
  const { weeks, skipped, recipients } = params
  if (!recipients.length || !weeks.length) return

  const { text, html } = sections(
    `Your ${SERIES_CADENCE[cadenceOf(params)].adjective} SGA Space booking has been confirmed.`,
    params,
    [
      { heading: patternLine(params, weeks), lines: weeks.map(w => weekLabel(w, weeks[0])) },
      { heading: 'Not booked', lines: conflictLines(skipped) },
    ]
  )

  await resend.emails.send({
    from: emailFrom(),
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject: `Chambers — ${Cadence(params)} SGA Space Booking Confirmed: ${sanitize(params.title)}`,
    text,
    html,
    attachments: [{
      filename: 'booking.ics',
      content: buildSpaceSeriesIcs({
        seriesId: params.seriesId,
        title: params.title,
        spaceName: params.spaceName,
        frequency: cadenceOf(params),
        patternStart: params.patternStart,
        patternEnd: params.patternEnd,
        count: params.count,
        gaps: params.gaps,
        occurrences: toOccurrences(weeks),
      }),
      contentType: 'text/calendar; method=REQUEST',
    }],
  })
}

export async function sendSpaceSeriesUpdatedEmail(params: SeriesBase & {
  /** The first occurrence's DTSTART/DTEND under the pattern as it now stands. */
  patternStart: string
  patternEnd: string
  /** Every pattern slot from the first occurrence through the (possibly new) end date, gaps included. */
  count: number
  /** Every date across the series' whole history with no row at all, at the current pattern's time of day. */
  gaps: string[]
  /** Every upcoming week as it now stands, on-pattern or kept at its own time alike. */
  weeks: SeriesWeek[]
  /** Weeks this edit removed by moving the end date earlier -- dropped by count alone; they need no attachment of their own. */
  removed: SeriesWeek[]
  /** Weeks that could not take the change, and so keep their previous time. */
  unchanged: SeriesConflict[]
  /** Weeks an extended end date could not add. */
  skipped: SeriesConflict[]
  recipients: string[]
}) {
  const { weeks, removed, unchanged, skipped, recipients } = params
  if (!recipients.length || (!weeks.length && !removed.length)) return

  const { text, html } = sections(
    `Your ${SERIES_CADENCE[cadenceOf(params)].adjective} SGA Space booking has been updated.`,
    params,
    [
      { heading: weeks.length ? patternLine(params, weeks) : 'Upcoming weeks', lines: weeks.map(w => weekLabel(w, weeks[0])) },
      { heading: 'Kept their previous time', lines: conflictLines(unchanged) },
      { heading: 'Removed', lines: removed.map(w => formatSpaceShortDate(w.startTime)) },
      { heading: 'Not added', lines: conflictLines(skipped) },
    ]
  )

  await resend.emails.send({
    from: emailFrom(),
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject: `Chambers — ${Cadence(params)} SGA Space Booking Updated: ${sanitize(params.title)}`,
    text,
    html,
    ...(weeks.length ? {
      attachments: [{
        filename: 'booking.ics',
        content: buildSpaceSeriesIcs({
          seriesId: params.seriesId,
          title: params.title,
          spaceName: params.spaceName,
          frequency: cadenceOf(params),
          patternStart: params.patternStart,
          patternEnd: params.patternEnd,
          count: params.count,
          gaps: params.gaps,
          occurrences: toOccurrences(weeks),
        }, icsSequenceNow()),
        contentType: 'text/calendar; method=REQUEST',
      }],
    } : {}),
  })
}

export async function sendSpaceSeriesCancelledEmail(params: SeriesBase & {
  weeks: SeriesWeek[]
  to: string[]
  bcc?: string[]
  /** Said instead of the default intro -- e.g. to an attendee removed from the series. */
  intro?: string
}) {
  const { weeks, to, bcc } = params
  if (!to.length || !weeks.length) return

  const { text, html } = sections(
    params.intro ?? `Your ${SERIES_CADENCE[cadenceOf(params)].adjective} SGA Space booking has been cancelled.`,
    params,
    [{ heading: 'Cancelled weeks', lines: weeks.map(w => weekLabel(w, weeks[0])) }]
  )

  await resend.emails.send({
    from: emailFrom(),
    to,
    ...(bcc?.length ? { bcc } : {}),
    subject: `Chambers — ${Cadence(params)} SGA Space Booking Cancelled: ${sanitize(params.title)}`,
    text,
    html,
    attachments: [{
      filename: 'cancel.ics',
      // Cancels the whole series by its master UID -- no need to name a week,
      // since ending the series or removing one person from all of it both
      // mean "take every occurrence off this calendar" (issue #184).
      content: buildSpaceSeriesCancelIcs(params.seriesId, icsSequenceNow()),
      contentType: 'text/calendar; method=CANCEL',
    }],
  })
}
