import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomBytes, createHash } from 'crypto'
import { signupRateLimiter } from '@/lib/rate-limit'
import { sendSignupOtpEmail } from '@/lib/emails/signup-otp'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(request: Request) {
  const ip = request.headers.get('x-forwarded-for') ?? 'unknown'
  const { success } = await signupRateLimiter.limit(ip)
  if (!success) {
    return NextResponse.json({ error: 'Too many requests. Please try again later.' }, { status: 429 })
  }

  const { email } = await request.json()
  if (!email || typeof email !== 'string') {
    return NextResponse.json({ error: 'Email is required.' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()

  // Check if a fully set-up account already exists (head-only, no data returned)
  const { count: existingCount } = await adminSupabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('email', normalizedEmail)
    .eq('has_completed_onboarding', true)

  if (existingCount && existingCount > 0) {
    return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 400 })
  }

  // Check if a valid (non-expired) OTP already exists
  const { data: pending } = await adminSupabase
    .from('signup_otps')
    .select('id')
    .eq('email', normalizedEmail)
    .gt('otp_expires_at', new Date().toISOString())
    .maybeSingle()

  if (pending) {
    return NextResponse.json(
      { error: 'A signup request for this email is already pending. Please check your inbox.' },
      { status: 400 }
    )
  }

  const otp = randomBytes(8).toString('base64url').slice(0, 12)
  const otpHash = createHash('sha256').update(otp).digest('hex')
  const otpExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()

  const { error: upsertError } = await adminSupabase
    .from('signup_otps')
    .upsert({ email: normalizedEmail, otp_hash: otpHash, otp_expires_at: otpExpiresAt }, { onConflict: 'email' })

  if (upsertError) {
    return NextResponse.json({ error: 'Failed to create signup request.' }, { status: 500 })
  }

  try {
    await sendSignupOtpEmail({ to: normalizedEmail, otp })
  } catch {
    return NextResponse.json({ error: 'Failed to send verification email.' }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
