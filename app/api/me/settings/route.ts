import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUser } from '@/lib/auth'
import { findSgaEmailOption, isSpacesEmailDestination, loadSgaEmailOptions } from '@/lib/spaces-email'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  // These three reads are independent of each other; running them serially cost
  // two extra round trips per settings-modal open.
  const [
    { data: profile, error },
    { data: pendingRequests },
    { data: allBodies },
    sgaEmailOptions,
  ] = await Promise.all([
    adminSupabase
      .from('users')
      .select('full_name, email, email_preferences, senate_type_preferences, admin_role, iems_role, spaces_email_destination, spaces_sga_email, board_memberships(id, role, bodies(id, name, division))')
      .eq('id', user.id)
      .single(),
    adminSupabase
      .from('membership_requests')
      .select('id, bodies(id, name, division)')
      .eq('user_id', user.id)
      .eq('status', 'pending'),
    adminSupabase
      .from('bodies')
      .select('id, name, division, body_open')
      .eq('is_active', true)
      .neq('division', 'Non-Divisional')
      .order('name', { ascending: true }),
    loadSgaEmailOptions(adminSupabase, [user.id]),
  ])

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const activeMemberBodyIds = new Set((profile.board_memberships ?? []).map((m: any) => (m.bodies as { id: string } | null)?.id).filter(Boolean))
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pendingBodyIds = new Set((pendingRequests ?? []).map((r: any) => (r.bodies as { id: string } | null)?.id).filter(Boolean))

  const availableBodies = (allBodies ?? []).filter(
    (b: { id: string }) => !activeMemberBodyIds.has(b.id) && !pendingBodyIds.has(b.id)
  )

  return NextResponse.json({
    full_name: profile.full_name,
    email_preferences: profile.email_preferences,
    senate_type_preferences: profile.senate_type_preferences,
    admin_role: profile.admin_role,
    iems_role: profile.iems_role,
    personal_email: profile.email,
    spaces_email_destination: profile.spaces_email_destination ?? 'personal',
    spaces_sga_email: profile.spaces_sga_email ?? null,
    // Recomputed from live Leadership on every read, so the modal never offers
    // an inbox for a body the user has since stepped down from (issue #109).
    sga_email_options: sgaEmailOptions.get(user.id) ?? [],
    memberships: profile.board_memberships ?? [],
    pending_requests: pendingRequests ?? [],
    available_bodies: availableBodies,
  })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json()
  const { full_name, email_preferences, senate_type_preferences, spaces_email_destination, spaces_sga_email } = body

  if (full_name !== undefined && (typeof full_name !== 'string' || full_name.trim() === '')) {
    return NextResponse.json({ error: 'full_name must be a non-empty string' }, { status: 400 })
  }

  if (
    email_preferences !== undefined &&
    (typeof email_preferences !== 'object' || Array.isArray(email_preferences) || email_preferences === null)
  ) {
    return NextResponse.json({ error: 'email_preferences must be a plain object' }, { status: 400 })
  }

  if (
    senate_type_preferences !== undefined &&
    (typeof senate_type_preferences !== 'object' || Array.isArray(senate_type_preferences) || senate_type_preferences === null)
  ) {
    return NextResponse.json({ error: 'senate_type_preferences must be a plain object' }, { status: 400 })
  }

  // Where SGA Spaces emails go (issue #109). Sent together, because whether the
  // inbox is required depends on the destination. The inbox must be one the user
  // may choose right now -- the send path re-checks this too, but refusing here
  // means Settings never shows a choice as saved that would silently not apply.
  if (spaces_email_destination !== undefined) {
    if (!isSpacesEmailDestination(spaces_email_destination)) {
      return NextResponse.json({ error: 'Invalid SGA Spaces email destination.' }, { status: 400 })
    }
    if (spaces_email_destination !== 'personal' || spaces_sga_email) {
      const options = (await loadSgaEmailOptions(adminSupabase, [user.id])).get(user.id)
      if (!findSgaEmailOption(options, spaces_sga_email)) {
        return NextResponse.json(
          { error: 'Choose an SGA email from a body you hold Leadership in.' },
          { status: 400 }
        )
      }
    }
  }

  const updates: Record<string, unknown> = {}
  if (full_name !== undefined) updates.full_name = full_name.trim()
  if (email_preferences !== undefined) updates.email_preferences = email_preferences
  if (senate_type_preferences !== undefined) updates.senate_type_preferences = senate_type_preferences
  if (spaces_email_destination !== undefined) {
    updates.spaces_email_destination = spaces_email_destination
    updates.spaces_sga_email = spaces_sga_email || null
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  const { error } = await adminSupabase.from('users').update(updates).eq('id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
