import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'

const adminSupabase = db

export async function PATCH(request: Request) {
  const supabase = db

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || (!user.app_metadata?.is_admin && !user.app_metadata?.iems_role)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { booking_id, occurrence_date, step, checked, waived } = await request.json()

  if (!booking_id || !step) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  if (step !== 'event_management_form' && step !== 'engage_form') {
    return NextResponse.json({ error: 'Invalid step' }, { status: 400 })
  }

  // Ticking a form and marking it not required are separate facts on separate
  // columns (issue #208), so a request may carry either -- but not neither, which
  // would be an upsert that only bumps updated_at.
  if (checked !== undefined && typeof checked !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (waived !== undefined && typeof waived !== 'boolean') {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (checked === undefined && waived === undefined) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  // Deciding a form was never required is a judgement about what the division
  // asks of an event, which is why it is a narrower gate than the rest of this
  // route: IEMS work the checklist, admins decide what is on it.
  if (waived !== undefined && !user.app_metadata?.is_admin) {
    return NextResponse.json(
      { error: 'Only administrators can mark a form as not required.' },
      { status: 403 }
    )
  }

  // Weekly events are marked per occurrence (issue #55), so one booking can own
  // several checklists. null addresses the booking's own, which is what one-time
  // and tabling events use and what every pre-existing row is.
  if (occurrence_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(occurrence_date)) {
    return NextResponse.json({ error: 'Invalid occurrence date' }, { status: 400 })
  }

  const { error } = await adminSupabase
    .from('event_tracking')
    .upsert(
      {
        booking_id,
        occurrence_date: occurrence_date ?? null,
        ...(checked !== undefined ? { [step]: checked } : {}),
        ...(waived !== undefined ? { [`${step}_waived`]: waived } : {}),
        updated_at: new Date().toISOString(),
      },
      // Targets the UNIQUE NULLS NOT DISTINCT constraint the migration adds. A
      // plain unique index would treat every NULL as distinct and insert a fresh
      // booking-level row on each toggle instead of updating the existing one.
      { onConflict: 'booking_id,occurrence_date' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
