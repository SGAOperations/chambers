'use client'

import { createContext, useContext } from 'react'
import type { AlertRow } from '@/lib/dashboard-data'
import { EMPTY_PENDING_ACTIONS, type PendingActionsResult } from '@/lib/pending-actions'

export type Counts = PendingActionsResult
export type { PendingAction, Severity } from '@/lib/pending-actions'

export const EMPTY_COUNTS: Counts = EMPTY_PENDING_ACTIONS

type CountsContextValue = {
  counts: Counts
  alerts: AlertRow[]
  refreshCounts: () => void
}

/**
 * The dashboard layout fetches /api/dashboard once for the sidebar badge and the
 * notification bell. Sharing counts here stops the Administrator page from
 * fetching them again on every load; sharing alerts stops the bell from adding
 * its own round trip on the My Rooms first paint.
 */
export const CountsContext = createContext<CountsContextValue>({
  counts: EMPTY_COUNTS,
  alerts: [],
  refreshCounts: () => {},
})

export function useCounts() {
  return useContext(CountsContext)
}
