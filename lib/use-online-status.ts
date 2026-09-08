'use client'

import { useSyncExternalStore } from 'react'

function subscribe(onStoreChange: () => void) {
  window.addEventListener('online', onStoreChange)
  window.addEventListener('offline', onStoreChange)
  return () => {
    window.removeEventListener('online', onStoreChange)
    window.removeEventListener('offline', onStoreChange)
  }
}

const getSnapshot = () => navigator.onLine

// The server has no opinion on the visitor's connection, and rendering the
// offline state into the HTML would be wrong for almost everyone. React
// compares this against the client snapshot after hydration and re-renders if
// they disagree, so an offline visitor still sees the banner -- a tick later,
// without a hydration mismatch.
const getServerSnapshot = () => true

/**
 * Whether the browser currently has a network interface up.
 *
 * useSyncExternalStore rather than useEffect + useState: the events fire
 * outside React, and this way the first paint after hydration already has the
 * right answer.
 *
 * Read `isOffline()` from lib/network-error for one-off checks inside event
 * handlers; this hook is for rendering. Both are the same signal, and both are
 * only trustworthy in the negative -- see the note there.
 */
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot)
}
