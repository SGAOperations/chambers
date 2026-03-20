import { resend } from '@/lib/resend'

interface MissedReservationEmailParams {
  bodyName: string
  date: string
  startTime: string
  endTime: string
  contacts: string[]
}

export function formatDateLong(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export async function sendMissedReservationEmail(params: MissedReservationEmailParams) {
  const { bodyName, date, startTime, endTime, contacts } = params

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: process.env.EVP_EMAIL!,
    subject: 'Chambers Alert - Reservation Missed',
    text: `This is an automatic alert that a SGA reservation was marked as missed by a Chambers administrator.

Responsible Body: ${bodyName}
Date of Reservation: ${date}
Time of Reservation: ${startTime} to ${endTime}

Contacts: ${contacts.join(', ')}

For further information, please reach out to the Vice President of Operational Affairs and/or the Comptroller.`,
  })
}
