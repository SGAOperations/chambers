import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { body_id } = await request.json()

  const { data: body } = await adminSupabase
    .from('bodies')
    .select('id, body_open')
    .eq('id', body_id)
    .eq('is_active', true)
    .single()

  if (!body) return NextResponse.json({ error: 'Body not found' }, { status: 404 })

  if (body.body_open) {
    const { error } = await adminSupabase
      .from('board_memberships')
      .insert({ user_id: user.id, body_id, role: 'Member' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    const { error } = await adminSupabase
      .from('membership_requests')
      .insert({ user_id: user.id, body_id, status: 'pending' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id, request_id } = await request.json()

  if (request_id) {
    const { data: req } = await adminSupabase
      .from('membership_requests')
      .select('id, user_id')
      .eq('id', request_id)
      .single()

    if (!req || req.user_id !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { error } = await adminSupabase
      .from('membership_requests')
      .delete()
      .eq('id', request_id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else if (id) {
    const { data: membership } = await adminSupabase
      .from('board_memberships')
      .select('id, user_id')
      .eq('id', id)
      .single()

    if (!membership || membership.user_id !== user.id) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    }

    const { error } = await adminSupabase
      .from('board_memberships')
      .delete()
      .eq('id', id)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  } else {
    return NextResponse.json({ error: 'Must provide id or request_id' }, { status: 400 })
  }

  return NextResponse.json({ success: true })
}
