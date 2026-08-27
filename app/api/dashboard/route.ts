import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { fetchPendingCounts, fetchUserAlerts, type Counts } from '@/lib/dashboard-data'

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

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const isAdmin = !!user.app_metadata?.is_admin

  const [counts, alerts] = await Promise.all([
    isAdmin ? fetchPendingCounts(supabase) : Promise.resolve<Counts | null>(null),
    fetchUserAlerts(adminSupabase, user.id),
  ])

  return NextResponse.json({ counts, alerts })
}
