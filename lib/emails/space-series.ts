import { emailFrom, resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import {
  buildSpaceIcs,
  formatSpaceShortDate,
  formatSpaceTime,
  icsSequenceNow,
  type SpaceIcsEvent,
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
 * would otherwise land a dozen or more near-identical messages at once. Each
 * carries a single calendar file holding every affected week, and each week's
 * UID is the one its booking row would get on its own -- so cancelling one week
 * later, through the ordinary cancellation email, removes just that week.
 */

/** One week of a series, as the routes pass it in. */
export interface SeriesWeek {
  bookingId: string
  startTime: string
  endTime: string
  /** Set only for a week in a space other than the series' own. */
  spaceName?: string
}

interface SeriesBase {
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function toEvents(base: SeriesBase, weeks: SeriesWeek[]): SpaceIcsEvent[] {
  return weeks.map(w => ({
    bookingId: w.bookingId,
    title: base.title,
    spaceName: w.spaceName ?? base.spaceName,
    startTime: w.startTime,
    endTime: w.endTime,
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
      content: buildSpaceIcs('REQUEST', toEvents(params, weeks)),
      contentType: 'text/calendar; method=REQUEST',
    }],
  })
}

export async function sendSpaceSeriesUpdatedEmail(params: SeriesBase & {
  /** Every upcoming week as it now stands. */
  weeks: SeriesWeek[]
  /** Weeks this edit removed by moving the end date earlier. */
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

  // One sequence for both files, so a calendar sees the update and the removal
  // as the same revision.
  const sequence = icsSequenceNow()
  const attachments = []
  if (weeks.length) {
    attachments.push({
      filename: 'booking.ics',
      content: buildSpaceIcs('REQUEST', toEvents(params, weeks), sequence),
      contentType: 'text/calendar; method=REQUEST',
    })
  }
  if (removed.length) {
    attachments.push({
      filename: 'cancel.ics',
      content: buildSpaceIcs('CANCEL', toEvents(params, removed), sequence),
      contentType: 'text/calendar; method=CANCEL',
    })
  }

  await resend.emails.send({
    from: emailFrom(),
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject: `Chambers — ${Cadence(params)} SGA Space Booking Updated: ${sanitize(params.title)}`,
    text,
    html,
    attachments,
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
      content: buildSpaceIcs('CANCEL', toEvents(params, weeks), icsSequenceNow()),
      contentType: 'text/calendar; method=CANCEL',
    }],
  })
}
