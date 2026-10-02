import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { fetchUserAlerts } from '@/lib/dashboard-data'
import { fetchPendingActions, type PendingActionsResult } from '@/lib/pending-actions'
import { canWriteAdmin } from '@/lib/admin-roles'

// One call for the dashboard shell -- admin pending-action counts (null for
// non-admins) plus the caller's alerts. Replaces the separate
// /api/administrator/counts + /api/alerts fetches that ran on every dashboard
// first paint. No rate-limit check here: it's one request per page load, the
// middleware already gates it, and /api/alerts (which this replaces on the read
// path) never had one -- adding it only cost a cold Upstash round trip on the
// paint path.
const adminSupabase = db

export async function GET() {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // A view-only admin is counted out here with the non-admins (#217). Every
  // pending action is a task on a tab they cannot open -- a request to triage, a
  // cancellation to decide -- so the badge would only ever be a number they
  // could not act on, and the sidebar would be advertising work that is not
  // theirs.
  const hasTasks =
    !!user.app_metadata?.is_admin && canWriteAdmin(user.app_metadata?.admin_role)

  const [counts, alerts] = await Promise.all([
    hasTasks
      ? fetchPendingActions(adminSupabase, { adminRole: user.app_metadata?.admin_role ?? null })
      : Promise.resolve<PendingActionsResult | null>(null),
    fetchUserAlerts(adminSupabase, user.id),
  ])

  return NextResponse.json({ counts, alerts })
}
