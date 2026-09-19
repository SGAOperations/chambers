import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'

const adminSupabase = db

export async function GET(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Management-page endpoint: being an admin is not enough (#64).
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { searchParams } = new URL(request.url)
  const booking_id = searchParams.get('booking_id')
  if (!booking_id) return NextResponse.json({ logs: [] })

  const { data: logs } = await adminSupabase
    .from('audit_logs')
    // target, target_date, action and changes are issue #120's detail; they are
    // null on entries written before it, which the tab shows as they always were.
    .select('id, new_status, created_at, target, target_date, action, changes, users!admin_id(full_name, admin_role)')
    .eq('booking_id', booking_id)
    // Newest first: the question the tab is opened with is almost always "what
    // just happened to this booking".
    .order('created_at', { ascending: false })
    .order('target_date', { ascending: true, nullsFirst: true })

  return NextResponse.json({ logs: logs || [] })
}
