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
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data, error } = await adminSupabase
    .from('app_settings')
    .select('min_days_advance_room, min_days_advance_tabling, min_hours_advance_spaces')
    .eq('id', 1)
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json()
  const { min_days_advance_room, min_days_advance_tabling, min_hours_advance_spaces } = body

  if (
    !Number.isInteger(min_days_advance_room) || min_days_advance_room < 0 ||
    !Number.isInteger(min_days_advance_tabling) || min_days_advance_tabling < 0 ||
    !Number.isInteger(min_hours_advance_spaces) || min_hours_advance_spaces < 0
  ) {
    return NextResponse.json({ error: 'Values must be non-negative integers.' }, { status: 400 })
  }

  const { error } = await adminSupabase
    .from('app_settings')
    .update({ min_days_advance_room, min_days_advance_tabling, min_hours_advance_spaces })
    .eq('id', 1)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
