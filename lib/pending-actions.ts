import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The admin "Pending Actions" model (issue #38).
 *
 * Every outstanding admin task -- a room request, a revision request, a
 * cancellation request, an incomplete event form -- becomes a PendingAction with
 * a severity that escalates as its deadline nears:
 *
 *   regular  blue    -- pending, deadline still far off
 *   warning  yellow  -- within `warningLeadDays` of the Danger Range opening
 *   danger   red     -- inside the Danger Range, and stays danger after it passes
 *
 * The Danger Range per source and the warning lead time are admin-tunable
 * (app_settings.pa_*). This module is the single place the derivation lives; the
 * counts route and /api/dashboard both return its output.
 */

export type Severity = 'regular' | 'warning' | 'danger'
export type PendingActionKind =
  | 'request'
  | 'revision'
  | 'cancellation'
  | 'event-form'
  | 'membership'
export type OriginTab = 'Requests' | 'Cancellations' | 'Events' | 'Users'

export interface PendingAction {
  /** Stable across refetches -- `${kind}:${recordId}` (+ form type for event-form). */
  id: string
  kind: PendingActionKind
  severity: Severity
  /** One-line summary for the hover breakdown. */
  label: string
  /** Where the admin resolves it, and the row id that tab renders (for #38 #5). */
  originTab: OriginTab
  originId: string
  /** The date the severity is measured against, YYYY-MM-DD. */
  referenceDate: string | null
}

/** Legacy per-category counts kept alongside the new fields so existing callers don't break. */
export interface PendingActionsResult {
  actions: PendingAction[]
  total: number
  /** The most severe severity across `actions`; 'regular' when there are none. */
  severity: Severity
  requests: number
  cancellations: number
  revisions: number
  membership_requests: number
}

export const EMPTY_PENDING_ACTIONS: PendingActionsResult = {
  actions: [],
  total: 0,
  severity: 'regular',
  requests: 0,
  cancellations: 0,
  revisions: 0,
  membership_requests: 0,
}

export interface PendingActionSettings {
  warningLeadDays: number
  /** Event-form actions are hidden until the event is within this many calendar months. */
  eventTriggerMonths: number
  /** [dangerStart, dangerEnd] in days-until; severity is danger once daysUntil <= dangerStart. */
  requestRoom: [number, number]
  requestTabling: [number, number]
  revision: [number, number]
  /** Regular cancellation danger threshold is a single point ("same day as booking"). */
  cancellationRegularDays: number
  cancellationEvent: [number, number]
  eventMgmt: [number, number]
  eventEngage: [number, number]
}

export const DEFAULT_PA_SETTINGS: PendingActionSettings = {
  warningLeadDays: 7,
  eventTriggerMonths: 2,
  requestRoom: [17, 11],
  requestTabling: [17, 14],
  revision: [17, 11],
  cancellationRegularDays: 0,
  cancellationEvent: [21, 14],
  eventMgmt: [35, 28],
  eventEngage: [28, 21],
}

const SEVERITY_RANK: Record<Severity, number> = { regular: 0, warning: 1, danger: 2 }

// ---------------------------------------------------------------------------
// Date helpers -- everything in whole UTC days. The function runs in UTC; the
// small skew vs. Eastern near midnight is acceptable for a severity badge.
// ---------------------------------------------------------------------------

function utcMidnight(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number)
  return Date.UTC(y, m - 1, d)
}

function daysBetween(fromMs: number, dateStr: string): number {
  return Math.round((utcMidnight(dateStr) - fromMs) / 86_400_000)
}

export function minDate(dates: (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const d of dates) if (d && (best === null || d < best)) best = d
  return best
}

/** `dateStr` minus `days`, as YYYY-MM-DD -- used to turn a Danger Range's near
 *  edge (the `_end` settings, currently unused by severity itself) into a
 *  displayable due date (issue #45). */
export function subtractDays(dateStr: string, days: number): string {
  const d = new Date(utcMidnight(dateStr) - days * 86_400_000)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** PostgREST types a to-one embed as a possible array; collapse it and read `name`. */
type NameRef = { name: string } | { name: string }[] | null
function nameOf(ref: NameRef): string {
  if (!ref) return 'Unknown'
  const r = Array.isArray(ref) ? ref[0] : ref
  return r?.name ?? 'Unknown'
}

function shortDate(dateStr: string | null): string {
  if (!dateStr) return 'no date'
  const [y, m, d] = dateStr.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  })
}

/** danger once inside the range (or past it); warning in the lead window before it. */
function severityForRange(
  daysUntil: number,
  dangerStart: number,
  warningLeadDays: number
): Severity {
  if (daysUntil <= dangerStart) return 'danger'
  if (daysUntil <= dangerStart + warningLeadDays) return 'warning'
  return 'regular'
}

// ---------------------------------------------------------------------------
// Settings row -> typed settings, falling back to defaults per field so a
// pre-migration database (columns absent) still works.
// ---------------------------------------------------------------------------

export type SettingsRow = Record<string, number | null | undefined>

export function settingsFromRow(row: SettingsRow | null): PendingActionSettings {
  const d = DEFAULT_PA_SETTINGS
  const n = (key: string, fallback: number) =>
    typeof row?.[key] === 'number' ? (row[key] as number) : fallback
  return {
    warningLeadDays: n('pa_warning_lead_days', d.warningLeadDays),
    eventTriggerMonths: n('pa_event_trigger_months', d.eventTriggerMonths),
    requestRoom: [
      n('pa_request_room_danger_start', d.requestRoom[0]),
      n('pa_request_room_danger_end', d.requestRoom[1]),
    ],
    requestTabling: [
      n('pa_request_tabling_danger_start', d.requestTabling[0]),
      n('pa_request_tabling_danger_end', d.requestTabling[1]),
    ],
    revision: [
      n('pa_revision_danger_start', d.revision[0]),
      n('pa_revision_danger_end', d.revision[1]),
    ],
    cancellationRegularDays: n('pa_cancellation_regular_danger_days', d.cancellationRegularDays),
    cancellationEvent: [
      n('pa_cancellation_event_danger_start', d.cancellationEvent[0]),
      n('pa_cancellation_event_danger_end', d.cancellationEvent[1]),
    ],
    eventMgmt: [
      n('pa_event_mgmt_danger_start', d.eventMgmt[0]),
      n('pa_event_mgmt_danger_end', d.eventMgmt[1]),
    ],
    eventEngage: [
      n('pa_event_engage_danger_start', d.eventEngage[0]),
      n('pa_event_engage_danger_end', d.eventEngage[1]),
    ],
  }
}

// ---------------------------------------------------------------------------
// Embedded shapes from the PostgREST selects below.
// ---------------------------------------------------------------------------

/** `id` fields are optional so a caller that only needs dates (e.g. the events
 *  API's due-date calc) can reuse this shape without also selecting ids. */
export interface BookingChildDates {
  type?: string | null
  is_event?: boolean | null
  bodies?: NameRef
  one_time_room_bookings?: { id?: string; booking_date: string | null }[] | null
  weekly_room_bookings?:
    | { weekly_room_occurrences?: { id?: string; occurrence_date: string | null }[] | null }[]
    | null
  tabling_bookings?:
    | { tabling_sessions?: { id?: string; session_date: string | null }[] | null }[]
    | null
}

/** Every session date attached to an embedded booking, flattened. */
export function sessionDatesOf(b: BookingChildDates): string[] {
  const out: string[] = []
  for (const o of b.one_time_room_bookings ?? []) if (o.booking_date) out.push(o.booking_date)
  for (const w of b.weekly_room_bookings ?? [])
    for (const occ of w.weekly_room_occurrences ?? []) if (occ.occurrence_date) out.push(occ.occurrence_date)
  for (const t of b.tabling_bookings ?? [])
    for (const s of t.tabling_sessions ?? []) if (s.session_date) out.push(s.session_date)
  return out
}

/** The date of one specific child row (used for occurrence-scoped cancellations). */
function childDateById(b: BookingChildDates, childId: string): string | null {
  for (const o of b.one_time_room_bookings ?? []) if (o.id === childId) return o.booking_date ?? null
  for (const w of b.weekly_room_bookings ?? [])
    for (const occ of w.weekly_room_occurrences ?? []) if (occ.id === childId) return occ.occurrence_date ?? null
  for (const t of b.tabling_bookings ?? [])
    for (const s of t.tabling_sessions ?? []) if (s.id === childId) return s.session_date ?? null
  return null
}

const BOOKING_CHILD_SELECT =
  'type, is_event, bodies(name), one_time_room_bookings(id, booking_date), weekly_room_bookings(weekly_room_occurrences(id, occurrence_date)), tabling_bookings(tabling_sessions(id, session_date))'

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function fetchPendingActions(
  adminSupabase: SupabaseClient,
  now: Date = new Date()
): Promise<PendingActionsResult> {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())
  // The far date at which event-form actions start appearing = today + N months.
  const triggerCutoffMs = (months: number) =>
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, now.getUTCDate())

  const [
    { data: settingsRow },
    { data: requests },
    { data: revisions },
    { data: cancellations },
    { data: eventBookings },
    { data: memberships },
  ] = await Promise.all([
    adminSupabase.from('app_settings').select('*').eq('id', 1).maybeSingle(),
    adminSupabase
      .from('room_requests')
      .select('id, type, bodies(name), room_request_details(start_date), tabling_request_sessions(session_date)')
      .eq('status', 'Pending'),
    adminSupabase
      .from('revision_requests')
      .select(`id, booking_id, bookings(${BOOKING_CHILD_SELECT})`)
      .eq('status', 'Pending'),
    adminSupabase
      .from('cancellation_requests')
      .select(`id, booking_id, occurrence_id, bookings(${BOOKING_CHILD_SELECT})`)
      .eq('status', 'Pending'),
    adminSupabase
      .from('bookings')
      .select(`id, ${BOOKING_CHILD_SELECT}, event_tracking(event_management_form, engage_form)`)
      .eq('is_event', true),
    adminSupabase
      .from('membership_requests')
      .select('id, bodies(name)')
      .eq('status', 'pending'),
  ])

  const s = settingsFromRow(settingsRow as SettingsRow | null)
  const actions: PendingAction[] = []

  // --- Requests ---------------------------------------------------------------
  for (const r of (requests ?? []) as unknown as {
    id: string
    type: string
    bodies: NameRef
    room_request_details: { start_date: string | null }[] | null
    tabling_request_sessions: { session_date: string | null }[] | null
  }[]) {
    const isTabling = r.type === 'Tabling'
    const refDate = isTabling
      ? minDate((r.tabling_request_sessions ?? []).map(x => x.session_date))
      : minDate((r.room_request_details ?? []).map(x => x.start_date))

    let severity: Severity = 'regular'
    if (r.type === 'Weekly Room') {
      severity = 'regular' // weekly room requests are always regular (issue #38)
    } else if (refDate) {
      const range = isTabling ? s.requestTabling : s.requestRoom
      severity = severityForRange(daysBetween(base, refDate), range[0], s.warningLeadDays)
    }

    actions.push({
      id: `request:${r.id}`,
      kind: 'request',
      severity,
      label: `${r.type} request — ${nameOf(r.bodies)} · ${shortDate(refDate)}`,
      originTab: 'Requests',
      originId: r.id,
      referenceDate: refDate,
    })
  }

  // --- Revision requests ----------------------------------------------------
  for (const rv of (revisions ?? []) as unknown as {
    id: string
    booking_id: string
    bookings: BookingChildDates | null
  }[]) {
    const b = rv.bookings
    const refDate = b ? minDate(sessionDatesOf(b)) : null
    const severity = refDate
      ? severityForRange(daysBetween(base, refDate), s.revision[0], s.warningLeadDays)
      : 'regular'

    actions.push({
      id: `revision:${rv.id}`,
      kind: 'revision',
      severity,
      label: `Revision — ${nameOf(b?.bodies ?? null)} · ${shortDate(refDate)}`,
      originTab: 'Requests',
      originId: rv.id,
      referenceDate: refDate,
    })
  }

  // --- Cancellation requests ----------------------------------------------
  for (const c of (cancellations ?? []) as unknown as {
    id: string
    booking_id: string
    occurrence_id: string | null
    bookings: BookingChildDates | null
  }[]) {
    const b = c.bookings
    const refDate = b
      ? c.occurrence_id
        ? childDateById(b, c.occurrence_id) ?? minDate(sessionDatesOf(b))
        : minDate(sessionDatesOf(b))
      : null
    const isEvent = !!b?.is_event

    let severity: Severity = 'regular'
    if (refDate) {
      const days = daysBetween(base, refDate)
      severity = isEvent
        ? severityForRange(days, s.cancellationEvent[0], s.warningLeadDays)
        : severityForRange(days, s.cancellationRegularDays, s.warningLeadDays)
    }

    actions.push({
      id: `cancellation:${c.id}`,
      kind: 'cancellation',
      severity,
      label: `${isEvent ? 'Event ' : ''}Cancellation — ${nameOf(b?.bodies ?? null)} · ${shortDate(refDate)}`,
      originTab: 'Cancellations',
      originId: c.id,
      referenceDate: refDate,
    })
  }

  // --- Event forms -------------------------------------------------------
  for (const b of (eventBookings ?? []) as unknown as (BookingChildDates & {
    id: string
    event_tracking:
      | { event_management_form: boolean; engage_form: boolean }[]
      | { event_management_form: boolean; engage_form: boolean }
      | null
  })[]) {
    const eventDate = minDate(sessionDatesOf(b))
    if (!eventDate) continue
    const days = daysBetween(base, eventDate)
    // Only once the event is upcoming and within N calendar months.
    if (days < 0 || utcMidnight(eventDate) > triggerCutoffMs(s.eventTriggerMonths)) continue

    const tracking = Array.isArray(b.event_tracking) ? b.event_tracking[0] : b.event_tracking
    const bodyName = nameOf(b.bodies ?? null)

    if (!tracking?.event_management_form) {
      actions.push({
        id: `event-form:${b.id}:mgmt`,
        kind: 'event-form',
        severity: severityForRange(days, s.eventMgmt[0], s.warningLeadDays),
        label: `Event Management Form — ${bodyName} · ${shortDate(eventDate)}`,
        originTab: 'Events',
        originId: b.id,
        referenceDate: eventDate,
      })
    }
    if (!tracking?.engage_form) {
      actions.push({
        id: `event-form:${b.id}:engage`,
        kind: 'event-form',
        severity: severityForRange(days, s.eventEngage[0], s.warningLeadDays),
        label: `Engage Form — ${bodyName} · ${shortDate(eventDate)}`,
        originTab: 'Events',
        originId: b.id,
        referenceDate: eventDate,
      })
    }
  }

  // --- Membership requests (always regular; not date-driven) ------------
  for (const mr of (memberships ?? []) as unknown as { id: string; bodies: NameRef }[]) {
    actions.push({
      id: `membership:${mr.id}`,
      kind: 'membership',
      severity: 'regular',
      label: `Membership request — ${nameOf(mr.bodies)}`,
      originTab: 'Users',
      originId: mr.id,
      referenceDate: null,
    })
  }

  // --- Aggregate ------------------------------------------------------------
  const severity = actions.reduce<Severity>(
    (max, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[max] ? a.severity : max),
    'regular'
  )
  const countKind = (k: PendingActionKind) => actions.filter(a => a.kind === k).length

  return {
    actions,
    total: actions.length,
    severity,
    requests: countKind('request'),
    revisions: countKind('revision'),
    cancellations: countKind('cancellation'),
    membership_requests: countKind('membership'),
  }
}
