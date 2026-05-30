import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'

interface SpaceBookingCancelledParams {
  bookingId: string
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

function toIcsLocal(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

function toIcsUtc(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

function buildCancelIcs(bookingId: string, title: string, spaceName: string, startTime: string, endTime: string): Buffer {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chambers//SGA Room Manager//EN',
    'METHOD:CANCEL',
    'BEGIN:VTIMEZONE',
    'TZID:America/New_York',
    'BEGIN:DAYLIGHT',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'TZNAME:EDT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYDAY=2SU;BYMONTH=3',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'TZNAME:EST',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYDAY=1SU;BYMONTH=11',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    // UID must match the confirmation ICS exactly so Outlook removes the right event.
    `UID:${bookingId}@chambers.northeasternsga.com`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART;TZID=America/New_York:${toIcsLocal(startTime)}`,
    `DTEND;TZID=America/New_York:${toIcsLocal(endTime)}`,
    `SUMMARY:${title}`,
    `LOCATION:${spaceName}`,
    'STATUS:CANCELLED',
    'SEQUENCE:1',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return Buffer.from(lines.join('\r\n'))
}

export async function sendSpaceBookingCancelledEmail(params: SpaceBookingCancelledParams) {
  const { bookingId, title, spaceName, startTime, endTime, to, cc } = params
  if (!to) return

  const sTitle = sanitize(title)

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    ...(cc?.length ? { cc } : {}),
    subject: `Chambers — SGA Space Booking Cancelled: ${sTitle}`,
    text: `Your SGA Space booking has been cancelled.

Booking Title: ${sTitle}
Space: ${spaceName}
Start: ${formatDateTime(startTime)}
End: ${formatDateTime(endTime)}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">Your SGA Space booking has been cancelled.</p>
      <p style="margin:0;line-height:1.8;">
        <strong>Booking Title:</strong> ${sTitle}<br>
        <strong>Space:</strong> ${spaceName}<br>
        <strong>Start:</strong> ${formatDateTime(startTime)}<br>
        <strong>End:</strong> ${formatDateTime(endTime)}
      </p>
    `),
    attachments: [{
      filename: 'cancel.ics',
      content: buildCancelIcs(bookingId, title, spaceName, startTime, endTime),
      contentType: 'text/calendar; method=CANCEL',
    }],
  })
}
