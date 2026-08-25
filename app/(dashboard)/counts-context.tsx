'use client'

import { createContext, useContext } from 'react'

export type Counts = {
  requests: number
  cancellations: number
  revisions: number
  membership_requests: number
  total: number
}

export const EMPTY_COUNTS: Counts = {
  requests: 0,
  cancellations: 0,
  revisions: 0,
  membership_requests: 0,
  total: 0,
}

type CountsContextValue = {
  counts: Counts
  refreshCounts: () => void
}

/**
 * The dashboard layout already fetches /api/administrator/counts for the sidebar
 * badge. Sharing it here stops the Administrator page from fetching the exact
 * same endpoint a second time on every load.
 */
export const CountsContext = createContext<CountsContextValue>({
  counts: EMPTY_COUNTS,
  refreshCounts: () => {},
})

export function useCounts() {
  return useContext(CountsContext)
}
