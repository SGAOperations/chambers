import { emailFrom, resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { formatDate, formatTime } from './changes'
import { icsSequenceNow } from './ics-core'
import { roomIcsAttachments } from './room-ics'
import type { InvitePlan } from '@/lib/room-calendar'

/**
 * Tells a body that sessions of its booking are off, and takes them off the
 * calendars they are on (issue #69).
 *
 * Three paths cancelled reservations without telling anybody: the admin Cancel
 * button, approving a cancellation request, and Auto-Cancel. Auto-Cancel emailed
 * CSC to release the room and nobody else, so the body heard nothing and the
 * meeting stayed in My Rooms' past and on every calendar that had it.
 *
 * A meeting moving online is a cancellation of the room, not of the meeting, so
 * it says so and keeps the session on the calendar with Virtual as its location.
 */
interface BookingCancelledEmailParams {
  bodyName: string
  purpose?: string | null
  /** Sessions no longer happening in a room, for the wording. */
  cancelled: { date: string; startTime: string; endTime: string; roomOrTable?: string | null }[]
  /** Sessions that moved online rather than being called off. */
  virtual?: { date: string; startTime: string; endTime: string }[]
  recipients: string[]
  /** What to change on calendars: Virtual sessions are re-sent, cancelled ones removed. */
  invite?: InvitePlan | null
}

const MAX_LISTED = 8

function lines(sessions: { date: string; startTime: string; endTime: string; roomOrTable?: string | null }[]): string[] {
  return sessions.slice(0, MAX_LISTED).map(s =>
    `${formatDate(s.date)} · ${formatTime(s.startTime)} to ${formatTime(s.endTime)}${
      s.roomOrTable ? ` · ${sanitize(s.roomOrTable)}` : ''
    }`
  )
}

export async function sendBookingCancelledEmail(params: BookingCancelledEmailParams) {
  const { bodyName, purpose, cancelled, virtual = [], recipients, invite } = params
  if (!recipients.length || (!cancelled.length && !virtual.length)) return

  const sBodyName = sanitize(bodyName)
  const sPurpose = purpose ? sanitize(purpose) : null

  const cancelledLines = lines(cancelled)
  const virtualLines = lines(virtual)
  const moreCancelled = cancelled.length - cancelledLines.length
  const moreVirtual = virtual.length - virtualLines.length

  const lead = cancelled.length && virtual.length
    ? `Some sessions of your ${sBodyName} booking have been cancelled, and others are moving online.`
    : cancelled.length
      ? `${cancelled.length === 1 ? 'A session' : `${cancelled.length} sessions`} of your ${sBodyName} booking ${cancelled.length === 1 ? 'has' : 'have'} been cancelled.`
      : `${virtual.length === 1 ? 'A session' : `${virtual.length} sessions`} of your ${sBodyName} booking ${virtual.length === 1 ? 'is' : 'are'} moving online. The room has been released.`

  const groups = [
    { heading: 'Cancelled', items: cancelledLines, more: moreCancelled },
    { heading: 'Moving online', items: virtualLines, more: moreVirtual },
  ].filter(g => g.items.length)

  const text = groups
    .map(g => `${g.heading}:\n${g.items.map(l => `  ${l}`).join('\n')}${g.more > 0 ? `\n  …and ${g.more} more` : ''}`)
    .join('\n\n')

  const html = groups
    .map(g => `
      <p style="margin:0 0 8px;font-weight:bold;">${g.heading}</p>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;">
        ${g.items.map(l => `<li>${l}</li>`).join('')}
        ${g.more > 0 ? `<li style="color:#555;">…and ${g.more} more</li>` : ''}
      </ul>`)
    .join('')

  await resend.emails.send({
    from: emailFrom(),
    // BCC, matching the other booking emails: recipients are a whole body's
    // membership and should not see each other's addresses.
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject: `Chambers — Booking Cancelled for ${sBodyName}`,
    text: `${lead}

${sPurpose ? `Purpose: ${sPurpose}\nBody: ${sBodyName}` : `Body: ${sBodyName}`}

${text}

You can see this booking in Chambers under My Rooms.

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">${lead}</p>
      <p style="margin:0 0 16px;line-height:1.8;">
        ${sPurpose ? `<strong>Purpose:</strong> ${sPurpose}<br>` : ''}
        <strong>Body:</strong> ${sBodyName}
      </p>
      ${html}
      <p style="margin:0;color:#555;">You can see this booking in Chambers under My Rooms.</p>
    `),
    ...(invite && (invite.request.length || invite.cancel.length)
      ? { attachments: roomIcsAttachments(invite, icsSequenceNow()) }
      : {}),
  })
}
