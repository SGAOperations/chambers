import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

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

  const { data: requests, error } = await adminSupabase
    .from('room_requests')
    .select(`
      id, type, purpose, status, notes, created_at, body_id, scope, division,
      bodies(name),
      room_request_details(room_name, start_date, start_time, end_time, end_date),
      tabling_request_sessions(session_date, start_time, end_time),
      user_alerts(denial_reason),
      room_request_bodies(body_id, bodies(name))
    `)
    .eq('requested_by', user.id)
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ requests: requests || [] })
}
