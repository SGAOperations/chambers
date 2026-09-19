import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { createPasswordUser } from '@/lib/auth-admin'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'

const adminSupabase = db

export async function POST(request: Request) {
  const { email, otp } = await request.json()
  if (!email || !otp || typeof email !== 'string' || typeof otp !== 'string') {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 })
  }

  const normalizedEmail = email.trim().toLowerCase()

  const { data: row } = await adminSupabase
    .from('signup_otps')
    .select('otp_hash, otp_expires_at')
    .eq('email', normalizedEmail)
    .maybeSingle()

  if (!row || new Date(row.otp_expires_at) < new Date()) {
    return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 })
  }

  const submittedHash = createHash('sha256').update(otp.trim()).digest('hex')
  const match = timingSafeEqual(Buffer.from(submittedHash), Buffer.from(row.otp_hash))
  if (!match) {
    return NextResponse.json({ error: 'Invalid or expired code.' }, { status: 400 })
  }

  // Delete immediately — single-use, before creating the user to prevent replay on partial failure
  await adminSupabase.from('signup_otps').delete().eq('email', normalizedEmail)

  const tempPassword = randomBytes(16).toString('hex')

  // Creates the users row too (issue #136). The name is filled in during
  // onboarding; is_active defaults to true.
  try {
    await createPasswordUser({ email: normalizedEmail, fullName: '', password: tempPassword })
  } catch (e) {
    console.error('Signup account creation failed:', e)
    return NextResponse.json({ error: 'Could not create your account. Please try again.' }, { status: 500 })
  }

  return NextResponse.json({ email: normalizedEmail, temp_password: tempPassword })
}
