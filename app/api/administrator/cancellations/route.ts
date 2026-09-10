import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/check-rate-limit'
import { getAuthedUserWithLiveRoles } from '@/lib/authorization'
import {
  applyCancellationOutcomes,
  cancellationAuditRows,
  collectPending,
} from '@/lib/pending-cancellations'

const adminSupabase = createAdminClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function GET() {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { data: cancellations } = await supabase
    .from('cancellation_requests')
    .select(`
      id, scope, status, created_at, cancellation_type, occurrence_id, occurrence_date, booking_id,
      bookings(id, type, purpose, bodies(name)),
      users(full_name)
    `)
    .order('created_at', { ascending: false })

  // Enrich with occurrence date (weekly) and reservation code
  // Direct joins are unavailable since occurrence_id no longer has a FK constraint
  const enriched = await Promise.all(
    (cancellations || []).map(async (c) => {
      const bookingType = (c.bookings as unknown as { type: string } | null)?.type
      let occurrence_date: string | null = null
      let reservation_code: string | null = null

      if (c.scope === 'occurrence' && c.occurrence_id) {
        if (bookingType === 'Weekly Room') {
          // Matched on the stored date first, and only then on the id. The id
          // does not survive an edit to the booking -- the PATCH handler
          // regenerates every occurrence -- which is why these rows showed no
          // date at all (issue #96).
          const q = adminSupabase
            .from('weekly_room_occurrences')
            .select('occurrence_date, reservation_code, weekly_room_bookings!inner(booking_id)')
          const { data: occ } = c.occurrence_date
            ? await q
                .eq('occurrence_date', c.occurrence_date)
                .eq('weekly_room_bookings.booking_id', c.booking_id)
                .maybeSingle()
            : await q.eq('id', c.occurrence_id).maybeSingle()
          occurrence_date = occ?.occurrence_date ?? c.occurrence_date ?? null
          reservation_code = occ?.reservation_code ?? null
        } else if (bookingType === 'One-Time Room') {
          const { data: session } = await adminSupabase
            .from('one_time_room_bookings')
            .select('reservation_code')
            .eq('id', c.occurrence_id)
            .single()
          reservation_code = session?.reservation_code ?? null
        } else if (bookingType === 'Tabling') {
          const { data: session } = await adminSupabase
            .from('tabling_sessions')
            .select('reservation_code')
            .eq('id', c.occurrence_id)
            .single()
          reservation_code = session?.reservation_code ?? null
        }
      } else {
        // series scope — grab first session's reservation code
        if (bookingType === 'One-Time Room') {
          const { data: session } = await adminSupabase
            .from('one_time_room_bookings')
            .select('reservation_code')
            .eq('booking_id', c.booking_id)
            .limit(1)
            .single()
          reservation_code = session?.reservation_code ?? null
        } else if (bookingType === 'Weekly Room') {
          const { data: wb } = await adminSupabase
            .from('weekly_room_bookings')
            .select('reservation_code')
            .eq('booking_id', c.booking_id)
            .single()
          reservation_code = wb?.reservation_code ?? null
        } else if (bookingType === 'Tabling') {
          const { data: tb } = await adminSupabase
            .from('tabling_bookings')
            .select('reservation_code')
            .eq('booking_id', c.booking_id)
            .single()
          reservation_code = tb?.reservation_code ?? null
        }
      }

      // The stored date is the fallback for every type: even where the code
      // lookup fails because the row was regenerated, the request still knows
      // which date it was about.
      return { ...c, occurrence_date: occurrence_date ?? c.occurrence_date ?? null, reservation_code }
    })
  )

  return NextResponse.json({ cancellations: enriched })
}

export async function PATCH(request: Request) {
  const supabase = await createClient()

  const user = await getAuthedUserWithLiveRoles(supabase)
  if (!user || !user.app_metadata?.is_admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const rateLimitRes = await checkRateLimit(user.id)
  if (rateLimitRes) return rateLimitRes

  const { id } = await request.json()
  if (!id) return NextResponse.json({ error: 'A cancellation request id is required.' }, { status: 400 })

  const { data: req } = await adminSupabase
    .from('cancellation_requests')
    .select('id')
    .eq('id', id)
    .maybeSingle()

  if (!req) return NextResponse.json({ error: 'Cancellation request not found.' }, { status: 404 })

  // Which dated reservations this request covers, and what each is due. Read
  // from the same collector Auto-Cancel uses, so the two agree about whose row a
  // request owns -- including the inheritance that makes a series-level
  // cancellation produce pending occurrences that do not say so themselves.
  //
  // `skipped` is included here where Auto-Cancel excludes it. A missing
  // reservation code means CSC cannot be asked, which is why Auto-Cancel will
  // not touch those rows; it says nothing about whether an administrator has
  // dealt with it. Marking Done by hand is that administrator saying they have.
  const { lines, skipped } = await collectPending()
  const covered = [...lines, ...skipped].filter(l => l.cancellationRequestId === id)

  const failures = await applyCancellationOutcomes(covered)

  // One entry per booking touched, so the change shows up in the Audit tab
  // beside every other status change rather than appearing to have happened by
  // itself. Best effort, as in Auto-Cancel.
  const auditRows = cancellationAuditRows(covered, user.id)
  if (auditRows.length) {
    const { error: auditError } = await adminSupabase.from('audit_logs').insert(auditRows)
    if (auditError) console.error('Cancellation done audit log failed:', auditError)
  }

  const { error } = await adminSupabase
    .from('cancellation_requests')
    .update({ status: 'Done' })
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    success: true,
    applied: covered.length,
    cancelled: covered.filter(l => l.resultingStatus === 'Cancelled').length,
    virtual: covered.filter(l => l.resultingStatus === 'Virtual').length,
    // The request is closed either way -- the admin has said it is handled -- but
    // they need to know if a status did not move with it.
    ...(failures.length ? { statusUpdateFailed: failures } : {}),
  })
}