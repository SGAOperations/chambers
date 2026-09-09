import { resend } from '@/lib/resend'
import { sanitize, buildEmailHtml } from './utils'
import { formatDate, formatTime, renderChanges, type BookingChange } from './changes'

/**
 * One session of a repeating booking that an edit actually moved.
 *
 * The values are the session's own -- effective ones, with any per-week override
 * already resolved against the series -- so the email can describe the week that
 * changed rather than the series it belongs to.
 */
export interface UpdatedSession {
  date: string
  startTime: string
  endTime: string
  roomOrTable: string
  status: string
  purpose?: string | null
  /** Where this session sits in the run, e.g. "week 3 of 12". Omitted if unknown. */
  position?: string | null
  /** What moved in this session specifically. */
  changes?: BookingChange[]
}

interface BookingUpdatedEmailParams {
  bodyName: string
  roomOrTable: string
  date: string
  startTime: string
  endTime: string
  status: string
  recipients: string[]
  /**
   * What an administrator actually altered at the series level. Optional so a
   * caller that cannot work it out still sends the email it sent before (issue
   * #79).
   */
  changes?: BookingChange[]
  /**
   * The sessions of a repeating booking this edit moved, when the series itself
   * did not move. The email then describes those sessions -- their dates, times
   * and rooms -- instead of restating the series' start date.
   *
   * This is a list rather than a single session because the weekly editor saves
   * every week at once, so one save can move several of them. Naming only one
   * meant the other weeks changed silently (issue #91).
   */
  sessions?: UpdatedSession[] | null
  /** Shown above the details when set, e.g. the booking's purpose. */
  purpose?: string | null
}

/** The "Body / Room / Date / Time / Status" block, in both bodies of the email. */
function renderDetails(
  fields: { label: string; value: string }[]
): { text: string; html: string } {
  return {
    text: fields.map(f => `${f.label}: ${f.value}`).join('\n'),
    html: fields.map(f => `<strong>${f.label}:</strong> ${f.value}<br>`).join(''),
  }
}

/** One session's heading, change rows and current details, for the multi-session email. */
function renderSession(session: UpdatedSession): { text: string; html: string } {
  const heading = session.position
    ? `${formatDate(session.date)} (${sanitize(session.position)})`
    : formatDate(session.date)

  // The session's date is already the heading here, so the change rows go in bare.
  const rendered = renderChanges(session.changes ?? [], { heading: false })

  const details = renderDetails([
    ...(session.purpose ? [{ label: 'Purpose', value: sanitize(session.purpose) }] : []),
    { label: 'Room/Table', value: sanitize(session.roomOrTable) },
    { label: 'Time', value: `${formatTime(session.startTime)} to ${formatTime(session.endTime)}` },
    { label: 'Status', value: sanitize(session.status) },
  ])

  return {
    // Indented under the date, and held apart from the change rows above them:
    // run together, "- Purpose: Weekly Meeting -> Exec Sync" followed
    // immediately by "Purpose: Exec Sync" reads as a contradiction.
    text: `${heading}
${rendered ? `${rendered.text}\n` : ''}
${details.text.split('\n').map(l => `  ${l}`).join('\n')}`,
    html: `
      <div style="margin:0 0 20px;padding:0 0 0 12px;border-left:3px solid #c8102e;">
        <p style="margin:0 0 8px;font-weight:bold;">${heading}</p>
        ${rendered ? rendered.html : ''}
        <p style="margin:0;line-height:1.8;">${details.html}</p>
      </div>`,
  }
}

export async function sendBookingUpdatedEmail(params: BookingUpdatedEmailParams) {
  const {
    bodyName, roomOrTable, date, startTime, endTime, status, recipients,
    changes = [], sessions = null, purpose = null,
  } = params
  if (!recipients.length) return

  const sBodyName = sanitize(bodyName)
  const sPurpose = purpose ? sanitize(purpose) : null

  const moved = sessions ?? []

  // Three shapes, one email: the whole series moved, one week of it moved, or
  // several weeks of it moved.
  const { subject, lead, text, html } = moved.length > 1
    ? buildMultiSession(sBodyName, moved)
    : moved.length === 1
      ? buildSingleSession(sBodyName, moved[0])
      : buildSeries(sBodyName, sPurpose, { roomOrTable, date, startTime, endTime, status }, changes)

  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL!,
    to: process.env.RESEND_FROM_EMAIL!,
    bcc: recipients,
    subject,
    text: `${lead}

${text}

If you have questions, please reach out to sgaOperations@northeastern.edu.`,
    html: buildEmailHtml(`
      <p style="margin:0 0 16px;">${lead}</p>
      ${html}
    `),
  })
}

function buildSeries(
  sBodyName: string,
  sPurpose: string | null,
  now: { roomOrTable: string; date: string; startTime: string; endTime: string; status: string },
  changes: BookingChange[]
) {
  const rendered = renderChanges(changes)
  const details = renderDetails([
    ...(sPurpose ? [{ label: 'Purpose', value: sPurpose }] : []),
    { label: 'Body', value: sBodyName },
    { label: 'Room/Table', value: sanitize(now.roomOrTable) },
    { label: 'Date', value: formatDate(now.date) },
    { label: 'Time', value: `${formatTime(now.startTime)} to ${formatTime(now.endTime)}` },
    { label: 'Status', value: sanitize(now.status) },
  ])

  return {
    subject: 'Chambers — Your Booking Has Been Updated',
    lead: `Your ${sBodyName} booking has been updated by a Chambers administrator.`,
    text: `${rendered ? `What changed:\n${rendered.text}\n\n` : ''}The booking now reads:

${details.text}`,
    html: `
      ${rendered ? rendered.html : ''}
      <p style="margin:0 0 8px;font-weight:bold;">The booking now reads</p>
      <p style="margin:0;line-height:1.8;">${details.html}</p>`,
  }
}

function buildSingleSession(sBodyName: string, session: UpdatedSession) {
  const rendered = renderChanges(session.changes ?? [])
  const details = renderDetails([
    ...(session.purpose ? [{ label: 'Purpose', value: sanitize(session.purpose) }] : []),
    { label: 'Body', value: sBodyName },
    { label: 'Room/Table', value: sanitize(session.roomOrTable) },
    { label: 'Session date', value: formatDate(session.date) },
    { label: 'Time', value: `${formatTime(session.startTime)} to ${formatTime(session.endTime)}` },
    { label: 'Status', value: sanitize(session.status) },
    ...(session.position ? [{ label: 'Session', value: sanitize(session.position) }] : []),
  ])

  return {
    // A recipient scanning a phone should be able to tell from the subject
    // whether this is their whole booking or one week of it.
    subject: `Chambers — A Session of Your ${sBodyName} Booking Has Changed`,
    lead: `One session of your ${sBodyName} weekly booking has been updated by a Chambers administrator. The rest of the series is unchanged.`,
    text: `${rendered ? `What changed:\n${rendered.text}\n\n` : ''}This session now reads:

${details.text}`,
    html: `
      ${rendered ? rendered.html : ''}
      <p style="margin:0 0 8px;font-weight:bold;">This session now reads</p>
      <p style="margin:0;line-height:1.8;">${details.html}</p>`,
  }
}

function buildMultiSession(sBodyName: string, sessions: UpdatedSession[]) {
  const blocks = sessions.map(renderSession)

  return {
    subject: `Chambers — ${sessions.length} Sessions of Your ${sBodyName} Booking Have Changed`,
    lead: `${sessions.length} sessions of your ${sBodyName} weekly booking have been updated by a Chambers administrator. The rest of the series is unchanged.`,
    text: `These sessions now read:

${blocks.map(b => b.text).join('\n\n')}`,
    html: `
      <p style="margin:0 0 12px;font-weight:bold;">These sessions now read</p>
      ${blocks.map(b => b.html).join('')}`,
  }
}
