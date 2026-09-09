import { sanitize } from './utils'

/**
 * One field that moved, in words a recipient can act on.
 *
 * The update email used to state the booking's current values and nothing else:
 * "your booking has been updated", followed by where and when it now is. A
 * recipient who could not remember the old details -- which is most of them, for
 * a booking made weeks earlier -- had no way to tell what an administrator had
 * actually done, or whether it mattered to them (issue #79).
 */
export interface BookingChange {
  label: string
  from: string
  to: string
}

/** Shown in place of a value that was never set, so a row never reads as blank. */
const EMPTY = '—'

export function formatTime(timeStr: string | null | undefined): string {
  if (!timeStr) return EMPTY
  const [hours, minutes] = timeStr.split(':').map(Number)
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return EMPTY
  const ampm = hours >= 12 ? 'PM' : 'AM'
  const h = hours % 12 || 12
  return `${h}:${minutes.toString().padStart(2, '0')} ${ampm}`
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return EMPTY
  const d = new Date(dateStr + 'T00:00:00')
  if (Number.isNaN(d.getTime())) return EMPTY
  return d.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })
}

export function formatText(v: string | null | undefined): string {
  const s = (v ?? '').toString().trim()
  return s ? sanitize(s) : EMPTY
}

/**
 * A change row, or null when the field did not actually move.
 *
 * Comparison is on the formatted strings rather than the raw values, so
 * '17:00' and '17:00:00' -- which Postgres and the booking forms disagree about
 * -- do not show up as a change from 5:00 PM to 5:00 PM. The same goes for null
 * against '', which the forms produce interchangeably for a cleared field.
 */
export function changed(
  label: string,
  from: string | null | undefined,
  to: string | null | undefined,
  format: (v: string | null | undefined) => string = formatText
): BookingChange | null {
  const a = format(from)
  const b = format(to)
  return a === b ? null : { label, from: a, to: b }
}

/** Drops the fields that did not move. */
export function collectChanges(...items: (BookingChange | null)[]): BookingChange[] {
  return items.filter((c): c is BookingChange => c !== null)
}

/**
 * Renders the change list for the two bodies of the email.
 *
 * Returns null when nothing comparable moved -- an edit can touch only fields
 * this does not track (an occurrence's senate type, say, or the body a booking
 * is filed under), and inventing a "What changed" section that lists nothing
 * would be worse than leaving it out. The email then reads as it did before, as
 * a statement of where the booking now stands.
 */
export function renderChanges(changes: BookingChange[]): { text: string; html: string } | null {
  if (!changes.length) return null

  const text = changes
    .map(c => `- ${sanitize(c.label)}: ${c.from} → ${c.to}`)
    .join('\n')

  const html = `
    <p style="margin:0 0 8px;font-weight:bold;">What changed</p>
    <table cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;width:100%;">
      ${changes.map(c => `
        <tr>
          <td style="padding:4px 12px 4px 0;color:#555;vertical-align:top;white-space:nowrap;">${sanitize(c.label)}</td>
          <td style="padding:4px 0;color:#1a1a1a;">
            <span style="color:#888;text-decoration:line-through;">${c.from}</span>
            <span style="color:#888;">&nbsp;&rarr;&nbsp;</span>
            <strong>${c.to}</strong>
          </td>
        </tr>`).join('')}
    </table>`

  return { text, html }
}
