import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { canWriteAdmin } from '@/lib/admin-roles'

export async function GET(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Closed to a view-only admin, who may read Bookings and nothing else (#217).
  if (!canWriteAdmin(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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