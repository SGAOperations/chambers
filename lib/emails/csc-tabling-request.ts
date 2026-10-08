import { emailFrom } from '@/lib/resend'
import { sanitize, buildEmailHtml, escapeHtml } from './utils'
import { formatDate, formatTime } from './changes'
import { sendToCsc } from './csc-send'
import type { TablingRequestLine } from '@/lib/pending-tabling-requests'

interface CscTablingRequestParams {
  requests: TablingRequestLine[]
  /** Who pressed the button, so CSC has a name to reply to. */
  requestedBy: string
  to: string
  /** Operational Affairs, copied on every request so the division has the record. */
  cc?: string
  replyTo?: string
}

function tablesText(tables: number | null): string {
  return tables == null ? 'Not specified' : `${tables} ${tables === 1 ? 'table' : 'tables'}`
}

/**
 * Asks CSC to reserve tables for a batch of tabling requests (issue #226).
 *
 * The counterpart of the cancellation request, and written the same way: plain
 * about who is asking and what for, and never claiming anything is booked. CSC
 * answers with a reservation code or a no, and Chambers only finds out when an
 * admin records the answer by fulfilling or denying the request.
 *
 * Grouped by request rather than flattened into one list of dates. A tabling
 * request is one body asking for one purpose, and CSC decides on that whole --
 * the dates make sense together, under the name of who they are for.
 *
 * The location is labelled a preference because it is one: the requester typed
 * where they would like to be, and CSC decides where tables actually go.
 */
export async function sendCscTablingRequest(params: CscTablingRequestParams) {
  const { requests, requestedBy, to, cc, replyTo } = params
  if (!requests.length) return

  const sRequestedBy = sanitize(requestedBy)
  const sessionCount = requests.reduce((n, r) => n + r.sessions.length, 0)
  const sessionsPlural = sessionCount === 1 ? 'session' : 'sessions'
  const requestsPlural = requests.length === 1 ? 'request' : 'requests'

  const textBlocks = requests
    .map(r => [
      `${sanitize(r.bodyName)} — ${sanitize(r.purpose)}`,
      ...r.sessions.map(s => [
        `  ${formatDate(s.date)}, ${formatTime(s.startTime)} to ${formatTime(s.endTime)}`,
        `    Preferred location: ${s.location ? sanitize(s.location) : 'Not specified'}`,
        `    Tables: ${tablesText(s.tables)}`,
      ].join('\n')),
      '',
    ].join('\n'))
    .join('\n')

  // The purpose and location are typed by members and read by an office outside
  // SGA, so the HTML part escapes them rather than trusting them.
  const h = (s: string) => escapeHtml(sanitize(s))
  const cell = 'padding:8px 10px;border-bottom:1px solid #e0e0e0;vertical-align:top;'
  const htmlBlocks = requests
    .map(r => `
      <p style="margin:0 0 6px;"><strong>${h(r.bodyName)}</strong> — ${h(r.purpose)}</p>
      <table cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 20px;font-size:13px;">
        <tr style="background:#f4f4f4;">
          <th align="left" width="30%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Date</th>
          <th align="left" width="24%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Time</th>
          <th align="left" width="30%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Preferred location</th>
          <th align="left" width="16%" style="padding:8px 10px;border-bottom:2px solid #ccc;">Tables</th>
        </tr>
        ${r.sessions.map(s => `
        <tr>
          <td style="${cell}">${formatDate(s.date)}</td>
          <td style="${cell}">${formatTime(s.startTime)} – ${formatTime(s.endTime)}</td>
          <td style="${cell}color:#555;">${s.location ? h(s.location) : '<em>Not specified</em>'}</td>
          <td style="${cell}">${tablesText(s.tables)}</td>
        </tr>`).join('')}
      </table>`)
    .join('')

  await sendToCsc({
    from: emailFrom(),
    to,
    ...(cc ? { cc } : {}),
    // So a reply lands with the Operational Affairs inbox rather than the
    // no-reply sender the rest of the system uses.
    ...(replyTo ? { replyTo } : {}),
    subject: `Tabling Reservation Request — Northeastern SGA (${sessionCount} ${sessionsPlural})`,
    text: `Hello,

SGA would like to reserve tables for the ${sessionCount} ${sessionsPlural} below, across ${requests.length} ${requestsPlural}:

${textBlocks}
Requested by ${sRequestedBy}.

Please reply all with a reservation code for each session you can accommodate, and let us know if any cannot be, or if a different location or time would work instead.

Thank you,
SGA Operational Affairs Team`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">Hello,</p>
      <p style="margin:0 0 16px;">SGA would like to reserve tables for the <strong>${sessionCount} ${sessionsPlural}</strong> below, across ${requests.length} ${requestsPlural}:</p>
      ${htmlBlocks}
      <p style="margin:0 0 16px;">Requested by <strong>${escapeHtml(sRequestedBy)}</strong>.</p>
      <p style="margin:0 0 16px;color:#555;">Please reply all with a reservation code for each session you can accommodate, and let us know if any cannot be, or if a different location or time would work instead.</p>
      <p style="margin:0;">Thank you,<br>SGA Operational Affairs Team</p>
    `),
  })
}
