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
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data } = await adminSupabase
    .from('user_alerts')
    .select('id, booking_id, booking_type, booking_date, start_time, created_at, bookings!booking_id(bodies(name))')
    .eq('user_id', user.id)
    .eq('dismissed', false)
    .order('created_at', { ascending: false })

  return NextResponse.json(data || [])
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()

  if (body.all) {
    await adminSupabase
      .from('user_alerts')
      .update({ dismissed: true })
      .eq('user_id', user.id)
  } else {
    await adminSupabase
      .from('user_alerts')
      .update({ dismissed: true })
      .eq('id', body.id)
      .eq('user_id', user.id)
  }

  return NextResponse.json({ success: true })
}
