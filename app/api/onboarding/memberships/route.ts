import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('users')
    .select('has_completed_onboarding')
    .eq('id', user.id)
    .single()

  if (profile?.has_completed_onboarding) {
    return NextResponse.json({ error: 'Onboarding already completed' }, { status: 403 })
  }

  // If the user already has any memberships (e.g. admin-assigned Leadership roles),
  // skip self-assignment to avoid unique constraint violations on (user_id, body_id).
  const { count } = await adminSupabase
    .from('board_memberships')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)

  if (count && count > 0) {
    return NextResponse.json({ success: true })
  }

  const { body_ids } = await request.json()

  // Remove existing Member-level memberships before re-inserting (idempotent)
  await adminSupabase
    .from('board_memberships')
    .delete()
    .eq('user_id', user.id)
    .eq('role', 'Member')

  if (Array.isArray(body_ids) && body_ids.length > 0) {
    const rows = body_ids.map((body_id: string) => ({
      user_id: user.id,
      body_id,
      role: 'Member' as const,
    }))

    const { error } = await adminSupabase
      .from('board_memberships')
      .insert(rows)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
