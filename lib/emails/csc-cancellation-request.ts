import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { formatDate, formatTime } from './changes'

/**
 * One reservation CSC is being asked to release.
 *
 * Date, time and reservation code are what the request is actually made of --
 * the code is what CSC keys on. Room and body ride along as context so a person
 * reading the mail can sanity-check a code before acting on it.
 */
export interface CancellationLine {
  date: string
  startTime: string
  endTime: string
  reservationCode: string | null
  roomOrTable: string
  bodyName: string
  bookingType: 'One-Time Room' | 'Weekly Room' | 'Tabling'
}

interface CscCancellationRequestParams {
  lines: CancellationLine[]
  /** Who pressed the button, so CSC has a name to reply to. */
  requestedBy: string
  /** Describes the filter that produced this list, for the body of the mail. */
  scopeNote: string
  to: string
  replyTo?: string
}

/** Shown in place of a code that was never recorded, so a row is never blank. */
const NO_CODE = '— no code on file —'

/**
 * Asks CSC to cancel a batch of reservations.
 *
 * This is the one email Chambers sends outside the university's student
 * government -- every other template goes to members. It is therefore explicit
 * about who is asking and what is being asked, and it never claims a booking has
 * been cancelled: CSC releases the room, and Chambers finds out afterwards.
 */
export async function sendCscCancellationRequest(params: CscCancellationRequestParams) {
  const { lines, requestedBy, scopeNote, to, replyTo } = params
  if (!lines.length) return

  const sRequestedBy = sanitize(requestedBy)
  const sScopeNote = sanitize(scopeNote)
  const count = lines.length
  const plural = count === 1 ? 'reservation' : 'reservations'

  const textRows = lines
    .map(l => [
      `  ${formatDate(l.date)}`,
      `  ${formatTime(l.startTime)} to ${formatTime(l.endTime)}`,
      `  Reservation code: ${l.reservationCode ? sanitize(l.reservationCode) : NO_CODE}`,
      `  Room/Table: ${sanitize(l.roomOrTable)}  (${sanitize(l.bodyName)}, ${l.bookingType})`,
      '',
    ].join('\n'))
    .join('\n')

  const htmlRows = lines
    .map(l => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;">${formatDate(l.date)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;">${formatTime(l.startTime)} – ${formatTime(l.endTime)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;font-family:Consolas,Menlo,monospace;word-break:break-all;">${
          l.reservationCode
            ? `<strong>${sanitize(l.reservationCode)}</strong>`
            : `<span style="color:#a00;font-family:Arial,Helvetica,sans-serif;">${NO_CODE}</span>`
        }</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;color:#555;">${sanitize(l.roomOrTable)}<br><span style="font-size:12px;">${sanitize(l.bodyName)}</span></td>
      </tr>`)
    .join('')

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    // So a reply lands with the Operational Affairs inbox rather than the
    // no-reply sender the rest of the system uses.
    ...(replyTo ? { replyTo } : {}),
    subject: `Reservation Cancellation Request — Northeastern SGA (${count} ${plural})`,
    text: `Hello,

Northeastern's Student Government Association would like to cancel the ${count} ${plural} listed below. Each was marked for cancellation in Chambers, SGA's room management system.

${sScopeNote}

${textRows}
Requested by ${sRequestedBy}, Northeastern SGA Operational Affairs.

If any of these cannot be released, or a reservation code does not match your records, please reply to this message and we will follow up.

Thank you,
Northeastern SGA — Operational Affairs`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">Hello,</p>
      <p style="margin:0 0 16px;">Northeastern's Student Government Association would like to cancel the <strong>${count} ${plural}</strong> listed below. Each was marked for cancellation in Chambers, SGA's room management system.</p>
      <p style="margin:0 0 16px;color:#555;">${sScopeNote}</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:13px;">
        <tr style="background:#f4f4f4;">
          <th align="left" width="30%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Date</th>
          <th align="left" width="22%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Time</th>
          <th align="left" width="22%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Reservation<br>code</th>
          <th align="left" width="26%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Room / Table</th>
        </tr>
        ${htmlRows}
      </table>
      <p style="margin:0 0 16px;">Requested by <strong>${sRequestedBy}</strong>, Northeastern SGA Operational Affairs.</p>
      <p style="margin:0;color:#555;">If any of these cannot be released, or a reservation code does not match your records, please reply to this message and we will follow up.</p>
    `),
  })
}
