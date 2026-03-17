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

  // Get bodies where user has Leadership role
  const { data: memberships } = await supabase
    .from('board_memberships')
    .select('body_id, bodies(id, name)')
    .eq('user_id', user.id)
    .eq('role', 'Leadership')

  const bodies = memberships?.map(m => m.bodies).filter(Boolean) || []

  return NextResponse.json({ bodies })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { type, body_id, purpose, notes, details, sessions } = body

  // Verify user has Leadership role in the submitted body_id
  const { data: membership } = await supabase
    .from('board_memberships')
    .select('id')
    .eq('user_id', user.id)
    .eq('body_id', body_id)
    .eq('role', 'Leadership')
    .maybeSingle()

  if (!membership) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 403 })
  }

  // Create the request
  const { data: roomRequest, error: requestError } = await adminSupabase
    .from('room_requests')
    .insert({
      type,
      body_id,
      purpose,
      notes: notes || null,
      requested_by: user.id,
      status: 'Pending',
    })
    .select()
    .single()

  if (requestError) return NextResponse.json({ error: requestError.message }, { status: 500 })

  // Insert type-specific details
  if (type === 'One-Time Room' || type === 'Weekly Room') {
    const { error: detailError } = await adminSupabase
      .from('room_request_details')
      .insert({
        request_id: roomRequest.id,
        room_name: details.room_name || null,
        start_date: details.start_date,
        start_time: details.start_time,
        end_time: details.end_time,
        end_date: details.end_date || null,
      })

    if (detailError) return NextResponse.json({ error: detailError.message }, { status: 500 })
  }

  if (type === 'Tabling') {
    const sessionRows = sessions.map((s: {
      session_date: string
      start_time: string
      end_time: string
    }) => ({
      request_id: roomRequest.id,
      session_date: s.session_date,
      start_time: s.start_time,
      end_time: s.end_time,
    }))

    const { error: sessionError } = await adminSupabase
      .from('tabling_request_sessions')
      .insert(sessionRows)

    if (sessionError) return NextResponse.json({ error: sessionError.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}