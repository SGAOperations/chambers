import { emailFrom, resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { buildSpaceIcs, formatSpaceDateTime as formatDateTime, icsSequenceNow } from './space-ics'

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
}

/**
 * An edited SGA Space booking, with an invite that moves the event on every
 * calendar it is already on.
 *
 * The invite keeps the booking's UID and carries a higher SEQUENCE, which is
 * what makes a calendar replace the event rather than add a second one. That
 * holds for one week of a series too: each week has the UID its booking row
 * gives it, so only that week moves.
 */
export async function sendSpaceBookingUpdatedEmail(params: SpaceBookingUpdatedParams) {
  const { bookingId, booking, previous, recipients, intro } = params
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
      content: buildSpaceIcs('REQUEST', [{ bookingId, ...booking }], icsSequenceNow()),
      contentType: 'text/calendar; method=REQUEST',
    }],
  })
}

/** PostgREST writes '+00:00' where toISOString writes '.000Z', so compare instants, not strings. */
function sameInstant(a: string, b: string): boolean {
  return Date.parse(a) === Date.parse(b)
}
