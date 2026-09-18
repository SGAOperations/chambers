import type { SupabaseClient } from '@supabase/supabase-js'
import { changed, collectChanges, type BookingChange } from '@/lib/emails/changes'

/**
 * Building the Audit tab's entries (issue #120).
 *
 * The log used to be one row per save holding a single status, taken from the
 * booking as a whole -- the first session of a one-time booking, a comma-joined
 * list for tabling, the series for weekly. Once bookings grew sessions and
 * per-week overrides that said nothing useful: an edit that cancelled one week of
 * a fourteen-week series logged "Reserved", the series' status, and nothing
 * about the week.
 *
 * Each entry now names what it is about -- the whole booking, the weekly series,
 * one week, or one session -- and carries the fields that actually changed, as
 * the same "from -> to" strings the update email uses. A save that touches three
 * weeks writes three entries.
 */

/** What an entry is about. */
export type AuditTarget = 'booking' | 'series' | 'occurrence' | 'session'

/** What happened to it. */
export type AuditAction = 'created' | 'updated' | 'added' | 'removed' | 'cancelled' | 'dismissed'

export interface AuditRow {
  booking_id: string
  admin_id: string
  /**
   * The target's status after the change. Still required by the column, and
   * still what the entry's badge shows, but now the status of the thing the
   * entry names rather than a stand-in for the whole booking.
   */
  new_status: string
  target: AuditTarget
  /** The week's or session's date; null for the booking or series as a whole. */
  target_date: string | null
  action: AuditAction
  /** The fields that moved. Null where there is nothing to diff, e.g. on creation. */
  changes: BookingChange[] | null
}

/**
 * Writes `rows` in one insert and returns the first one's id, or null.
 *
 * One insert so every entry from a single save shares its created_at -- now() is
 * fixed for the statement -- which is what lets the Audit tab show them as one
 * action. The id is for user_alerts, which links each alert to an audit row.
 *
 * Best effort, like every audit write before it: the booking is already saved,
 * and failing the request over the log would invite a second, duplicate save.
 */
export async function insertAuditRows(
  db: SupabaseClient,
  rows: AuditRow[],
): Promise<string | null> {
  if (!rows.length) return null
  const { data, error } = await db.from('audit_logs').insert(rows).select('id')
  if (error) {
    console.error('Audit log write failed:', error)
    return null
  }
  return (data as { id: string }[] | null)?.[0]?.id ?? null
}

/** One comparable field of a session-like row. */
export interface AuditField<T> {
  label: string
  get: (row: T) => string | boolean | null | undefined
  format?: (value: string | null | undefined) => string
}

/**
 * The changes between two versions of one row, over `fields`.
 *
 * Booleans are rendered through each field's own formatter as strings first, so
 * `changed()` -- which compares formatted text, and so already ignores
 * '17:00' against '17:00:00' -- can treat them like everything else.
 */
export function diffFields<T>(prev: T, next: T, fields: AuditField<T>[]): BookingChange[] {
  const asText = (v: string | boolean | null | undefined) =>
    typeof v === 'boolean' ? String(v) : v
  return collectChanges(
    ...fields.map(f => changed(f.label, asText(f.get(prev)), asText(f.get(next)), f.format))
  )
}

/**
 * Lines up two lists of dated sessions whose ids cannot be trusted to match.
 *
 * Tabling still replaces its sessions wholesale on every save, so a session's id
 * says nothing about which earlier session it was. The date is the next best
 * thing: sessions on the same day are paired in start-time order, and whatever
 * is left over on either side was added or removed. A session moved to another
 * day therefore reads as one removed and one added, which is true to what the
 * admin did.
 */
export function pairByDate<T>(
  prev: T[],
  next: T[],
  dateOf: (row: T) => string,
  startOf: (row: T) => string,
): { date: string; prev?: T; next?: T }[] {
  const byDate = (rows: T[]) => {
    const m = new Map<string, T[]>()
    for (const r of rows) {
      const list = m.get(dateOf(r)) ?? []
      list.push(r)
      m.set(dateOf(r), list)
    }
    for (const list of m.values()) list.sort((a, b) => startOf(a).localeCompare(startOf(b)))
    return m
  }
  const p = byDate(prev)
  const n = byDate(next)
  const out: { date: string; prev?: T; next?: T }[] = []
  for (const date of [...new Set([...p.keys(), ...n.keys()])].sort()) {
    const a = p.get(date) ?? []
    const b = n.get(date) ?? []
    for (let i = 0; i < Math.max(a.length, b.length); i++) out.push({ date, prev: a[i], next: b[i] })
  }
  return out
}

/** For a weekly visibility override: null inherits the booking's. */
export function formatVisibility(v: string | null | undefined): string {
  if (v === 'true') return 'Hidden'
  if (v === 'false') return 'Visible'
  return 'Same as booking'
}

/** For a weekly event flag, which is not an override: absent means not an event. */
export function formatEvent(v: string | null | undefined): string {
  return v === 'true' ? 'Event' : 'Not an event'
}
