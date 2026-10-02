import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { canWriteAdmin } from '@/lib/admin-roles'
import { fetchPendingActions } from '@/lib/pending-actions'

const adminSupabase = db

export async function GET() {
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

  return NextResponse.json(
    await fetchPendingActions(adminSupabase, {
      adminRole: user.app_metadata?.admin_role ?? null,
    })
  )
}
