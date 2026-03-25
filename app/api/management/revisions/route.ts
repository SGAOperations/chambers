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

  const { data: revisions } = await supabase
    .from('revision_requests')
    .select(`
      id, change_type, new_start_time, new_end_time, new_room, more_info, status, created_at,
      bookings(id, type, purpose, bodies(name)),
      users(full_name)
    `)
    .eq('status', 'Pending')
    .order('created_at', { ascending: false })

  return NextResponse.json({ revisions: revisions || [] })
}
