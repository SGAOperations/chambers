import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { formatDate, formatTime } from './changes'

/**
 * One dated slot on the booking. A one-time booking can carry several, a weekly
 * booking has its generated occurrences, and tabling has its sessions.
 */
export interface BookingSession {
  date: string
  startTime: string
  endTime: string
  roomOrTable?: string | null
}

interface BookingCreatedEmailParams {
  bodyName: string
  bookingType: 'One-Time Room' | 'Weekly Room' | 'Tabling'
  purpose: string
  roomOrTable: string
  status: string
  sessions: BookingSession[]
  /** Shown only when set; a weekly series has one, a one-time booking does not. */
  dateRange?: { start: string; end: string } | null
  recipients: string[]
}

/**
 * Tells a body that a booking now exists for them.
 *
 * Chambers emailed on update and on a missed reservation, but never on creation
 * (issue #79) -- so the first email anyone received about a booking was one
 * saying it had changed, referring to details they had never been sent. Bodies
 * found out they had a room by opening My Rooms, or by being told in person.
 */
const MAX_LISTED_SESSIONS = 8

export async function sendBookingCreatedEmail(params: BookingCreatedEmailParams) {
  const { bodyName, bookingType, purpose, roomOrTable, status, sessions, dateRange, recipients } = params
  if (!recipients.length) return

  const sBodyName = sanitize(bodyName)
  const sPurpose = sanitize(purpose || 'No purpose given')
  const sRoomOrTable = sanitize(roomOrTable)
  const sStatus = sanitize(status)
  const label = bookingType === 'Tabling' ? 'Table' : 'Room'

  // A full-semester weekly series is 15+ occurrences, and a wall of dates buries
  // the thing the reader needs. The range above already says how long it runs.
  const listed = sessions.slice(0, MAX_LISTED_SESSIONS)
  const remaining = sessions.length - listed.length

  const sessionLinesText = listed
    .map(s => `  ${formatDate(s.date)} · ${formatTime(s.startTime)} to ${formatTime(s.endTime)}${
      s.roomOrTable ? ` · ${sanitize(s.roomOrTable)}` : ''
    }`)
    .join('\n')

  const sessionLinesHtml = listed
    .map(s => `<tr><td style="padding:3px 0;">${formatDate(s.date)} &middot; ${formatTime(s.startTime)} to ${formatTime(s.endTime)}${
      s.roomOrTable ? ` &middot; ${sanitize(s.roomOrTable)}` : ''
    }</td></tr>`)
    .join('')

  const moreText = remaining > 0 ? `\n  …and ${remaining} more session${remaining === 1 ? '' : 's'}` : ''
  const moreHtml = remaining > 0
    ? `<tr><td style="padding:3px 0;color:#555;">…and ${remaining} more session${remaining === 1 ? '' : 's'}</td></tr>`
    : ''

  const rangeText = dateRange ? `\nRuns: ${formatDate(dateRange.start)} to ${formatDate(dateRange.end)}` : ''
  const rangeHtml = dateRange
    ? `<strong>Runs:</strong> ${formatDate(dateRange.start)} to ${formatDate(dateRange.end)}<br>`
    : ''

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    // BCC, matching the other booking emails: recipients are a whole body's
    // membership and should not see each other's addresses.
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject: `Chambers — New ${bookingType === 'Tabling' ? 'Tabling' : 'Room'} Booking for ${sBodyName}`,
    text: `A ${bookingType} booking has been created for ${sBodyName}.

Purpose: ${sPurpose}
Body: ${sBodyName}
${label}: ${sRoomOrTable}
Status: ${sStatus}${rangeText}

Sessions:
${sessionLinesText}${moreText}

You can see this booking, and request a change to it, in Chambers under My Rooms.

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">A <strong>${bookingType}</strong> booking has been created for ${sBodyName}.</p>
      <p style="margin:0 0 16px;line-height:1.8;">
        <strong>Purpose:</strong> ${sPurpose}<br>
        <strong>Body:</strong> ${sBodyName}<br>
        <strong>${label}:</strong> ${sRoomOrTable}<br>
        <strong>Status:</strong> ${sStatus}<br>
        ${rangeHtml}
      </p>
      <p style="margin:0 0 8px;font-weight:bold;">Sessions</p>
      <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;width:100%;">
        ${sessionLinesHtml}${moreHtml}
      </table>
      <p style="margin:0;color:#555;">You can see this booking, and request a change to it, in Chambers under My Rooms.</p>
    `),
  })
}
