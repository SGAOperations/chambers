import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { fetchPendingCounts, fetchUserAlerts, type Counts } from '@/lib/dashboard-data'

// One call for the dashboard shell -- admin pending-action counts (null for
// non-admins) plus the caller's alerts. Replaces the separate
// /api/administrator/counts + /api/alerts fetches that ran on every dashboard
// first paint, each its own serverless cold-start risk. Edge for the same
// reason as the routes it consolidates.
export const runtime = 'edge'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const isAdmin = !!user.app_metadata?.is_admin

  const [counts, alerts] = await Promise.all([
    isAdmin ? fetchPendingCounts(supabase) : Promise.resolve<Counts | null>(null),
    fetchUserAlerts(adminSupabase, user.id),
  ])

  return NextResponse.json({ counts, alerts })
}
