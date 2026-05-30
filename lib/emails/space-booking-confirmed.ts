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

function toIcsDateTime(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function buildIcs(title: string, spaceName: string, startTime: string, endTime: string): Buffer {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chambers//SGA Room Manager//EN',
    'METHOD:REQUEST',
    'BEGIN:VEVENT',
    `UID:${Date.now()}@chambers.northeasternsga.com`,
    `DTSTAMP:${toIcsDateTime(new Date().toISOString())}`,
    `DTSTART:${toIcsDateTime(startTime)}`,
    `DTEND:${toIcsDateTime(endTime)}`,
    `SUMMARY:${escapeIcs(title)}`,
    `LOCATION:${escapeIcs(spaceName)}`,
    'DESCRIPTION:SGA Space booking confirmed via Chambers.',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return Buffer.from(lines.join('\r\n'))
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
    attachments: [{
      filename: 'booking.ics',
      content: buildIcs(title, spaceName, startTime, endTime),
      contentType: 'text/calendar; method=REQUEST',
    }],
  })
}
