'use client'

import { createContext, useContext } from 'react'

/**
 * Bridges the sidebar total (rendered by the layout) and the tab rows that are a
 * danger action's origin (issue #38 #4/#5):
 *
 *  - `isDanger(originId)` -- true when that row has a danger-severity action, so
 *    a tab can flash its title (`pa-row-danger` + `pa-row-title`).
 *  - `registerOrigin(originId)` -- a stable ref callback the tab spreads onto the
 *    row element; the layout observes it and, while any danger row is on screen,
 *    settles the sidebar total from flashing to static red.
 */
export interface PendingActionsWatch {
  isDanger: (originId: string) => boolean
  registerOrigin: (originId: string) => (el: HTMLElement | null) => void
}

export const PendingActionsWatchContext = createContext<PendingActionsWatch>({
  isDanger: () => false,
  registerOrigin: () => () => {},
})

export const usePendingActionsWatch = () => useContext(PendingActionsWatchContext)
