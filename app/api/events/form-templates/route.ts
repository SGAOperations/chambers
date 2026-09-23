import { db } from '@/lib/db/data-api'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import { isManagementRole } from '@/lib/admin-roles'
import {
  invalidFormLabel,
  invalidDueDays,
  DUE_DAYS_ERROR,
  UNIQUE_VIOLATION,
  UUID_RE,
} from '@/lib/event-forms'

const adminSupabase = db

/**
 * The catalog of saved event forms (issue #161).
 *
 * A deadline the division uses over and over -- pre-contracting six weeks out --
 * is worth naming once instead of retyping on every event. Curating the list is
 * an Administrator > Advanced job, beside the thresholds the standard forms use,
 * so writes take the same management gate as those settings. Reading is open to
 * IEMS as well, because the Events tab offers the list when adding a form.
 *
 * Adding a saved form to an event copies its name and deadline (see ../forms).
 * Editing one here therefore changes what gets added next and never a deadline
 * someone is already working to.
 */
async function authorize({ write }: { write: boolean }) {
  const user = await getAuthedUserWithLiveRoles(db)

  const allowed = write
    ? !!user?.app_metadata?.is_admin
    : !!(user?.app_metadata?.is_admin || user?.app_metadata?.iems_role)

  if (!user || !allowed) {
    return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }

  // Management-page endpoint: being an admin is not enough (#64).
  if (write && !isManagementRole(user.app_metadata?.admin_role)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return { error: rateLimitRes }

  return { error: null }
}

export async function GET() {
  const { error: authError } = await authorize({ write: false })
  if (authError) return authError

  // Longest lead time first, the order the Events tab lists forms in.
  const { data, error } = await adminSupabase
    .from('event_form_templates')
    .select('id, label, due_days')
    .order('due_days', { ascending: false })
    .order('label')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ templates: data ?? [] })
}

export async function POST(request: Request) {
  const { error: authError } = await authorize({ write: true })
  if (authError) return authError

  const { label, due_days } = await request.json()

  if (invalidFormLabel(label)) {
    return NextResponse.json({ error: 'A saved form needs a name.' }, { status: 400 })
  }
  if (invalidDueDays(due_days)) {
    return NextResponse.json({ error: DUE_DAYS_ERROR }, { status: 400 })
  }

  const { data, error } = await adminSupabase
    .from('event_form_templates')
    .insert({ label: (label as string).trim(), due_days })
    .select('id, label, due_days')
    .single()

  if (error?.code === UNIQUE_VIOLATION) {
    return NextResponse.json({ error: 'A saved form already has that name.' }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ template: data })
}

export async function PATCH(request: Request) {
  const { error: authError } = await authorize({ write: true })
  if (authError) return authError

  const { id, label, due_days } = await request.json()

  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }

  if (label !== undefined) {
    if (invalidFormLabel(label)) {
      return NextResponse.json({ error: 'A saved form needs a name.' }, { status: 400 })
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
    .from('event_form_templates')
    .update(patch)
    .eq('id', id)
    .select('id, label, due_days')
    .maybeSingle()

  if (error?.code === UNIQUE_VIOLATION) {
    return NextResponse.json({ error: 'A saved form already has that name.' }, { status: 409 })
  }
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data) return NextResponse.json({ error: 'Saved form not found.' }, { status: 404 })

  return NextResponse.json({ template: data })
}

export async function DELETE(request: Request) {
  const { error: authError } = await authorize({ write: true })
  if (authError) return authError

  const { id } = await request.json()

  if (!id || typeof id !== 'string' || !UUID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }

  // Events that already added this form keep it: they hold their own copy of the
  // name and deadline, not a pointer here.
  const { error } = await adminSupabase.from('event_form_templates').delete().eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ success: true })
}
