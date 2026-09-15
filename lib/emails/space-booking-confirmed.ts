import { emailFrom, resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { buildSpaceIcs, formatSpaceDateTime as formatDateTime } from './space-ics'

interface SpaceBookingConfirmedParams {
  bookingId: string
  title: string
  spaceName: string
  startTime: string // ISO timestamptz
  endTime: string   // ISO timestamptz
  recipients: string[]
}

export async function sendSpaceBookingConfirmedEmail(params: SpaceBookingConfirmedParams) {
  const { bookingId, title, spaceName, startTime, endTime, recipients } = params
  if (!recipients.length) return

  const sTitle = sanitize(title)

  await resend.emails.send({
    from: emailFrom(),
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject: `Chambers \u2014 SGA Space Booking Confirmed: ${sTitle}`,
    text: `Your SGA Space booking has been confirmed.

Booking Title: ${sTitle}
Space: ${spaceName}
Start: ${formatDateTime(startTime)}
End: ${formatDateTime(endTime)}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">Your SGA Space booking has been confirmed.</p>
      <p style="margin:0;line-height:1.8;">
        <strong>Booking Title:</strong> ${sTitle}<br>
        <strong>Space:</strong> ${spaceName}<br>
        <strong>Start:</strong> ${formatDateTime(startTime)}<br>
        <strong>End:</strong> ${formatDateTime(endTime)}
      </p>
    `),
    attachments: [{
      filename: 'booking.ics',
      content: buildSpaceIcs('REQUEST', [{ bookingId, title, spaceName, startTime, endTime }]),
      contentType: 'text/calendar; method=REQUEST',
    }],
  })
}
