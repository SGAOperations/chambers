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

export async function POST(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await request.json()

  const { data: target } = await adminSupabase
    .from('users')
    .select('email, has_completed_onboarding')
    .eq('id', id)
    .single()

  if (!target) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 })
  }
  if (target.has_completed_onboarding) {
    return NextResponse.json({ error: 'User has already completed onboarding' }, { status: 400 })
  }

  const otp = randomBytes(8).toString('base64url').slice(0, 12)
  const otpHash = createHash('sha256').update(otp).digest('hex')
  const otpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  // Update Supabase auth password to the new OTP
  await adminSupabase.auth.admin.updateUserById(id, { password: otp })

  const { error } = await adminSupabase
    .from('users')
    .update({ otp_hash: otpHash, otp_expires_at: otpExpiresAt })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await sendOtpInviteEmail({ to: target.email, otp })
  } catch (emailError) {
    console.error('Failed to send OTP resend email:', emailError)
  }

  return NextResponse.json({ success: true })
}
