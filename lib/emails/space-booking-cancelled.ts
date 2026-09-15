import { emailFrom, resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { buildSpaceIcs, formatSpaceDateTime as formatDateTime, icsSequenceNow } from './space-ics'

interface SpaceBookingCancelledParams {
  bookingId: string
  title: string
  spaceName: string
  startTime: string // ISO timestamptz
  endTime: string   // ISO timestamptz
  /** Several when the creator chose both their personal and an SGA inbox (issue #109). */
  to: string[]
  bcc?: string[]
  /** Said instead of the default intro -- e.g. to an attendee removed from the booking. */
  intro?: string
}

export async function sendSpaceBookingCancelledEmail(params: SpaceBookingCancelledParams) {
  const { bookingId, title, spaceName, startTime, endTime, to, bcc, intro } = params
  if (!to.length) return

  const sTitle = sanitize(title)
  const opening = intro ?? 'Your SGA Space booking has been cancelled.'

  await resend.emails.send({
    from: emailFrom(),
    to,
    ...(bcc?.length ? { bcc } : {}),
    subject: `Chambers — SGA Space Booking Cancelled: ${sTitle}`,
    text: `${opening}

Booking Title: ${sTitle}
Space: ${spaceName}
Start: ${formatDateTime(startTime)}
End: ${formatDateTime(endTime)}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">${opening}</p>
      <p style="margin:0;line-height:1.8;">
        <strong>Booking Title:</strong> ${sTitle}<br>
        <strong>Space:</strong> ${spaceName}<br>
        <strong>Start:</strong> ${formatDateTime(startTime)}<br>
        <strong>End:</strong> ${formatDateTime(endTime)}
      </p>
    `),
    attachments: [{
      filename: 'cancel.ics',
      // Same UID as the invite, so the calendar removes the right event -- a
      // one-off booking or one week of a series alike (issue #112).
      content: buildSpaceIcs('CANCEL', [{ bookingId, title, spaceName, startTime, endTime }], icsSequenceNow()),
      contentType: 'text/calendar; method=CANCEL',
    }],
  })
}
