import { db } from './db/data-api'
import { AWAITING_CSC_ALERT } from './request-status'

/**
 * Tells each requester their request has gone to CSC.
 *
 * Shared by "Mark Sent to CSC" and Auto-Request (issue #226), which reach the
 * same status by different roads and should leave the requester knowing the
 * same thing either way.
 *
 * Never throws. The status has already moved when this runs, and failing the
 * response over a missing alert would invite the admin to move it again -- or,
 * for Auto-Request, to email CSC again.
 */
export async function alertAwaitingCsc(
  requests: { id: string; requestedBy: string | null }[]
): Promise<void> {
  const rows = requests
    .filter(r => r.requestedBy)
    .map(r => ({ user_id: r.requestedBy, request_id: r.id, booking_type: AWAITING_CSC_ALERT }))
  if (!rows.length) return

  const { error } = await db.from('user_alerts').insert(rows)
  if (error) console.error('Awaiting CSC alert failed:', error)
}
