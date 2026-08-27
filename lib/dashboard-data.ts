import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared readers for the dashboard shell: the admin pending actions and the
 * current user's alerts. /api/dashboard returns both in one call for first
 * paint; /api/administrator/counts and /api/alerts still expose them
 * individually for targeted refreshes and the notification actions.
 */

// The dashboard "counts" payload is now the full pending-actions result (issue
// #38) -- a list of actions with per-item severity, plus the legacy per-category
// counts and total so existing consumers keep working.
export type { PendingActionsResult as Counts } from './pending-actions'

export interface AlertRow {
  id: string
  booking_id: string | null
  request_id: string | null
  booking_type: string
  booking_date: string | null
  start_time: string | null
  created_at: string
  denial_reason: string | null
  bookings: { bodies: { name: string } | null } | null
  room_requests: { bodies: { name: string } | null } | null
}

const ALERT_SELECT =
  'id, booking_id, request_id, booking_type, booking_date, start_time, created_at, denial_reason, bookings!booking_id(bodies(name)), room_requests!request_id(bodies(name))'

export async function fetchUserAlerts(
  adminSupabase: SupabaseClient,
  userId: string
): Promise<AlertRow[]> {
  const { data } = await adminSupabase
    .from('user_alerts')
    .select(ALERT_SELECT)
    .eq('user_id', userId)
    .eq('dismissed', false)
    .order('created_at', { ascending: false })

  return (data as AlertRow[] | null) ?? []
}
