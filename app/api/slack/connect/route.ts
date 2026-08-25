import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getAuthedUser } from '@/lib/auth'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const token = searchParams.get('token')

  if (!token) {
    return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 400 })
  }

  const { data } = await adminSupabase
    .from('slack_connect_tokens')
    .select('slack_user_id')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!data) {
    return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 400 })
  }

  return NextResponse.json({ slack_user_id: data.slack_user_id })
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const user = await getAuthedUser(supabase)
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { token } = await request.json()

  if (!token) {
    return NextResponse.json({ error: 'Missing required fields.' }, { status: 400 })
  }

  const { data: tokenRow } = await adminSupabase
    .from('slack_connect_tokens')
    .select('id, slack_user_id')
    .eq('token', token)
    .gt('expires_at', new Date().toISOString())
    .maybeSingle()

  if (!tokenRow) {
    return NextResponse.json({ error: 'Invalid or expired token.' }, { status: 400 })
  }

  const { error: upsertError } = await adminSupabase
    .from('slack_connections')
    .upsert(
      { slack_user_id: tokenRow.slack_user_id, chambers_user_id: user.id },
      { onConflict: 'slack_user_id' }
    )

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to link account.' }, { status: 500 })
  }

  await adminSupabase
    .from('slack_connect_tokens')
    .delete()
    .eq('id', tokenRow.id)

  return NextResponse.json({ success: true })
}
