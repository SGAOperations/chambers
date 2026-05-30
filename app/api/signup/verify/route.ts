import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { randomBytes, createHash, timingSafeEqual } from 'crypto'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

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

  const { data: authData, error: authError } = await adminSupabase.auth.admin.createUser({
    email: normalizedEmail,
    email_confirm: true,
    password: tempPassword,
  })

  if (authError) {
    return NextResponse.json({ error: authError.message }, { status: 500 })
  }

  const full_name = ''

  // Ensure the trigger-created users row has correct defaults
  await adminSupabase
    .from('users')
    .update({ is_active: true, full_name })
    .eq('id', authData.user.id)

  await adminSupabase.auth.admin.updateUserById(authData.user.id, {
    user_metadata: { full_name },
  })

  return NextResponse.json({ email: normalizedEmail, temp_password: tempPassword })
}
