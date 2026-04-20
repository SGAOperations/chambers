import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data, error } = await adminSupabase
    .from('space_weekly_limit_overrides')
    .select('*, users!space_weekly_limit_overrides_user_id_fkey(id, full_name, email)')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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
