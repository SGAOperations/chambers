import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { fetchUserAlerts } from '@/lib/dashboard-data'

const adminSupabase = db

export async function GET() {
  const supabase = db
  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json(await fetchUserAlerts(adminSupabase, user.id))
}

export async function PATCH(request: Request) {
  const supabase = db
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
