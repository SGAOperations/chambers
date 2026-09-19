import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { pool } from '@/lib/db/pool'

/**
 * Where a signed-in user should be sent from the login page (issue #136).
 *
 * The login page used to read this straight from the users table with the
 * browser's Supabase client. Nothing in the browser queries the database any
 * more, so it asks here: the caller's own row, and only the three fields the
 * routing decision needs.
 *
 * 401 when there is no session, which the login page treats as "stay here".
 */
export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { rows } = await pool.query<{
    is_active: boolean | null
    has_completed_onboarding: boolean
    otp_expires_at: Date | null
  }>(
    'select is_active, has_completed_onboarding, otp_expires_at from public.users where id = $1',
    [user.id]
  )
  if (!rows[0]) return NextResponse.json({ error: 'Account not found' }, { status: 404 })

  return NextResponse.json({
    is_active: rows[0].is_active !== false,
    has_completed_onboarding: rows[0].has_completed_onboarding,
    otp_expires_at: rows[0].otp_expires_at?.toISOString() ?? null,
  })
}
