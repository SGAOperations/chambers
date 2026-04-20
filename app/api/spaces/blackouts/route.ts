import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

function minutesOf(iso: string): number {
  return new Date(iso).getUTCMinutes()
}

function touchesDeadZone(startIso: string, endIso: string): boolean {
  const etOffset = -5 * 60
  const startLocal = new Date(new Date(startIso).getTime() + etOffset * 60000)
  const endLocal = new Date(new Date(endIso).getTime() + etOffset * 60000)
  const startHour = startLocal.getUTCHours() + startLocal.getUTCMinutes() / 60
  const endHour = endLocal.getUTCHours() + endLocal.getUTCMinutes() / 60
  if (startHour < 7) return true
  if (endHour > 0 && endHour <= 7 && endHour < startHour) return true
  const durationMs = new Date(endIso).getTime() - new Date(startIso).getTime()
  if (durationMs >= 17 * 60 * 60 * 1000) return true
  return false
}

export async function GET(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const spaceId = searchParams.get('space_id')

  let query = adminSupabase.from('space_blackouts').select('*, spaces(name)').order('start_time')
  if (spaceId) query = query.eq('space_id', spaceId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { space_id, start_time, end_time } = await request.json()

  if (!start_time || !end_time) {
    return NextResponse.json({ error: 'start_time and end_time are required' }, { status: 400 })
  }

  if (new Date(start_time) >= new Date(end_time)) {
    return NextResponse.json({ error: 'Start time must be before end time.' }, { status: 400 })
  }

  if (minutesOf(start_time) % 15 !== 0 || minutesOf(end_time) % 15 !== 0) {
    return NextResponse.json({ error: 'Blackout times must be on 15-minute intervals.' }, { status: 400 })
  }

  // Admins cannot create blackouts that cover the dead zone — the dead zone is already blocked
  // but we enforce the rule that blackouts themselves cannot span into 12am–7am
  if (touchesDeadZone(start_time, end_time)) {
    return NextResponse.json({ error: 'Blackouts may not include the 12:00 AM – 7:00 AM window (already blocked).' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('space_blackouts')
    .insert({ space_id: space_id || null, start_time, end_time, created_by: user.id })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ success: true, blackout: data })
}
