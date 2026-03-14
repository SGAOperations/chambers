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
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: users } = await supabase
    .from('users')
    .select(`
      id, email, full_name, admin_role, is_active, created_at,
      board_memberships(
        id, role,
        bodies(id, name, division)
      )
    `)
    .order('full_name', { ascending: true })

  return NextResponse.json({ users: users || [] })
}

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { email, full_name, admin_role } = await request.json()

  // Create auth user with default password
  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    password: 'SGAistheBest',
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  // Set admin metadata if applicable
  if (admin_role) {
    await adminSupabase.auth.admin.updateUserById(authData.user.id, {
      app_metadata: { is_admin: true, admin_role },
    })
  }

  // Update users table with admin_role and full_name (trigger creates the row)
  const { error: updateError } = await adminSupabase
    .from('users')
    .update({ admin_role, full_name })
    .eq('id', authData.user.id)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { id, admin_role, is_active } = await request.json()

  const { error } = await adminSupabase
    .from('users')
    .update({ admin_role, is_active })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update app_metadata if admin role changed
  await adminSupabase.auth.admin.updateUserById(id, {
    app_metadata: {
      is_admin: !!admin_role,
      admin_role: admin_role || null,
    },
  })

  return NextResponse.json({ success: true })
}