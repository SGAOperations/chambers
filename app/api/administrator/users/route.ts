import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { createPasswordUser, revokeUserSessions } from '@/lib/auth-admin'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { randomBytes, createHash } from 'crypto'
import { sendOtpInviteEmail } from '@/lib/emails/otp-invite'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Management-page endpoint: being an admin is not enough (#64).
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: users } = await supabase
    .from('users')
    .select(`
      id, email, full_name, admin_role, iems_role, is_active, created_at,
      has_completed_onboarding, otp_expires_at,
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

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Management-page endpoint: being an admin is not enough (#64).
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { email, full_name, admin_role, iems_role } = await request.json()

  // Block re-inviting a deactivated account — admin must reactivate instead
  const { count: deactivatedCount } = await adminSupabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('email', email.trim().toLowerCase())
    .eq('is_active', false)

  if (deactivatedCount && deactivatedCount > 0) {
    return NextResponse.json(
      { error: 'A deactivated account already exists for this email. Reactivate the account instead of sending a new invite.' },
      { status: 400 }
    )
  }

  const otp = randomBytes(8).toString('base64url').slice(0, 12)
  const otpHash = createHash('sha256').update(otp).digest('hex')
  const otpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // The invite's one-time password is their password until onboarding sets a
  // real one. Roles live only on the users row now (issue #136) -- there is no
  // token copy to keep in step.
  let newUserId: string
  try {
    newUserId = await createPasswordUser({ email, fullName: full_name, password: otp })
  } catch (e) {
    console.error('Invite account creation failed:', e)
    return NextResponse.json({ error: 'Could not create the account. Does it already exist?' }, { status: 500 })
  }

  // createPasswordUser created the row; add the roles and the invite code.
  const { error: updateError } = await adminSupabase
    .from('users')
    .update({
      admin_role: admin_role || null,
      iems_role: iems_role || null,
      full_name,
      otp_hash: otpHash,
      otp_expires_at: otpExpiresAt,
    })
    .eq('id', newUserId)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 500 })

  try {
    await sendOtpInviteEmail({ to: email, otp })
  } catch (emailError) {
    console.error('Failed to send OTP invite email:', emailError)
  }

  return NextResponse.json({ success: true })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  // Management-page endpoint: being an admin is not enough (#64).
  if (!isManagementRole(user.app_metadata?.admin_role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json()
  const { id } = body

  const updateData: Record<string, unknown> = {}
  if ('admin_role' in body) {
    updateData.admin_role = body.admin_role || null
    // Setting an admin_role clears iems_role
    if (body.admin_role) updateData.iems_role = null
  }
  if ('iems_role' in body) {
    updateData.iems_role = body.iems_role || null
    // Setting an iems_role clears admin_role
    if (body.iems_role) updateData.admin_role = null
  }
  if ('is_active' in body) updateData.is_active = body.is_active
  if ('full_name' in body && typeof body.full_name === 'string' && body.full_name.trim()) {
    updateData.full_name = body.full_name.trim()
  }

  const { error } = await adminSupabase
    .from('users')
    .update(updateData)
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // End every session this user holds when their standing changes.
  //
  // Roles are read live on every request now, so a grant would take effect
  // without this. It stays on grants as well as revocations so that any change
  // to someone's standing starts them on a fresh session, which keeps the rule
  // simple to state.
  //
  // Deliberately after the writes above, so a failure to revoke cannot leave the
  // role change itself unapplied -- and reported, rather than swallowed, because
  // an admin who thinks they cut someone off needs to know if they did not.
  if ('admin_role' in body || 'iems_role' in body || 'is_active' in body) {
    const revokeError = await revokeUserSessions(id).then(() => null, (e: unknown) => e)
    if (revokeError) {
      console.error('revokeUserSessions failed:', revokeError)
      return NextResponse.json(
        {
          error:
            'The role was updated, but their existing sessions could not be ended. They may keep the old access until it expires.',
        },
        { status: 500 }
      )
    }
  }

  return NextResponse.json({ success: true })
}