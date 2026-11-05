import { emailFrom, resend } from '@/lib/resend'
import { buildEmailHtml, escapeHtml, sanitize } from './utils'
import { formatDate, formatTime } from './changes'
import type { RoomSession } from '@/lib/room-calendar'

/**
 * Tells someone a booking has come off their calendar because they are no
 * longer on the body it belongs to (lib/seat-removal.ts).
 *
 * Not a cancellation email. The booking has not changed and the body has not
 * heard anything; this person changed SGA position. The wording says that, so
 * nobody reads it as a meeting called off -- the calendar attachments are the
 * only part that is a cancellation, because that is the only thing a calendar
 * understands as "take this off".
 */

export interface CalendarAttachment {
  filename: string
  content: Buffer
  contentType: string
}

interface SeatRemovedEmailParams {
  /** One person's addresses: personal, their SGA inbox, or both. */
  to: string[]
  /** The bodies they left that reached this booking. */
  removedBodies: string[]
  /** The calendar event's name, as the invite gave it. */
  summary: string
  /** Upcoming sessions, for the list in the email. */
  sessions: RoomSession[]
  attachments: CalendarAttachment[]
}

const MAX_LISTED = 8

/** 'A', 'A and B', 'A, B and C'. */
function listOf(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

export async function sendSeatRemovedEmail(params: SeatRemovedEmailParams) {
  const { to, removedBodies, summary, sessions, attachments } = params
  if (!attachments.length || !to.length) return

  const bodies = listOf(removedBodies.map(sanitize))
  const sSummary = sanitize(summary)
  const lead = `You're no longer on ${bodies} in Chambers, so this booking has been taken off your calendar. The booking itself hasn't changed.`
  const why = 'Your bodies in Chambers come from your SGA position. If you should still be on this body, ask SGA Operations to update your position.'

  const listed = sessions.slice(0, MAX_LISTED).map(s =>
    `${formatDate(s.date)} · ${formatTime(s.startTime)} to ${formatTime(s.endTime)} · ${sanitize(s.location)}`
  )
  const more = sessions.length - listed.length

  await resend.emails.send({
    from: emailFrom(),
    to,
    subject: `Chambers — Removed from your calendar: ${sSummary}`,
    text: `${lead}

Booking: ${sSummary}

Upcoming sessions removed:
${listed.map(l => `  ${l}`).join('\n')}${more > 0 ? `\n  …and ${more} more` : ''}

${why}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">${escapeHtml(lead)}</p>
      <p style="margin:0 0 16px;"><strong>Booking:</strong> ${escapeHtml(sSummary)}</p>
      <p style="margin:0 0 8px;font-weight:bold;">Upcoming sessions removed</p>
      <ul style="margin:0 0 16px;padding-left:20px;line-height:1.6;">
        ${listed.map(l => `<li>${escapeHtml(l)}</li>`).join('')}
        ${more > 0 ? `<li style="color:#555;">…and ${more} more</li>` : ''}
      </ul>
      <p style="margin:0;color:#555;">${escapeHtml(why)}</p>
    `),
    attachments,
  })
}
