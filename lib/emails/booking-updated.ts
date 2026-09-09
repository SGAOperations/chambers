import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { formatDate, formatTime, renderChanges, type BookingChange } from './changes'

interface BookingUpdatedEmailParams {
  bodyName: string
  roomOrTable: string
  date: string
  startTime: string
  endTime: string
  status: string
  recipients: string[]
  /**
   * What an administrator actually altered. Optional so a caller that cannot
   * work it out still sends the email it sent before (issue #79).
   */
  changes?: BookingChange[]
  /**
   * Set when the edit was to one session of a repeating booking rather than to
   * the series. The email then describes that session -- its date, its time, its
   * room -- instead of restating the series' start date, which is what it used
   * to do no matter which week had been touched.
   */
  occurrence?: {
    /** Where this session sits in the run, e.g. "week 3 of 12". Omitted if unknown. */
    position?: string | null
  } | null
  /** Shown above the details when set, e.g. the booking's purpose. */
  purpose?: string | null
}

export async function sendBookingUpdatedEmail(params: BookingUpdatedEmailParams) {
  const {
    bodyName, roomOrTable, date, startTime, endTime, status, recipients,
    changes = [], occurrence = null, purpose = null,
  } = params
  if (!recipients.length) return

  const sBodyName = sanitize(bodyName)
  const sRoomOrTable = sanitize(roomOrTable)
  const sStatus = sanitize(status)
  const sPurpose = purpose ? sanitize(purpose) : null

  const isOccurrence = !!occurrence
  const rendered = renderChanges(changes)

  // A recipient scanning a phone should be able to tell from the subject whether
  // this is their whole booking or one week of it.
  const subject = isOccurrence
    ? `Chambers — A Session of Your ${sBodyName} Booking Has Changed`
    : 'Chambers — Your Booking Has Been Updated'

  const lead = isOccurrence
    ? `One session of your ${sBodyName} weekly booking has been updated by a Chambers administrator. The rest of the series is unchanged.`
    : `Your ${sBodyName} booking has been updated by a Chambers administrator.`

  const dateLabel = isOccurrence ? 'Session date' : 'Date'
  const positionText = occurrence?.position ? `\nSession: ${sanitize(occurrence.position)}` : ''
  const positionHtml = occurrence?.position
    ? `<strong>Session:</strong> ${sanitize(occurrence.position)}<br>`
    : ''

  const purposeText = sPurpose ? `Purpose: ${sPurpose}\n` : ''
  const purposeHtml = sPurpose ? `<strong>Purpose:</strong> ${sPurpose}<br>` : ''

  const changesText = rendered ? `\nWhat changed:\n${rendered.text}\n` : ''

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject,
    text: `${lead}
${changesText}
${isOccurrence ? 'This session now reads:' : 'The booking now reads:'}

${purposeText}Body: ${sBodyName}
Room/Table: ${sRoomOrTable}
${dateLabel}: ${formatDate(date)}
Time: ${formatTime(startTime)} to ${formatTime(endTime)}
Status: ${sStatus}${positionText}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">${lead}</p>
      ${rendered ? rendered.html : ''}
      <p style="margin:0 0 8px;font-weight:bold;">${isOccurrence ? 'This session now reads' : 'The booking now reads'}</p>
      <p style="margin:0;line-height:1.8;">
        ${purposeHtml}<strong>Body:</strong> ${sBodyName}<br>
        <strong>Room/Table:</strong> ${sRoomOrTable}<br>
        <strong>${dateLabel}:</strong> ${formatDate(date)}<br>
        <strong>Time:</strong> ${formatTime(startTime)} to ${formatTime(endTime)}<br>
        <strong>Status:</strong> ${sStatus}<br>
        ${positionHtml}
      </p>
    `),
  })
}
