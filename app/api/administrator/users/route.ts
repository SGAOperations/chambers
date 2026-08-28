import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { randomBytes, createHash } from 'crypto'
import { sendOtpInviteEmail } from '@/lib/emails/otp-invite'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

const ROLE_EDITORS = [
  'Executive Vice President',
  'Vice President of Operational Affairs',
  'Digital Innovation Manager',
  'Information Manager',
]

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
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

  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email,
    password: otp,
    email_confirm: true,
    user_metadata: { full_name },
  })

  if (authError) return NextResponse.json({ error: authError.message }, { status: 500 })

  // Set auth metadata (admin and IEMS are mutually exclusive)
  if (admin_role || iems_role) {
    await adminSupabase.auth.admin.updateUserById(authData.user.id, {
      app_metadata: {
        is_admin: !!admin_role,
        admin_role: admin_role || null,
        iems_role: iems_role || null,
      },
    })
  }

  // Update users table (trigger creates the row)
  const { error: updateError } = await adminSupabase
    .from('users')
    .update({
      admin_role: admin_role || null,
      iems_role: iems_role || null,
      full_name,
      otp_hash: otpHash,
      otp_expires_at: otpExpiresAt,
    })
    .eq('id', authData.user.id)

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

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const body = await request.json()
  const { id } = body

  if ('admin_role' in body || 'iems_role' in body) {
    // admin_role is a claim on the verified JWT; no users-table lookup needed.
    if (!ROLE_EDITORS.includes(user.app_metadata?.admin_role ?? '')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
  }

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

  // Sync auth metadata when role changes
  if ('admin_role' in body || 'iems_role' in body) {
    const isSettingAdmin = 'admin_role' in body && !!body.admin_role
    const isSettingIEMS = 'iems_role' in body && !!body.iems_role
    await adminSupabase.auth.admin.updateUserById(id, {
      app_metadata: {
        is_admin: isSettingAdmin,
        admin_role: isSettingAdmin ? body.admin_role : null,
        iems_role: isSettingIEMS ? body.iems_role : null,
      },
    })
  }

  // End every session this user holds when their standing changes.
  //
  // Not just on revocation: a grant goes through here too, so that whatever they
  // were carrying is replaced by a token minted under the new role. The cost is a
  // forced sign-in after a change that happens rarely, and it means there is no
  // case where someone is walking around with a token that disagrees with the
  // users row.
  //
  // Deliberately after the writes above, so a failure to revoke cannot leave the
  // role change itself unapplied -- and reported, rather than swallowed, because
  // an admin who thinks they cut someone off needs to know if they did not.
  if ('admin_role' in body || 'iems_role' in body || 'is_active' in body) {
    const { error: revokeError } = await adminSupabase.rpc('revoke_user_sessions', {
      target: id,
    })
    if (revokeError) {
      console.error('revoke_user_sessions failed:', revokeError)
      return NextResponse.json(
        {
          error:
            'The role was updated, but their existing sessions could not be ended. They may keep the old access until it expires.',
        },
        { status: 500 }
      )
    }
  }

  if ('full_name' in updateData) {
    await adminSupabase.auth.admin.updateUserById(id, {
      user_metadata: { full_name: updateData.full_name },
    })
  }

  return NextResponse.json({ success: true })
}