import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { fetchUserAlerts } from '@/lib/dashboard-data'
import { fetchPendingActions, type PendingActionsResult } from '@/lib/pending-actions'

// One call for the dashboard shell -- admin pending-action counts (null for
// non-admins) plus the caller's alerts. Replaces the separate
// /api/administrator/counts + /api/alerts fetches that ran on every dashboard
// first paint. No rate-limit check here: it's one request per page load, the
// middleware already gates it, and /api/alerts (which this replaces on the read
// path) never had one -- adding it only cost a cold Upstash round trip on the
// paint path.
const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = !!user.app_metadata?.is_admin

  const [counts, alerts] = await Promise.all([
    isAdmin
      ? fetchPendingActions(adminSupabase, { adminRole: user.app_metadata?.admin_role ?? null })
      : Promise.resolve<PendingActionsResult | null>(null),
    fetchUserAlerts(adminSupabase, user.id),
  ])

  return NextResponse.json({ counts, alerts })
}
