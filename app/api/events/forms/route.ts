import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { invalidFormLabel, invalidDueDays, DUE_DAYS_ERROR, UUID_RE } from '@/lib/event-forms'

const adminSupabase = db

/** An event with this many extra forms has a process problem, not a tracking one. */
const MAX_ITEMS_PER_EVENT = 20

/**
 * Extra tracking forms on one event (issue #161).
 *
 * The two standard forms are columns on event_tracking and are ticked in
 * ../checklist; these are rows of their own, because an event has any number of
 * them and each carries its own name and deadline. Both address the same target:
 * a booking, or one flagged week of a weekly series (occurrence_date).
 *
 * A form is added either from the saved list an admin curates (../form-templates,
 * passed as template_id) or typed out. Either way the name and deadline are
 * copied onto the event, so editing a saved form later never moves a deadline
 * someone is already working to.
 *
 * Open to admins and IEMS -- everyone who can open the Events tab -- which is the
 * same gate the rest of that tab's endpoints use.
 */
async function authorize() {
  const user = await getAuthedUserWithLiveRoles(db)
  if (!user || (!user.app_metadata?.is_admin && !user.app_metadata?.iems_role)) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return { error: rateLimitRes }
  return { error: null }
}

export async function POST(request: Request) {
  const { error: authError } = await authorize()
  if (authError) return authError

  const { booking_id, occurrence_date, template_id, label, due_days } = await request.json()

  if (!booking_id || typeof booking_id !== 'string' || !UUID_RE.test(booking_id)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
  if (occurrence_date != null && !/^\d{4}-\d{2}-\d{2}$/.test(occurrence_date)) {
    return NextResponse.json({ error: 'Invalid occurrence date' }, { status: 400 })
  }

  // A saved form supplies both fields; a typed one carries them itself. The
  // saved list is read here rather than trusted from the client so a stale tab
  // cannot add a form under a name or a deadline that no longer exists.
  let resolved: { label: string; due_days: number }

  if (template_id !== undefined && template_id !== null) {
    if (typeof template_id !== 'string' || !UUID_RE.test(template_id)) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    const { data: template } = await adminSupabase
      .from('event_form_templates')
      .select('label, due_days')
      .eq('id', template_id)
      .maybeSingle()
    if (!template) {
      return NextResponse.json({ error: 'That saved form no longer exists.' }, { status: 404 })
    }
    resolved = { label: template.label, due_days: template.due_days }
  } else {
    if (invalidFormLabel(label)) {
      return NextResponse.json({ error: 'A form needs a name.' }, { status: 400 })
    }
    if (invalidDueDays(due_days)) {
      return NextResponse.json({ error: DUE_DAYS_ERROR }, { status: 400 })
    }
    resolved = { label: (label as string).trim(), due_days }
  }

  // The event has to exist. Without this the foreign key would still catch a bad
  // id, but as a 500 reading "violates foreign key constraint".
  const { data: booking } = await adminSupabase
    .from('bookings')
    .select('id')
    .eq('id', booking_id)
    .maybeSingle()
  if (!booking) return NextResponse.json({ error: 'Booking not found' }, { status: 404 })

  // `.is` takes null/true/false only, so the two targets are addressed
  // differently: the booking's own list, or one flagged week's.
  const existing = adminSupabase
    .from('event_tracking_items')
    .select('id', { count: 'exact', head: true })
    .eq('booking_id', booking_id)
  const { count } = await (occurrence_date
    ? existing.eq('occurrence_date', occurrence_date)
    : existing.is('occurrence_date', null))

  if ((count ?? 0) >= MAX_ITEMS_PER_EVENT) {
    return NextResponse.json(
      { error: `An event can track at most ${MAX_ITEMS_PER_EVENT} extra forms.` },
      { status: 400 }
    )
  }

  const { data, error } = await adminSupabase
    .from('event_tracking_items')
    .insert({
      booking_id,
      occurrence_date: occurrence_date ?? null,
      label: resolved.label,
      due_days: resolved.due_days,
    })
    .select('id, label, due_days, completed')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ item: data })
}

/** Tick one off, rename it, or move its deadline. Any subset, by item id. */
export async function PATCH(request: Request) {
  const { error: authError } = await authorize()
  if (authError) return authError

  const { id, completed, label, due_days } = await request.json()

  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (completed !== undefined) {
    if (typeof completed !== 'boolean') {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
    }
    patch.completed = completed
  }
  if (label !== undefined) {
    if (invalidFormLabel(label)) {
      return NextResponse.json({ error: 'A form needs a name.' }, { status: 400 })
    }
    patch.label = (label as string).trim()
  }
  if (due_days !== undefined) {
    if (invalidDueDays(due_days)) {
      return NextResponse.json({ error: DUE_DAYS_ERROR }, { status: 400 })
    }
    patch.due_days = due_days
  }

  // Only updated_at: nothing was actually asked for.
  if (Object.keys(patch).length === 1) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('event_tracking_items')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Form not found.' }, { status: 404 })

  return NextResponse.json({ success: true })
}

export async function DELETE(request: Request) {
  const { error: authError } = await authorize()
  if (authError) return authError

  const { id } = await request.json()

  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const { error } = await adminSupabase.from('event_tracking_items').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
