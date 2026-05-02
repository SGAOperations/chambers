import { resend } from '@/lib/resend'
import { sanitize } from './utils'

interface SpaceBookingConfirmedParams {
  title: string
  spaceName: string
  startTime: string // ISO timestamptz
  endTime: string   // ISO timestamptz
  recipients: string[]
}

function formatDateTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleString('en-US', {
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

export async function sendSpaceBookingConfirmedEmail(params: SpaceBookingConfirmedParams) {
  const { title, spaceName, startTime, endTime, recipients } = params
  if (!recipients.length) return

  const sTitle = sanitize(title)

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: recipients,
    subject: `Chambers \u2014 SGA Space Booking Confirmed: ${sTitle}`,
    text: `Your SGA Space booking has been confirmed.

Booking Title: ${sTitle}
Space: ${spaceName}
Start: ${formatDateTime(startTime)}
End: ${formatDateTime(endTime)}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
  })
}
