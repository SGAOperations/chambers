import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { formatDate, formatTime } from './changes'

/**
 * One reservation CSC is being asked to release.
 *
 * Date, time and reservation code are what the request is actually made of --
 * the code is what CSC keys on. Room and body ride along as context so a person
 * reading the mail can sanity-check a code before acting on it.
 *
 * reservationCode is not nullable. A reservation with no code on file cannot be
 * cancelled by this route at all -- see collectPending, which sets those aside
 * rather than listing them.
 */
export interface CancellationLine {
  /** The dated row to mark Cancelled once CSC has been asked. */
  id: string
  /** Which table `id` belongs to. */
  source: 'one_time' | 'occurrence' | 'tabling_session'
  /** The parent bookings.id, for the audit log entry. */
  bookingId: string
  /**
   * What this booking becomes in Chambers once CSC has been asked.
   *
   * A cancellation request records whether the meeting is cancelled outright or
   * moving online, and the two are not the same afterwards -- 'Virtual' means it
   * still happens, without the room. CSC's side of it is identical either way:
   * the reservation is released.
   */
  resultingStatus: 'Cancelled' | 'Virtual'
  /**
   * False when no cancellation request says which, and the outcome fell back to
   * 'Cancelled'. Surfaced so an admin can see they are approving a default
   * rather than a stated intent.
   */
  outcomeFromRequest: boolean
  /**
   * The cancellation_requests row this reservation came from, so sending can
   * close it. Null when the status was set directly by an admin with no request
   * behind it -- there is nothing to mark done in that case.
   */
  cancellationRequestId: string | null
  date: string
  startTime: string
  endTime: string
  reservationCode: string
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
  /** Operational Affairs, copied on every request so the division has the record. */
  cc?: string
  replyTo?: string
}

/**
 * Asks CSC to cancel a batch of reservations.
 *
 * This is the one email Chambers sends outside the university's student
 * government -- every other template goes to members. It is therefore explicit
 * about who is asking and what is being asked, and it never claims a booking has
 * been cancelled: CSC releases the room, and Chambers finds out afterwards.
 */
export async function sendCscCancellationRequest(params: CscCancellationRequestParams) {
  const { lines, requestedBy, scopeNote, to, cc, replyTo } = params
  if (!lines.length) return

  const sRequestedBy = sanitize(requestedBy)
  const sScopeNote = sanitize(scopeNote)
  const count = lines.length
  const plural = count === 1 ? 'reservation' : 'reservations'

  const textRows = lines
    .map(l => [
      `  ${formatDate(l.date)}`,
      `  ${formatTime(l.startTime)} to ${formatTime(l.endTime)}`,
      `  Reservation code: ${sanitize(l.reservationCode)}`,
      `  Room/Table: ${sanitize(l.roomOrTable)}  (${sanitize(l.bodyName)}, ${l.bookingType})`,
      '',
    ].join('\n'))
    .join('\n')

  const htmlRows = lines
    .map(l => `
      <tr>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;">${formatDate(l.date)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;">${formatTime(l.startTime)} – ${formatTime(l.endTime)}</td>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;font-family:Consolas,Menlo,monospace;word-break:break-all;"><strong>${sanitize(l.reservationCode)}</strong></td>
        <td style="padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;color:#555;">${sanitize(l.roomOrTable)}<br><span style="font-size:12px;">${sanitize(l.bodyName)}</span></td>
      </tr>`)
    .join('')

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to,
    ...(cc ? { cc } : {}),
    // So a reply lands with the Operational Affairs inbox rather than the
    // no-reply sender the rest of the system uses.
    ...(replyTo ? { replyTo } : {}),
    subject: `Reservation Cancellation Request — Northeastern SGA (${count} ${plural})`,
    text: `Hello,

SGA would like to cancel the ${count} ${plural} listed below:

${sScopeNote}

${textRows}
Requested by ${sRequestedBy}.

If any of these cannot be cancelled, or if any information presented does not match your records, please reply all to this message.

Thank you,
SGA Operational Affairs Team`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">Hello,</p>
      <p style="margin:0 0 16px;">SGA would like to cancel the <strong>${count} ${plural}</strong> listed below:</p>
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
      <p style="margin:0 0 16px;">Requested by <strong>${sRequestedBy}</strong>.</p>
      <p style="margin:0 0 16px;color:#555;">If any of these cannot be cancelled, or if any information presented does not match your records, please reply all to this message.</p>
      <p style="margin:0;">Thank you,<br>SGA Operational Affairs Team</p>
    `),
  })
}
