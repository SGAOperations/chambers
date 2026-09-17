/**
 * The statuses a room request or a revision request moves through (issue #128).
 *
 * "Pending" hid the wait that matters most: much of the time a request sits with
 * CSC Operations, not with SGA. So an open request is in one of two states --
 *
 *   Ops Review    Operational Affairs has it (every new request starts here)
 *   Awaiting CSC  Operational Affairs has passed it to CSC Operations
 *
 * -- and then closes. A room request closes as Fulfilled or Denied; a revision
 * request as Done (granted by editing the booking) or Denied.
 *
 * Admins may move an open request between the two open states in either
 * direction. The UI suggests the usual order, and nothing enforces it.
 */

export const OPS_REVIEW = 'Ops Review'
export const AWAITING_CSC = 'Awaiting CSC'

export const OPEN_REQUEST_STATUSES = [OPS_REVIEW, AWAITING_CSC] as const
export type OpenRequestStatus = typeof OPEN_REQUEST_STATUSES[number]

export type RoomRequestStatus = OpenRequestStatus | 'Fulfilled' | 'Denied'
export type RevisionRequestStatus = OpenRequestStatus | 'Done' | 'Denied'

export function isOpenRequestStatus(status: unknown): status is OpenRequestStatus {
  return (OPEN_REQUEST_STATUSES as readonly unknown[]).includes(status)
}

/** What a requester is told each open status means. */
export const OPEN_STATUS_DESCRIPTIONS: Record<OpenRequestStatus, string> = {
  [OPS_REVIEW]: 'Operational Affairs is reviewing this request.',
  [AWAITING_CSC]: 'Operational Affairs has sent this request to CSC Operations and is waiting on their response.',
}

/**
 * The user_alerts.booking_type written when a request moves to Awaiting CSC.
 * A room request's alert carries request_id; a revision's carries booking_id,
 * for the reason given in app/api/administrator/revisions/route.ts.
 */
export const AWAITING_CSC_ALERT = 'Awaiting CSC'
export const REVISION_AWAITING_CSC_ALERT = 'Revision Awaiting CSC'
