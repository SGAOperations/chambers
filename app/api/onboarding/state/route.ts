import { NextResponse } from 'next/server'
import { getAuthedUser } from '@/lib/auth'
import { pool } from '@/lib/db/pool'

/**
 * What the onboarding wizard needs to start (issue #136): the caller's name so
 * far, and whether they already belong to a body, which skips the body-picking
 * step. Replaces two reads the page made with the browser's Supabase client.
 *
 *   401  no session           -> back to the login page
 *   403  deactivated          -> sign out
 *   409  already onboarded    -> on to My Rooms
 */
export async function GET() {
  const user = await getAuthedUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const [{ rows: profiles }, { rows: memberships }] = await Promise.all([
    pool.query<{ full_name: string | null; is_active: boolean | null; has_completed_onboarding: boolean }>(
      'select full_name, is_active, has_completed_onboarding from public.users where id = $1',
      [user.id]
    ),
    pool.query('select 1 from public.board_memberships where user_id = $1 limit 1', [user.id]),
  ])
  const profile = profiles[0]

  if (!profile || profile.is_active === false) {
    return NextResponse.json({ error: 'Account deactivated' }, { status: 403 })
  }
  if (profile.has_completed_onboarding) {
    return NextResponse.json({ error: 'Onboarding already completed' }, { status: 409 })
  }

  return NextResponse.json({
    full_name: profile.full_name ?? '',
    has_memberships: memberships.length > 0,
  })
}
