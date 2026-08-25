import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const [
    { count: requestCount },
    { count: cancellationCount },
    { count: revisionCount },
    { count: membershipRequestCount },
  ] = await Promise.all([
    supabase.from('room_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('cancellation_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('revision_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('membership_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  return NextResponse.json({
    requests: requestCount || 0,
    cancellations: cancellationCount || 0,
    revisions: revisionCount || 0,
    membership_requests: membershipRequestCount || 0,
    total: (requestCount || 0) + (cancellationCount || 0) + (revisionCount || 0) + (membershipRequestCount || 0),
  })
}