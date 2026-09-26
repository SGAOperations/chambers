import type { Db } from './db/data-api'
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
   * The author's admin role as it was when the entry was written. Callers leave
   * it unset and insertAuditRows() resolves it; pass it only to override.
   */
  admin_role?: string | null
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
 * The admin_role each of `adminIds` holds right now, for stamping onto entries.
 *
 * One query however many rows are being written, since a save is nearly always
 * the work of a single person. A miss -- an author with no admin role, such as
 * body Leadership booking through Browse/Book NUSSO -- is left null rather than
 * guessed at; their name is still on the entry through admin_id.
 */
async function currentRoles(db: Db, adminIds: string[]): Promise<Map<string, string | null>> {
  const roles = new Map<string, string | null>()
  if (!adminIds.length) return roles
  const { data, error } = await db.from('users').select('id, admin_role').in('id', adminIds)
  if (error) {
    // Same best-effort posture as the insert below: an unbadged entry beats a
    // lost one, and the tab still falls back to the live role for a null.
    console.error('Audit log role lookup failed:', error)
    return roles
  }
  for (const u of (data as { id: string; admin_role: string | null }[] | null) ?? []) {
    roles.set(u.id, u.admin_role ?? null)
  }
  return roles
}

/**
 * Writes `rows` in one insert and returns the first one's id, or null.
 *
 * One insert so every entry from a single save shares its created_at -- now() is
 * fixed for the statement -- which is what lets the Audit tab show them as one
 * action. The id is for user_alerts, which links each alert to an audit row.
 *
 * Each row is stamped with its author's role as it is now, so the Audit tab can
 * show the office held when the action happened rather than the one held today.
 * Resolving it here rather than at the call sites keeps all eight of them, and
 * every future one, correct without having to remember to pass it.
 *
 * Best effort, like every audit write before it: the booking is already saved,
 * and failing the request over the log would invite a second, duplicate save.
 */
export async function insertAuditRows(
  db: Db,
  rows: AuditRow[],
): Promise<string | null> {
  if (!rows.length) return null

  const needRole = rows.filter(r => r.admin_role === undefined)
  const roles = await currentRoles(db, [...new Set(needRole.map(r => r.admin_id))])
  const stamped = rows.map(r =>
    r.admin_role === undefined ? { ...r, admin_role: roles.get(r.admin_id) ?? null } : r
  )

  const { data, error } = await db.from('audit_logs').insert(stamped).select('id')
  if (!error) return (data as { id: string }[] | null)?.[0]?.id ?? null

  // The one failure worth a second attempt: admin_role is a newer column, and
  // the Data API only sees it once its schema cache has been refreshed
  // (db/neon/README.md). Deployed ahead of that refresh, every audit write here
  // would be rejected and the history simply lost. Retrying without the column
  // costs an unbadged entry instead, and stops mattering the moment the cache
  // catches up.
  console.error('Audit log write failed:', error)
  const { data: retry, error: retryError } = await db
    .from('audit_logs')
    .insert(rows.map(r => {
      const bare: AuditRow = { ...r }
      delete bare.admin_role
      return bare
    }))
    .select('id')
  if (retryError) {
    console.error('Audit log write failed without admin_role too:', retryError)
    return null
  }
  return (retry as { id: string }[] | null)?.[0]?.id ?? null
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
