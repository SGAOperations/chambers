import { resend } from '@/lib/resend'
import { sanitize } from './utils'

interface BookingUpdatedEmailParams {
  bodyName: string
  roomOrTable: string
  date: string
  startTime: string
  endTime: string
  status: string
  recipients: string[]
}

function formatTime(timeStr: string): string {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h = hours % 12 || 12
  return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export async function sendBookingUpdatedEmail(params: BookingUpdatedEmailParams) {
  const { bodyName, roomOrTable, date, startTime, endTime, status, recipients } = params
  if (!recipients.length) return

  const sBodyName = sanitize(bodyName)
  const sRoomOrTable = sanitize(roomOrTable)
  const sStatus = sanitize(status)

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: recipients,
    subject: 'Chambers \u2014 Your Booking Has Been Updated',
    text: `Your ${sBodyName} booking has been updated by a Chambers administrator.

Body: ${sBodyName}
Room/Table: ${sRoomOrTable}
Date: ${formatDate(date)}
Time: ${formatTime(startTime)} to ${formatTime(endTime)}
Status: ${sStatus}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
  })
}
