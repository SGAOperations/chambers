import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isCallOpen, validateSubmission } from '@/lib/call-for-programs'
import { getLatestCall, loadPriorWeeklyBookings } from '@/lib/call-for-programs-data'

/**
 * The call for programs, from a body lead's side: whether a call is open, the
 * bodies this user leads, and for each one its weekly booking from the last
 * fall or spring and whether it has already answered.
 *
 * Leadership only, admin or not. An admin who leads no body has nothing to
 * submit on behalf of; the Management page is where admins see the answers.
 */

async function leadershipBodies(userId: string): Promise<{ id: string; name: string }[]> {
  const { data } = await db
    .from('board_memberships')
    .select('bodies(id, name, is_active)')
    .eq('user_id', userId)
    .eq('role', 'Leadership')
  return ((data ?? []) as unknown as { bodies: { id: string; name: string; is_active: boolean | null } | null }[])
    .map(m => m.bodies)
    .filter((b): b is { id: string; name: string; is_active: boolean | null } => !!b && b.is_active !== false)
    .map(({ id, name }) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export async function GET() {
  const user = await getAuthedUserWithLiveRoles(db)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const call = await getLatestCall(db)
  if (!isCallOpen(call)) return NextResponse.json({ call: null, bodies: [] })

  const bodies = await leadershipBodies(user.id)
  if (bodies.length === 0) return NextResponse.json({ call, bodies: [] })

  const ids = bodies.map(b => b.id)
  const [prior, { data: submitted }] = await Promise.all([
    loadPriorWeeklyBookings(db, ids),
    db.from('program_submissions').select('body_id').eq('call_id', call!.id).in('body_id', ids),
  ])
  const done = new Set(((submitted ?? []) as { body_id: string }[]).map(s => s.body_id))

  return NextResponse.json({
    call,
    bodies: bodies.map(b => ({ ...b, submitted: done.has(b.id), prior: prior[b.id] ?? [] })),
  })
}

export async function POST(request: Request) {
  const user = await getAuthedUserWithLiveRoles(db)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const raw = (await request.json()) as Record<string, unknown>

  const call = await getLatestCall(db)
  if (!isCallOpen(call)) {
    return NextResponse.json({ error: 'The Call for Programs is closed.' }, { status: 409 })
  }

  const bodyId = raw.body_id
  const bodies = await leadershipBodies(user.id)
  if (typeof bodyId !== 'string' || !bodies.some(b => b.id === bodyId)) {
    return NextResponse.json({ error: 'You do not hold Leadership in that body.' }, { status: 403 })
  }

  const checked = validateSubmission(raw)
  if (!checked.ok) return NextResponse.json({ error: checked.error }, { status: 400 })
  const value = checked.value

  // The booking being answered about has to be one of this body's. "New" is
  // only for a body with none; anything else changes or keeps a booking.
  const prior = (await loadPriorWeeklyBookings(db, [bodyId]))[bodyId] ?? []
  let snapshot = null
  if (value.change_type === 'new') {
    if (prior.length > 0) {
      return NextResponse.json({ error: 'Say whether to keep or change your existing weekly booking.' }, { status: 400 })
    }
  } else {
    snapshot = prior.find(p => p.weekly_booking_id === raw.prior_weekly_booking_id) ?? null
    if (!snapshot) {
      return NextResponse.json({ error: 'Choose which weekly booking this is about.' }, { status: 400 })
    }
  }

  const { error } = await db.from('program_submissions').insert({
    call_id: call!.id,
    body_id: bodyId,
    submitted_by: user.id,
    prior_weekly_booking_id: snapshot?.weekly_booking_id ?? null,
    prior_snapshot: snapshot,
    ...value,
  })

  if (error) {
    // The (call_id, body_id) key: one answer per body, and it does not change.
    if (error.code === '23505') {
      return NextResponse.json({ error: 'This body has already submitted for this call.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}
