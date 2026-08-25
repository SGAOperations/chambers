import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'

export async function GET(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { searchParams } = new URL(request.url)
  const type = searchParams.get('type')
  const body_id = searchParams.get('body_id')

  if (!type || !body_id) return NextResponse.json({ error: 'Type and body_id required' }, { status: 400 })

  const { data: bookings } = await supabase
    .from('bookings')
    .select(`
      id, purpose,
      bodies(name)
    `)
    .eq('type', type)
    .eq('body_id', body_id)
    .is('request_id', null)
    .order('created_at', { ascending: false })

  return NextResponse.json({ bookings: bookings || [] })
}