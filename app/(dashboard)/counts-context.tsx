'use client'

import { createContext, useContext } from 'react'
import type { Counts, AlertRow } from '@/lib/dashboard-data'

export type { Counts } from '@/lib/dashboard-data'

export const EMPTY_COUNTS: Counts = {
  requests: 0,
  cancellations: 0,
  revisions: 0,
  membership_requests: 0,
  total: 0,
}

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
