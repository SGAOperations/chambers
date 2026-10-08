import { db } from './db/data-api'
import { todayInAppZone } from './app-zone'
import { formatScopeLabel, type BookingScope, type Division } from './booking-scope'
import { OPS_REVIEW } from './request-status'

const adminSupabase = db

/** One date a tabling request asks CSC to reserve. */
export interface TablingRequestSession {
  date: string
  startTime: string
  endTime: string
  /** The requester's preferred spot. Null when not asked for -- Slack, or before issue #164. */
  location: string | null
  tables: number | null
}

/**
 * A tabling request Auto-Request can send to CSC (issue #226).
 *
 * The unit is the request, not the session. Status lives on the request, and
 * Auto-Request moves it to Awaiting CSC once CSC has been asked -- sending two
 * of a request's three dates would leave it claiming to be with CSC while one
 * date never went. So a selected request goes whole.
 */
export interface TablingRequestLine {
  /** room_requests.id, which is also how the browser selects it. */
  id: string
  requestedBy: string | null
  requesterName: string
  /** Who the request is for, as the Requests tab names it. */
  bodyName: string
  purpose: string
  createdAt: string
  /** Upcoming sessions only, in date order. These are what go to CSC. */
  sessions: TablingRequestSession[]
  /** Sessions already past, which are left out of the email. Counted so the admin can see it. */
  pastSessions: number
  /**
   * When Chambers last emailed CSC for this request, if it ever has. Set on a
   * request that was sent and then moved back to Ops Review -- the one case
   * where sending again is probably a mistake, and worth seeing first.
   */
  previouslySentAt: string | null
  previouslySentBy: string | null
}

/** In Ops Review, but with nothing left to ask CSC for: every date is past. */
export interface SkippedTablingRequest {
  id: string
  bodyName: string
  purpose: string
  lastDate: string | null
}

export interface RequestableTabling {
  lines: TablingRequestLine[]
  skipped: SkippedTablingRequest[]
}

interface RawRequest {
  id: string
  body_id: string
  purpose: string
  scope: BookingScope
  division: Division | null
  created_at: string
  requested_by: string | null
  csc_requested_at: string | null
  csc_requested_by: string | null
  bodies: { name: string } | null
  users: { full_name: string } | null
  room_request_bodies: { body_id: string; bodies: { name: string } | null }[] | null
  tabling_request_sessions: {
    session_date: string
    start_time: string
    end_time: string
    location: string | null
    tables: number | null
  }[] | null
}

/**
 * Splits a request's sessions into the ones CSC can still act on and the ones
 * already gone.
 *
 * Today counts as upcoming. A same-day request is very unlikely to be granted,
 * but that is CSC's call to make, not something to drop quietly here.
 *
 * Pure, and exported, so the boundary can be checked without a database.
 */
export function splitSessions<T extends { session_date: string; start_time?: string }>(
  sessions: T[],
  today: string
): { upcoming: T[]; past: T[] } {
  const upcoming: T[] = []
  const past: T[] = []
  for (const s of sessions) (s.session_date >= today ? upcoming : past).push(s)
  const byDateTime = (a: T, b: T) =>
    `${a.session_date} ${a.start_time ?? ''}`.localeCompare(`${b.session_date} ${b.start_time ?? ''}`)
  return { upcoming: upcoming.sort(byDateTime), past: past.sort(byDateTime) }
}

/**
 * Every tabling request still in Ops Review, for the admin to choose from.
 *
 * Ops Review and not Awaiting CSC, because Awaiting CSC is what this sends a
 * request *to*: one already there has been passed to CSC by some road, and
 * listing it again would invite a second copy in their inbox. A request that
 * was moved back to Ops Review is listed, with the stamp from its last send.
 *
 * Tabling only. Rooms are excluded by the issue, and by the request itself: a
 * room request carries a preferred room the admin usually has to negotiate with
 * CSC rather than simply forward.
 */
export async function collectRequestable(): Promise<RequestableTabling> {
  const { data, error } = await adminSupabase
    .from('room_requests')
    .select(`
      id, body_id, purpose, scope, division, created_at, requested_by,
      csc_requested_at, csc_requested_by,
      bodies(name),
      users(full_name),
      room_request_bodies(body_id, bodies(name)),
      tabling_request_sessions(session_date, start_time, end_time, location, tables)
    `)
    .eq('type', 'Tabling')
    .eq('status', OPS_REVIEW)
    .order('created_at', { ascending: true })

  // Thrown rather than read as "nothing pending". The likeliest cause is the
  // 0016 columns missing from the schema cache, and an empty list would tell the
  // admin there is nothing to send when there is.
  if (error) throw new Error(`Could not load tabling requests: ${error.message}`)

  const rows = (data ?? []) as unknown as RawRequest[]

  const senderIds = [...new Set(rows.map(r => r.csc_requested_by).filter((v): v is string => !!v))]
  const senderNames = new Map<string, string>()
  if (senderIds.length) {
    const { data: users } = await adminSupabase.from('users').select('id, full_name').in('id', senderIds)
    for (const u of (users ?? []) as { id: string; full_name: string | null }[]) {
      if (u.full_name) senderNames.set(u.id, u.full_name)
    }
  }

  const today = todayInAppZone()
  const lines: TablingRequestLine[] = []
  const skipped: SkippedTablingRequest[] = []

  for (const r of rows) {
    const bodyName = formatScopeLabel(
      r,
      (r.room_request_bodies ?? []).map(x => ({ id: x.body_id, name: x.bodies?.name ?? '' }))
    ).short
    const { upcoming, past } = splitSessions(r.tabling_request_sessions ?? [], today)

    if (!upcoming.length) {
      skipped.push({ id: r.id, bodyName, purpose: r.purpose, lastDate: past.at(-1)?.session_date ?? null })
      continue
    }

    lines.push({
      id: r.id,
      requestedBy: r.requested_by,
      requesterName: r.users?.full_name ?? 'Unknown',
      bodyName,
      purpose: r.purpose,
      createdAt: r.created_at,
      sessions: upcoming.map(s => ({
        date: s.session_date,
        startTime: s.start_time,
        endTime: s.end_time,
        location: s.location,
        tables: s.tables,
      })),
      pastSessions: past.length,
      previouslySentAt: r.csc_requested_at,
      previouslySentBy: r.csc_requested_by ? senderNames.get(r.csc_requested_by) ?? 'a former admin' : null,
    })
  }

  // Soonest first: the request with the least notice left is the one CSC most
  // needs to see today.
  lines.sort((a, b) => a.sessions[0].date.localeCompare(b.sessions[0].date))
  return { lines, skipped }
}
