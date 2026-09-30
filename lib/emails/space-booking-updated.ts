import { emailFrom, resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { buildSeriesOccurrenceIcs, buildSpaceIcs, formatSpaceDateTime as formatDateTime, icsSequenceNow } from './space-ics'

/** What a booking says, before or after an edit. */
export interface SpaceBookingDetails {
  title: string
  spaceName: string
  startTime: string // ISO timestamptz
  endTime: string   // ISO timestamptz
}

interface SpaceBookingUpdatedParams {
  bookingId: string
  booking: SpaceBookingDetails
  /** The booking before the edit. Each field that differs is shown beside its new value. */
  previous: SpaceBookingDetails
  recipients: string[]
  /** Said instead of the default intro -- e.g. to someone just added to the booking. */
  intro?: string
  /**
   * Set when this row is one week of a series (issue #184). Its calendar is
   * the series' master event now, not one of its own, so the invite has to
   * override that one occurrence rather than stand alone.
   */
  series?: { seriesId: string; recurrenceId: string }
}

/**
 * An edited SGA Space booking, with an invite that moves the event on every
 * calendar it is already on.
 *
 * A one-off booking's invite keeps its own UID and carries a higher SEQUENCE,
 * which is what makes a calendar replace the event rather than add a second
 * one. One week of a series moves the same way, but as a RECURRENCE-ID
 * override under the series' UID (issue #184) -- the master event, not this
 * row, is what put it on a calendar in the first place.
 */
export async function sendSpaceBookingUpdatedEmail(params: SpaceBookingUpdatedParams) {
  const { bookingId, booking, previous, recipients, intro, series } = params
  if (!recipients.length) return

  const opening = intro ?? 'Your SGA Space booking has been updated.'

  // "(was …)" beside each value the edit changed, so nobody has to compare two
  // emails to see what moved.
  const rows: { label: string; value: string; was: string | null }[] = [
    { label: 'Booking Title', value: sanitize(booking.title), was: booking.title !== previous.title ? sanitize(previous.title) : null },
    { label: 'Space', value: booking.spaceName, was: booking.spaceName !== previous.spaceName ? previous.spaceName : null },
    { label: 'Start', value: formatDateTime(booking.startTime), was: sameInstant(booking.startTime, previous.startTime) ? null : formatDateTime(previous.startTime) },
    { label: 'End', value: formatDateTime(booking.endTime), was: sameInstant(booking.endTime, previous.endTime) ? null : formatDateTime(previous.endTime) },
  ]

  await resend.emails.send({
    from: emailFrom(),
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject: `Chambers — SGA Space Booking Updated: ${sanitize(booking.title)}`,
    text: `${opening}

${rows.map(r => `${r.label}: ${r.value}${r.was ? ` (was ${r.was})` : ''}`).join('\n')}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">${opening}</p>
      <p style="margin:0;line-height:1.8;">
        ${rows.map(r => `<strong>${r.label}:</strong> ${r.value}${r.was ? ` <span style="color:#555;">(was ${r.was})</span>` : ''}`).join('<br>\n        ')}
      </p>
    `),
    attachments: [{
      filename: 'booking.ics',
      content: series
        ? buildSeriesOccurrenceIcs('REQUEST', {
            seriesId: series.seriesId,
            recurrenceId: series.recurrenceId,
            title: booking.title,
            spaceName: booking.spaceName,
            startTime: booking.startTime,
            endTime: booking.endTime,
          }, icsSequenceNow())
        : buildSpaceIcs('REQUEST', [{ bookingId, ...booking }], icsSequenceNow()),
      contentType: 'text/calendar; method=REQUEST',
    }],
  })
}

/** PostgREST writes '+00:00' where toISOString writes '.000Z', so compare instants, not strings. */
function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b)
}
