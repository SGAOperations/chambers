import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: profile, error } = await adminSupabase
    .from('users')
    .select('full_name, email_preferences, admin_role, iems_role, board_memberships(id, role, bodies(id, name, division))')
    .eq('id', user.id)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: pendingRequests } = await adminSupabase
    .from('membership_requests')
    .select('id, bodies(id, name, division)')
    .eq('user_id', user.id)
    .eq('status', 'pending')

  const { data: allBodies } = await adminSupabase
    .from('bodies')
    .select('id, name, division, body_open')
    .eq('is_active', true)
    .neq('division', 'Non-Divisional')
    .order('name', { ascending: true })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeMemberBodyIds = new Set((profile.board_memberships ?? []).map((m: any) => (m.bodies as { id: string } | null)?.id).filter(Boolean))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingBodyIds = new Set((pendingRequests ?? []).map((r: any) => (r.bodies as { id: string } | null)?.id).filter(Boolean))

  const availableBodies = (allBodies ?? []).filter(
    (b: { id: string }) => !activeMemberBodyIds.has(b.id) && !pendingBodyIds.has(b.id)
  )

  return NextResponse.json({
    full_name: profile.full_name,
    email_preferences: profile.email_preferences,
    admin_role: profile.admin_role,
    iems_role: profile.iems_role,
    memberships: profile.board_memberships ?? [],
    pending_requests: pendingRequests ?? [],
    available_bodies: availableBodies,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json()
  const { full_name, email_preferences } = body

  if (full_name !== undefined && (typeof full_name !== 'string' || full_name.trim() === '')) {
    return NextResponse.json({ error: 'full_name must be a non-empty string' }, { status: 400 })
  }

  if (
    email_preferences !== undefined &&
    (typeof email_preferences !== 'object' || Array.isArray(email_preferences) || email_preferences === null)
  ) {
    return NextResponse.json({ error: 'email_preferences must be a plain object' }, { status: 400 })
  }

  const updates: Record<string, unknown> = {}
  if (full_name !== undefined) updates.full_name = full_name.trim()
  if (email_preferences !== undefined) updates.email_preferences = email_preferences

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  if (updates.full_name) {
    await adminSupabase.auth.admin.updateUserById(user.id, {
      user_metadata: { full_name: updates.full_name },
    })
  }

  const { error } = await adminSupabase.from('users').update(updates).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
