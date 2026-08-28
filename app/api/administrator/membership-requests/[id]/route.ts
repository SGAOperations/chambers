import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await params
  const { status } = await request.json()

  if (status !== 'approved' && status !== 'denied') {
    return NextResponse.json({ error: 'Invalid status.' }, { status: 400 })
  }

  const { data: requestRow, error: fetchError } = await adminSupabase
    .from('membership_requests')
    .select('user_id, body_id')
    .eq('id', id)
    .single()

  if (fetchError || !requestRow) {
    return NextResponse.json({ error: 'Request not found.' }, { status: 404 })
  }

  const { error: updateError } = await adminSupabase
    .from('membership_requests')
    .update({ status, resolved_at: new Date().toISOString(), resolved_by: user.id })
    .eq('id', id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  if (status === 'approved') {
    const { error: membershipError } = await adminSupabase
      .from('board_memberships')
      .upsert({ user_id: requestRow.user_id, body_id: requestRow.body_id, role: 'Member' }, { onConflict: 'user_id,body_id' })

    if (membershipError) return NextResponse.json({ error: membershipError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
