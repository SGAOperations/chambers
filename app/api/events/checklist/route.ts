import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || (!user.app_metadata?.is_admin && !user.app_metadata?.iems_role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, step, checked } = await request.json()

  if (!booking_id || !step || typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (step !== 'event_management_form' && step !== 'engage_form') {
    return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  }

  const { error } = await adminSupabase
    .from('event_tracking')
    .upsert(
      { booking_id, [step]: checked, updated_at: new Date().toISOString() },
      { onConflict: 'booking_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
