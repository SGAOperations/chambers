import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: overrides, error } = await adminSupabase
    .from('space_weekly_limit_overrides')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!overrides || overrides.length === 0) return NextResponse.json([])

  const userIds = overrides.map((o: { user_id: string }) => o.user_id)
  const { data: users, error: usersError } = await adminSupabase
    .from('users')
    .select('id, full_name, email')
    .in('id', userIds)

  if (usersError) return NextResponse.json({ error: usersError.message }, { status: 500 })

  const usersById = Object.fromEntries((users ?? []).map((u: { id: string; full_name: string; email: string }) => [u.id, u]))
  return NextResponse.json(overrides.map((o: { user_id: string }) => ({ ...o, users: usersById[o.user_id] ?? null })))
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { user_id, weekly_hours_limit } = await request.json()

  if (!user_id || weekly_hours_limit == null) {
    return NextResponse.json({ error: 'user_id and weekly_hours_limit are required' }, { status: 400 })
  }

  if (typeof weekly_hours_limit !== 'number' || weekly_hours_limit < 0) {
    return NextResponse.json({ error: 'weekly_hours_limit must be a non-negative number' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('space_weekly_limit_overrides')
    .upsert({ user_id, weekly_hours_limit, created_by: user.id }, { onConflict: 'user_id' })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, override: data })
}
