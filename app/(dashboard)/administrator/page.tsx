'use client'

import { useState } from 'react'
import AdminGuard from '../adminguard'
import { useCounts, paBadgeClass, severityOf } from '../counts-context'
import { usePendingActionsWatch } from '../pending-actions-watch'
import RequestsTab from './requests-tab'
import CancellationsTab from './cancellations-tab'
import BookingsTab from './bookings-tab'
import SGASpacesTab from './sga-spaces-tab'

/**
 * The former Administrator page, now Bookings (issue #64).
 *
 * Its Advanced Settings tab -- users, bodies, audit, archive, other settings --
 * has become the Management page, which is gated to high-access admins. What is
 * left here is the booking work itself, open to every admin.
 */
type Tab = 'Requests' | 'Cancellations' | 'Bookings' | 'SGA Spaces'

export default function AdministratorPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Bookings')
  // Shared with the layout's sidebar badge instead of refetching the same
  // endpoint on every Administrator page load.
  const { counts, refreshCounts } = useCounts()
  const { registerTabBadge, tabBadgeIsIdle } = usePendingActionsWatch()

  // Actions whose origin is this tab, so the badge count + colour match the
  // sidebar total and its hover breakdown (issue #38).
  const tabActions = (tab: Tab) => {
    if (tab === 'Requests') return counts.actions.filter(a => a.originTab === 'Requests')
    if (tab === 'Cancellations') return counts.actions.filter(a => a.originTab === 'Cancellations')
    return []
  }

  return (
    <AdminGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Bookings</h1>

        <div className="flex gap-1 border-b border-[#1e5080] overflow-x-auto overflow-y-hidden">
          {(['Bookings', 'SGA Spaces', 'Cancellations', 'Requests'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === tab
                  ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                  : 'border-transparent text-[#93b8d8] hover:text-[#c8102e]'
              }`}
            >
              {tab}
              {(() => {
                const acts = tabActions(tab)
                if (acts.length === 0) return null
                const sev = severityOf(acts)
                const originTab = tab as 'Requests' | 'Cancellations'
                return (
                  <span
                    ref={registerTabBadge(originTab)}
                    className={paBadgeClass(sev, sev === 'danger' && tabBadgeIsIdle(originTab))}
                  >
                    {acts.length}
                  </span>
                )
              })()}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'Requests' && <RequestsTab onCountChange={refreshCounts} />}
          {activeTab === 'Cancellations' && <CancellationsTab onCountChange={refreshCounts} />}
          {activeTab === 'Bookings' && <BookingsTab />}
          {activeTab === 'SGA Spaces' && <SGASpacesTab />}
        </div>
      </div>
    </AdminGuard>
  )
}