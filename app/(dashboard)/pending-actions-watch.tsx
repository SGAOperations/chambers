'use client'

import { createContext, useContext } from 'react'
import type { OriginTab } from '@/lib/pending-actions'

/**
 * The danger-idling cascade (issue #38 #5). Three indicators, most specific last:
 *
 *   1. sidebar total        -- flashes unless a more specific danger indicator
 *                              (an Administrator tab badge, or a row title) is
 *                              on screen.
 *   2. Administrator tab    -- flashes unless one of its danger rows' flashing
 *      badge (Requests /       titles is on screen.
 *      Cancellations)
 *   3. row title            -- always flashes while the row's action is danger.
 *
 * The layout owns one IntersectionObserver over the registered elements and
 * exposes the resolved idle state for levels 1 and 2.
 */
export interface PendingActionsWatch {
  /** Row's action is danger -> flash its title. */
  isDanger: (originId: string) => boolean
  /** A single action (by its `PendingAction.id`, e.g. `event-form:<bookingId>:mgmt`)
   *  is danger -> flash just that action's own text (issue #45), independent of
   *  whether the row's aggregate `isDanger` is also true. */
  isActionDanger: (actionId: string) => boolean
  /** Ref callback for a tab row (level 3). */
  registerOrigin: (originId: string) => (el: HTMLElement | null) => void
  /** Ref callback for an Administrator tab badge (level 2). */
  registerTabBadge: (tab: OriginTab) => (el: HTMLElement | null) => void
  /** Level 1: the sidebar total should sit static rather than flash. */
  totalIsIdle: boolean
  /** Level 2: this tab's badge should sit static rather than flash. */
  tabBadgeIsIdle: (tab: OriginTab) => boolean
}

export const PendingActionsWatchContext = createContext<PendingActionsWatch>({
  isDanger: () => false,
  isActionDanger: () => false,
  registerOrigin: () => () => {},
  registerTabBadge: () => () => {},
  totalIsIdle: false,
  tabBadgeIsIdle: () => false,
})

export const usePendingActionsWatch = () => useContext(PendingActionsWatchContext)
