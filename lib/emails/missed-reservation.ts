import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { formatDate, formatTime } from './changes'

/**
 * The alert Operational Affairs gets when a reservation is marked Missed.
 *
 * This template did not move when the booking emails were rewritten in #79, and
 * drifted (issue #99). It rendered its times straight out of the payload, so an
 * alert read "Time of Reservation: 18:30:00 to 20:00:00" where every other
 * Chambers email said "6:30 PM to 8:00 PM"; it carried a second copy of the date
 * formatter under a different name; and it took its date already formatted,
 * which is why the raw times were easy to miss -- the one value the caller
 * prepared looked right, and the two it passed through did not.
 *
 * It now takes raw values and formats them here, like every other template.
 */
interface MissedReservationEmailParams {
  bodyName: string
  /** 'YYYY-MM-DD'. Formatted here, not by the caller. */
  date: string
  /** 'HH:MM' or 'HH:MM:SS' -- both are formatted the same way. */
  startTime: string
  endTime: string
  contacts: string[]
  /** The room or table that went unused. Omitted when the caller has none. */
  roomOrTable?: string | null
}

export async function sendMissedReservationEmail(params: MissedReservationEmailParams) {
  const { bodyName, date, startTime, endTime, contacts, roomOrTable = null } = params

  const sBodyName = sanitize(bodyName)
  // An em dash, so a list of names cannot read as one hyphenated name, and a
  // placeholder rather than an empty line when a body has no leadership on file.
  const sContacts = contacts.length ? contacts.map(sanitize).join(', ') : 'None on file'
  const sRoomOrTable = roomOrTable ? sanitize(roomOrTable) : null

  const roomText = sRoomOrTable ? `Room/Table: ${sRoomOrTable}\n` : ''
  const roomHtml = sRoomOrTable ? `<strong>Room/Table:</strong> ${sRoomOrTable}<br>` : ''

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    // Straight to Operational Affairs rather than bcc'd to a membership: this is
    // an internal alert about a body, not a notification to it.
    to: process.env.OPS_EMAIL!,
    subject: 'Chambers — Reservation Missed',
    text: `This is an automatic alert that a SGA reservation was marked as missed by a Chambers administrator.

Responsible Body: ${sBodyName}
${roomText}Date of Reservation: ${formatDate(date)}
Time of Reservation: ${formatTime(startTime)} to ${formatTime(endTime)}

Contacts: ${sContacts}

For further information, please reach out to the Comptroller.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">This is an automatic alert that a SGA reservation was marked as missed by a Chambers administrator.</p>
      <p style="margin:0;line-height:1.8;">
        <strong>Responsible Body:</strong> ${sBodyName}<br>
        ${roomHtml}<strong>Date of Reservation:</strong> ${formatDate(date)}<br>
        <strong>Time of Reservation:</strong> ${formatTime(startTime)} to ${formatTime(endTime)}<br>
        <strong>Contacts:</strong> ${sContacts}
      </p>
    `, 'For further information, please reach out to the Comptroller.'),
  })
}
