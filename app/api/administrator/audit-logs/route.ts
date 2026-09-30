import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'

const adminSupabase = db

export async function GET(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Management-page endpoint: being an admin is not enough (#64).
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { searchParams } = new URL(request.url)
  const booking_id = searchParams.get('booking_id')
  if (!booking_id) return NextResponse.json({ logs: [] })

  // Narrow the log to actions that came from somewhere other than Chambers'
  // own admin UI (issue #188). Only 'nusso' exists, and anything else is
  // ignored rather than 400'd: a stray value should not empty the tab.
  const nussoOnly = searchParams.get('source') === 'nusso'

  // target, target_date, action and changes are issue #120's detail; they are
  // null on entries written before it, which the tab shows as they always were.
  // admin_role is the author's office frozen at write time; users.admin_role
  // comes along as the live fallback for entries written before that column.
  const BASE_COLUMNS = 'id, new_status, created_at, target, target_date, action, changes, users!admin_id(full_name, admin_role)'

  // Columns added after BASE_COLUMNS' were cached, newest first, dropped one at
  // a time on failure -- see lib/audit.ts, which writes them the same way and
  // for the same reason.
  const NEWER_COLUMNS = ['source', 'admin_role']

  const entriesQuery = (columns: string) => {
    let q = adminSupabase
      .from('audit_logs')
      .select(columns)
      .eq('booking_id', booking_id)
    // Only applied when asked for. That keeps the default read -- the one the
    // tab does on every open -- clear of the newer column, so it still falls
    // back to the older column list below and shows the full history. When the
    // filter *is* asked for before the schema cache has been refreshed there is
    // no falling back to do: filtering on a column the Data API cannot see
    // returns nothing, which is the honest answer to "show me NUSSO's actions"
    // from a deployment that is not yet recording them.
    if (nussoOnly) q = q.eq('source', 'nusso')
    return q
      // Newest first: the question the tab is opened with is almost always "what
      // just happened to this booking".
      .order('created_at', { ascending: false })
      .order('target_date', { ascending: true, nullsFirst: true })
  }

  // The purpose and booked_via_nusso come back alongside the entries: the
  // purpose because it leads every one of them on screen -- an entry then names
  // its booking on its own line, rather than only through the selector above the
  // list -- and the flag because a NUSSO booking's log should say so at the top
  // even when the entries themselves predate `source` (issue #188). Both reads
  // go out together.
  const [entries, { data: booking }] = await Promise.all([
    entriesQuery(`${BASE_COLUMNS}, ${NEWER_COLUMNS.join(', ')}`),
    adminSupabase
      .from('bookings').select('purpose, booked_via_nusso').eq('id', booking_id).maybeSingle(),
  ])

  // source and admin_role are newer columns, and the Data API only sees one once
  // its schema cache has been refreshed (db/neon/README.md). Deployed ahead of
  // that refresh the select above is rejected outright, which would empty the
  // tab rather than merely un-badge it. Asking again with progressively fewer of
  // them keeps the history readable until the cache catches up, and costs only
  // the newest column rather than every column added since the baseline.
  let logs = entries.data
  let error = entries.error
  for (let drop = 1; error && drop <= NEWER_COLUMNS.length; drop++) {
    const columns = [BASE_COLUMNS, ...NEWER_COLUMNS.slice(drop)].join(', ')
    console.error(`Audit log read failed; retrying without ${NEWER_COLUMNS.slice(0, drop).join(', ')}:`, error)
    const retry = await entriesQuery(columns)
    logs = retry.data
    error = retry.error
  }

  return NextResponse.json({
    logs: logs || [],
    purpose: booking?.purpose ?? null,
    bookedViaNusso: !!booking?.booked_via_nusso,
  })
}
