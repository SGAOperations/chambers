import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const booking_id = searchParams.get('booking_id')
  if (!booking_id) return NextResponse.json({ logs: [] })

  const { data: logs } = await adminSupabase
    .from('audit_logs')
    .select('id, new_status, created_at, users!admin_id(full_name, admin_role)')
    .eq('booking_id', booking_id)
    .order('created_at', { ascending: true })

  return NextResponse.json({ logs: logs || [] })
}
