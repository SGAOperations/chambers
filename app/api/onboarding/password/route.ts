import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { pool } from '@/lib/db/pool'
import { setUserPassword } from '@/lib/auth-admin'

/**
 * Sets the permanent password at the end of onboarding (issue #136).
 *
 * The wizard used to call supabase.auth.updateUser({ password }) from the
 * browser. Better Auth's own change-password needs the current password, which
 * someone who signed up with an emailed code never saw -- it was a random temp
 * password the signup route used to sign them in. So this is done on the server
 * instead, and only for someone who has not finished onboarding: once they
 * have, changing a password means knowing the old one, or a reset link.
 */
export async function POST(request: Request) {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { password } = await request.json().catch(() => ({}))
  if (typeof password !== 'string' || password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters.' }, { status: 400 })
  }
  if (password.length > 128) {
    return NextResponse.json({ error: 'Password must be at most 128 characters.' }, { status: 400 })
  }

  const { rows } = await pool.query<{ has_completed_onboarding: boolean; is_active: boolean | null }>(
    'select has_completed_onboarding, is_active from public.users where id = $1',
    [user.id]
  )
  if (!rows[0] || rows[0].is_active === false) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  if (rows[0].has_completed_onboarding) {
    return NextResponse.json({ error: 'Onboarding already completed' }, { status: 403 })
  }

  await setUserPassword(user.id, password)
  return NextResponse.json({ success: true })
}
