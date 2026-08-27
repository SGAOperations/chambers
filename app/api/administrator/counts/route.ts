import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { fetchPendingCounts } from '@/lib/dashboard-data'

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
