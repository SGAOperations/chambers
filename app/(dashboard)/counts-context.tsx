'use client'

import { createContext, useContext } from 'react'
import type { AlertRow } from '@/lib/dashboard-data'
import {
  EMPTY_PENDING_ACTIONS,
  type PendingAction,
  type PendingActionsResult,
  type Severity,
} from '@/lib/pending-actions'

export type Counts = PendingActionsResult
export type { PendingAction, Severity } from '@/lib/pending-actions'

export const EMPTY_COUNTS: Counts = EMPTY_PENDING_ACTIONS

const SEVERITY_RANK: Record<Severity, number> = { regular: 0, warning: 1, danger: 2 }

/** Most severe severity across a set of actions; 'regular' when empty. */
export function severityOf(actions: PendingAction[]): Severity {
  return actions.reduce<Severity>(
    (max, a) => (SEVERITY_RANK[a.severity] > SEVERITY_RANK[max] ? a.severity : max),
    'regular'
  )
}

/**
 * Shared badge styling for any Pending Actions count (sidebar total, Administrator
 * tab badges): blue regular, amber warning, flashing red danger. The danger flash
 * lives in .pa-badge-danger in globals.css.
 */
export function paBadgeClass(severity: Severity): string {
  const base = 'text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center'
  if (severity === 'danger') return `${base} pa-badge-danger`
  if (severity === 'warning') return `${base} bg-[#fbbf24] text-[#1a1400]`
  return `${base} bg-[#4285f4] text-white`
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
