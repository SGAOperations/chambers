import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { fetchUserAlerts } from '@/lib/dashboard-data'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// Edge: on the dashboard first-paint path (the notification bell reads alerts
// via /api/dashboard; this route still serves the dismiss actions). Was
// cold-starting at ~1s on Node. Both handlers are fetch-only.
export const runtime = 'edge'

export async function GET() {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(await fetchUserAlerts(adminSupabase, user.id))
}

export async function PATCH(request: Request) {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
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
