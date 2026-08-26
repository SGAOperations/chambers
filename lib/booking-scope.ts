import type { SupabaseClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { AuthedUser } from './auth'

/**
 * Multi-body bookings (issue #19).
 *
 * A booking -- and the room_request that may precede it -- is owned by `body_id` and scoped by
 * `scope`:
 *
 *   single      one body. The default, and what the overwhelming majority of bookings are.
 *   divisional  owned by body_id, but visible to anyone with a membership in that division and
 *               manageable by anyone holding Leadership anywhere in that division.
 *   multi       owned by body_id, shared with an explicit set of bodies in booking_bodies.
 *
 * `body_id` is populated in all three cases, so attribution for audit logs and emails never
 * depends on the scope.
 *
 * This module is the single home for that rule on the app side. The equivalent rule in SQL lives
 * in supabase/migrations/20260826001000_multi_body_bookings_rls.sql (booking_is_visible /
 * booking_is_manageable). The two must agree; if you change one, change the other.
 *
 * Note that RLS only guards *reads* in this app -- every booking and request write goes through
 * the service-role client, which bypasses RLS entirely. The guards here are the real write
 * authorization.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Mirrors bodies_division_check / bookings_division_check in the database. Kept here so the UI has
 * one import rather than its own copy (bodies-tab.tsx used to declare this inline).
 */
export const DIVISIONS = [
  'Office of the President',
  'Academic Affairs',
  'Campus Affairs',
  'DEI',
  'Student Success',
  'Operational Affairs',
  'External Affairs',
  'Student Involvement',
  'Senate',
  'Non-Divisional',
] as const

export type Division = (typeof DIVISIONS)[number]

/**
 * Deliberately named BookingScope rather than Scope: cancellation_requests already has a `scope`
 * column with values 'occurrence' | 'series', and the two collide in any shared row type.
 */
export type BookingScope = 'single' | 'divisional' | 'multi'

export interface BodyRef {
  id: string
  name: string
  division: Division
}

/** The scope-bearing columns shared by `bookings` and `room_requests`. */
export interface ScopedRow {
  id: string
  body_id: string
  scope: BookingScope
  division: Division | null
}

/** Everything about the caller needed to decide visibility and manageability. */
export interface ScopeContext {
  isAdmin: boolean
  bodyIds: string[]
  leadershipBodyIds: string[]
  divisions: Division[]
  leadershipDivisions: Division[]
}

export function isBookingScope(v: unknown): v is BookingScope {
  return v === 'single' || v === 'divisional' || v === 'multi'
}

export function isDivision(v: unknown): v is Division {
  return typeof v === 'string' && (DIVISIONS as readonly string[]).includes(v)
}

// ---------------------------------------------------------------------------
// Loading the caller's context
// ---------------------------------------------------------------------------

interface MembershipRow {
  body_id: string
  role: string
  bodies: { division: string } | { division: string }[] | null
}

/** PostgREST returns an embedded to-one relation as an object, but types it as a possible array. */
function embeddedDivision(bodies: MembershipRow['bodies']): string | null {
  if (!bodies) return null
  const row = Array.isArray(bodies) ? bodies[0] : bodies
  return row?.division ?? null
}

/**
 * One query -> the caller's full scope context.
 *
 * Reads through the caller's own (RLS-bound) client: memberships_select_admin_or_own already
 * restricts board_memberships to the caller's own rows.
 */
export async function loadScopeContext(
  supabase: SupabaseClient,
  user: AuthedUser
): Promise<ScopeContext> {
  const isAdmin = !!user.app_metadata?.is_admin

  const { data } = await supabase
    .from('board_memberships')
    .select('body_id, role, bodies(division)')
    .eq('user_id', user.id)

  const memberships = (data ?? []) as MembershipRow[]

  const bodyIds: string[] = []
  const leadershipBodyIds: string[] = []
  const divisions = new Set<Division>()
  const leadershipDivisions = new Set<Division>()

  for (const m of memberships) {
    bodyIds.push(m.body_id)
    const division = embeddedDivision(m.bodies)
    if (isDivision(division)) divisions.add(division)

    if (m.role === 'Leadership') {
      leadershipBodyIds.push(m.body_id)
      if (isDivision(division)) leadershipDivisions.add(division)
    }
  }

  return {
    isAdmin,
    bodyIds,
    leadershipBodyIds,
    divisions: [...divisions],
    leadershipDivisions: [...leadershipDivisions],
  }
}

// ---------------------------------------------------------------------------
// Predicates -- pure, no I/O
// ---------------------------------------------------------------------------

/**
 * `linkedBodyIds` is the booking_bodies / room_request_bodies rows for this row. It is ignored for
 * non-multi scopes, so passing [] is fine when you know the row is single or divisional.
 */
export function canViewScoped(
  ctx: ScopeContext,
  row: ScopedRow,
  linkedBodyIds: string[] = []
): boolean {
  if (ctx.isAdmin) return true
  if (ctx.bodyIds.includes(row.body_id)) return true
  if (row.scope === 'divisional' && row.division) return ctx.divisions.includes(row.division)
  if (row.scope === 'multi') return linkedBodyIds.some(id => ctx.bodyIds.includes(id))
  return false
}

export function canManageScoped(
  ctx: ScopeContext,
  row: ScopedRow,
  linkedBodyIds: string[] = []
): boolean {
  if (ctx.isAdmin) return true
  if (ctx.leadershipBodyIds.includes(row.body_id)) return true
  if (row.scope === 'divisional' && row.division) {
    return ctx.leadershipDivisions.includes(row.division)
  }
  if (row.scope === 'multi') {
    return linkedBodyIds.some(id => ctx.leadershipBodyIds.includes(id))
  }
  return false
}

// ---------------------------------------------------------------------------
// Validating a scope selection off the wire
// ---------------------------------------------------------------------------

export interface ScopeSelection {
  scope: BookingScope
  body_id: string
  division: string | null
  body_ids: string[]
}

export type ScopeValidation =
  | { ok: true; value: { scope: BookingScope; body_id: string; division: Division | null; body_ids: string[] } }
  | { ok: false; error: string }

/**
 * Mirrors the requests_insert_admin_or_leadership WITH CHECK, plus the one rule the database
 * cannot express: a multi booking needs >= 2 bodies including the owner.
 *
 * That rule can't be a constraint trigger because supabase-js writes the parent row and the join
 * rows as two separate HTTP requests -- i.e. two transactions -- so a deferred trigger would fire
 * while booking_bodies is still empty and every multi insert would fail. This is the enforcement
 * point instead.
 *
 * `validBodyIds` is the set of active body ids; pass it to reject references to inactive or
 * nonexistent bodies.
 */
export function validateScopeSelection(
  ctx: ScopeContext,
  input: Partial<ScopeSelection>,
  validBodyIds?: string[]
): ScopeValidation {
  const scope = input.scope ?? 'single'
  if (!isBookingScope(scope)) return { ok: false, error: 'Invalid booking scope.' }

  const body_id = input.body_id
  if (!body_id) return { ok: false, error: 'A body is required.' }

  if (validBodyIds && !validBodyIds.includes(body_id)) {
    return { ok: false, error: 'That body is not available.' }
  }

  // Non-admins may only ever originate a booking from a body they lead.
  if (!ctx.isAdmin && !ctx.leadershipBodyIds.includes(body_id)) {
    return { ok: false, error: 'You do not hold Leadership in that body.' }
  }

  if (scope === 'single') {
    return { ok: true, value: { scope, body_id, division: null, body_ids: [] } }
  }

  if (scope === 'divisional') {
    const division = input.division
    if (!isDivision(division)) return { ok: false, error: 'A division is required.' }
    // Leadership may only request divisional bookings for divisions they actually lead.
    if (!ctx.isAdmin && !ctx.leadershipDivisions.includes(division)) {
      return { ok: false, error: 'You do not hold Leadership in that division.' }
    }
    return { ok: true, value: { scope, body_id, division, body_ids: [] } }
  }

  // scope === 'multi'
  const body_ids = [...new Set(input.body_ids ?? [])]
  if (!body_ids.includes(body_id)) body_ids.unshift(body_id)
  if (body_ids.length < 2) {
    return { ok: false, error: 'A multi-body booking needs at least two bodies.' }
  }
  if (validBodyIds && body_ids.some(id => !validBodyIds.includes(id))) {
    return { ok: false, error: 'One or more selected bodies are not available.' }
  }
  // Any leadership may request a multi-body booking with any combination of bodies, so there is
  // deliberately no leadership check on the non-owning bodies here.
  return { ok: true, value: { scope, body_id, division: null, body_ids } }
}

// ---------------------------------------------------------------------------
// Resolution -- server side, expects a service-role client
// ---------------------------------------------------------------------------

/**
 * Every body whose members make up this booking's audience.
 *
 * For divisional this is a live query, not a stored set: adding a body to a division
 * retroactively brings its members into the audience of past divisional bookings. That is
 * intended -- the booking was made *for* the division.
 */
export async function resolveBookingBodyIds(
  adminSupabase: SupabaseClient,
  row: ScopedRow
): Promise<string[]> {
  if (row.scope === 'divisional' && row.division) {
    const { data } = await adminSupabase
      .from('bodies')
      .select('id')
      .eq('division', row.division)
      .eq('is_active', true)
    const ids = (data ?? []).map((b: { id: string }) => b.id)
    return ids.includes(row.body_id) ? ids : [row.body_id, ...ids]
  }

  if (row.scope === 'multi') {
    const { data } = await adminSupabase
      .from('booking_bodies')
      .select('body_id')
      .eq('booking_id', row.id)
    const ids = (data ?? []).map((b: { body_id: string }) => b.body_id)
    // The invariant says body_id is already in there; be defensive anyway.
    return ids.includes(row.body_id) ? ids : [row.body_id, ...ids]
  }

  return [row.body_id]
}

/**
 * Writes the booking_bodies rows for a booking to exactly `bodyIds`, clearing them for any
 * non-multi scope. Delete-then-reinsert, matching how the booking routes already replace their
 * session rows.
 *
 * Not transactional -- supabase-js issues these as separate requests. A failure between the delete
 * and the insert leaves a multi booking with no join rows, which the integrity query in the schema
 * migration will surface. Given admin-only, low-frequency writes that is an acceptable trade
 * against moving booking creation into an RPC.
 */
export async function syncBookingBodies(
  adminSupabase: SupabaseClient,
  bookingId: string,
  scope: BookingScope,
  bodyIds: string[]
): Promise<{ error: string | null }> {
  const { error: deleteError } = await adminSupabase
    .from('booking_bodies')
    .delete()
    .eq('booking_id', bookingId)

  if (deleteError) return { error: deleteError.message }

  if (scope !== 'multi' || bodyIds.length === 0) return { error: null }

  const { error: insertError } = await adminSupabase
    .from('booking_bodies')
    .insert(bodyIds.map(body_id => ({ booking_id: bookingId, body_id })))

  return { error: insertError?.message ?? null }
}

export interface Recipient {
  userId: string
  email: string
  fullName: string
}

interface RecipientRow {
  user_id: string
  body_id: string
  role: string
  users: { email: string; full_name: string; is_active: boolean } | { email: string; full_name: string; is_active: boolean }[] | null
}

/**
 * The people to email / create user_alerts for when a booking changes.
 *
 * Fan-out policy (issue #19):
 *   single      members of the one body -- unchanged behavior.
 *   multi       all members of every listed body. They are explicitly chosen co-owners.
 *   divisional  members of the owning body, plus only Leadership of the peer bodies. A division
 *               can be large, and mass-emailing all of it on every edit would be noise.
 *
 * Hidden bookings (issue #21) override all of the above: a hidden booking is only visible to
 * those who can manage it, so it must only ever notify them -- Leadership across the whole
 * audience, for every scope. Otherwise an alert or email tells a member about a booking they
 * cannot see, which is both confusing and a disclosure.
 *
 * `hidden` is looked up here rather than taken from the caller precisely so no route can forget
 * to pass it; that omission is what caused #21.
 *
 * This is the single place that policy lives; change it here and every booking route follows.
 *
 * `leadershipOnly` narrows to Leadership across the whole audience regardless of scope -- used for
 * the missed-reservation email, which only ever went to leadership.
 */
export async function resolveBookingRecipients(
  adminSupabase: SupabaseClient,
  row: ScopedRow,
  opts: { leadershipOnly?: boolean } = {}
): Promise<Recipient[]> {
  const bodyIds = await resolveBookingBodyIds(adminSupabase, row)
  if (bodyIds.length === 0) return []

  const [{ data }, { data: bookingRow }] = await Promise.all([
    adminSupabase
      .from('board_memberships')
      .select('user_id, body_id, role, users(email, full_name, is_active)')
      .in('body_id', bodyIds),
    adminSupabase.from('bookings').select('hidden').eq('id', row.id).maybeSingle(),
  ])

  // A hidden booking notifies only the people who can manage it, which is exactly the set
  // canManageScoped() admits: Leadership anywhere in the booking's audience.
  const leadershipOnly = !!opts.leadershipOnly || !!bookingRow?.hidden

  const rows = (data ?? []) as RecipientRow[]
  const byUser = new Map<string, Recipient>()

  for (const m of rows) {
    const user = Array.isArray(m.users) ? m.users[0] : m.users
    if (!user?.is_active || !user.email) continue

    if (leadershipOnly && m.role !== 'Leadership') continue

    // Divisional: peer bodies contribute only their leadership.
    if (
      !leadershipOnly &&
      row.scope === 'divisional' &&
      m.body_id !== row.body_id &&
      m.role !== 'Leadership'
    ) {
      continue
    }

    if (!byUser.has(m.user_id)) {
      byUser.set(m.user_id, {
        userId: m.user_id,
        email: user.email,
        fullName: user.full_name,
      })
    }
  }

  return [...byUser.values()]
}

// ---------------------------------------------------------------------------
// Route guards
// ---------------------------------------------------------------------------

/**
 * Returns a NextResponse to bail out with, or null when the caller may manage this booking.
 * Follows the idiom of checkRateLimit().
 *
 * Replaces the single-body Leadership check that was duplicated across the revision-request,
 * cancellation-request and request routes.
 */
export async function requireBookingManager(
  supabase: SupabaseClient,
  adminSupabase: SupabaseClient,
  user: AuthedUser,
  bookingId: string
): Promise<
  { error: NextResponse; row: null } | { error: null; row: ScopedRow & { type: string } }
> {
  const { data } = await adminSupabase
    .from('bookings')
    .select('id, body_id, scope, division, type')
    .eq('id', bookingId)
    .single()

  if (!data) {
    return { error: NextResponse.json({ error: 'Booking not found' }, { status: 404 }), row: null }
  }

  const row = data as ScopedRow & { type: string }

  if (user.app_metadata?.is_admin) return { error: null, row }

  const ctx = await loadScopeContext(supabase, user)

  let linked: string[] = []
  if (row.scope === 'multi') {
    const { data: bb } = await adminSupabase
      .from('booking_bodies')
      .select('body_id')
      .eq('booking_id', row.id)
    linked = (bb ?? []).map((b: { body_id: string }) => b.body_id)
  }

  if (!canManageScoped(ctx, row, linked)) {
    return { error: NextResponse.json({ error: 'Forbidden' }, { status: 403 }), row: null }
  }

  return { error: null, row }
}

// ---------------------------------------------------------------------------
// Display
// ---------------------------------------------------------------------------

export interface ScopeLabelParts {
  /** Compact form for a table cell or card heading. */
  short: string
  /** Every body in the audience, owner first. One entry for divisional. */
  full: string[]
}

/**
 * single      -> { short: 'DEI Committee',             full: ['DEI Committee'] }
 * divisional  -> { short: 'Campus Affairs (Division)', full: ['Campus Affairs (Division)'] }
 * multi       -> { short: 'DEI Committee + 2 others',  full: ['DEI Committee', ...rest] }
 *
 * The owning body heads the multi list so attribution stays stable no matter which bodies were
 * added or in what order.
 */
export function formatScopeLabel(
  row: Pick<ScopedRow, 'body_id' | 'scope' | 'division'> & { bodies?: { name: string } | null },
  linkedBodies: { id: string; name: string }[] = []
): ScopeLabelParts {
  const ownerName = row.bodies?.name ?? 'Unknown'

  if (row.scope === 'divisional' && row.division) {
    const label = `${row.division} (Division)`
    return { short: label, full: [label] }
  }

  if (row.scope === 'multi') {
    const others = linkedBodies
      .filter(b => b.id !== row.body_id)
      .map(b => b.name)
      .sort((a, b) => a.localeCompare(b))

    if (others.length === 0) return { short: ownerName, full: [ownerName] }

    return {
      short: `${ownerName} + ${others.length} other${others.length === 1 ? '' : 's'}`,
      full: [ownerName, ...others],
    }
  }

  return { short: ownerName, full: [ownerName] }
}
