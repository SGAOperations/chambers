import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'

interface SpaceBookingConfirmedParams {
  bookingId: string
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

// Times are stored as UTC wall-clock (T18:15Z = 6:15 PM Eastern).
// Reading UTC fields gives the correct local-time digits to pair with TZID=America/New_York.
function toIcsLocal(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}`
}

// DTSTAMP records when the ICS was generated — must be real UTC with Z.
function toIcsUtc(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

function buildIcs(bookingId: string, title: string, spaceName: string, startTime: string, endTime: string): Buffer {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Chambers//SGA Room Manager//EN',
    'METHOD:REQUEST',
    // VTIMEZONE lets Outlook resolve the TZID on DTSTART/DTEND correctly.
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
    `UID:${bookingId}@chambers.northeasternsga.com`,
    `DTSTAMP:${toIcsUtc(new Date().toISOString())}`,
    `DTSTART;TZID=America/New_York:${toIcsLocal(startTime)}`,
    `DTEND;TZID=America/New_York:${toIcsLocal(endTime)}`,
    `SUMMARY:${escapeIcs(title)}`,
    `LOCATION:${escapeIcs(spaceName)}`,
    'DESCRIPTION:SGA Space booking confirmed via Chambers.',
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  return Buffer.from(lines.join('\r\n'))
}

export async function sendSpaceBookingConfirmedEmail(params: SpaceBookingConfirmedParams) {
  const { bookingId, title, spaceName, startTime, endTime, recipients } = params
  if (!recipients.length) return

  const sTitle = sanitize(title)

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
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
      content: buildIcs(bookingId, title, spaceName, startTime, endTime),
      contentType: 'text/calendar; method=REQUEST',
    }],
  })
}
