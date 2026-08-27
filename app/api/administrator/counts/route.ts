import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { fetchPendingCounts } from '@/lib/dashboard-data'

// Edge: this route is on the dashboard's first-paint path (via /api/dashboard,
// and here for the Administrator page's targeted refreshes) and was measured
// cold-starting at ~1.1s on the Node runtime. Everything it touches
// (@supabase/ssr, Upstash, getClaims/WebCrypto) runs on edge, where cold start
// is ~10-20ms.
export const runtime = 'edge'

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  return NextResponse.json(await fetchPendingCounts(supabase))
}
