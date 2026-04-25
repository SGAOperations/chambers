import { resend } from '@/lib/resend'

interface SpaceBookingCancelledParams {
  title: string
  spaceName: string
  startTime: string // ISO timestamptz
  endTime: string   // ISO timestamptz
  to: string
  cc?: string[]
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

export async function sendSpaceBookingCancelledEmail(params: SpaceBookingCancelledParams) {
  const { title, spaceName, startTime, endTime, to, cc } = params
  if (!to) return

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    ...(cc?.length ? { cc } : {}),
    subject: `Chambers \u2014 SGA Space Booking Cancelled: ${title}`,
    text: `Your SGA Space booking has been cancelled.

Booking Title: ${title}
Space: ${spaceName}
Start: ${formatDateTime(startTime)}
End: ${formatDateTime(endTime)}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
  })
}
