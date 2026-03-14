import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function GET() {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: requests } = await supabase
    .from('room_requests')
    .select(`
      id, type, purpose, status, notes, created_at,
      bodies(name),
      users(full_name),
      room_request_details(room_name, start_date, start_time, end_time, end_date),
      tabling_request_sessions(session_date, start_time, end_time)
    `)
    .order('created_at', { ascending: false })

  return NextResponse.json({ requests: requests || [] })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, status } = await request.json()

  const { error } = await supabase
    .from('room_requests')
    .update({ status })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}