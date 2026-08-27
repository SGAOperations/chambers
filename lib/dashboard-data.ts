import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Shared readers for the dashboard shell: the admin pending-action counts and
 * the current user's alerts. /api/dashboard returns both in one call for first
 * paint; /api/administrator/counts and /api/alerts still expose them
 * individually for targeted refreshes and the notification actions.
 */

export type Counts = {
  requests: number
  cancellations: number
  revisions: number
  membership_requests: number
  total: number
}

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

export async function fetchPendingCounts(supabase: SupabaseClient): Promise<Counts> {
  const [
    { count: requestCount },
    { count: cancellationCount },
    { count: revisionCount },
    { count: membershipRequestCount },
  ] = await Promise.all([
    supabase.from('room_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('cancellation_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('revision_requests').select('*', { count: 'exact', head: true }).eq('status', 'Pending'),
    supabase.from('membership_requests').select('*', { count: 'exact', head: true }).eq('status', 'pending'),
  ])

  const requests = requestCount || 0
  const cancellations = cancellationCount || 0
  const revisions = revisionCount || 0
  const membership_requests = membershipRequestCount || 0

  return {
    requests,
    cancellations,
    revisions,
    membership_requests,
    total: requests + cancellations + revisions + membership_requests,
  }
}

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
