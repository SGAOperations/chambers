import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { count: requestCount } = await supabase
    .from('room_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Pending')

  const { count: cancellationCount } = await supabase
    .from('cancellation_requests')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'Pending')

  return NextResponse.json({
    requests: requestCount || 0,
    cancellations: cancellationCount || 0,
    total: (requestCount || 0) + (cancellationCount || 0),
  })
}