'use client'

import { useState } from 'react'
import AdminGuard from '../adminguard'
import { useCounts, paBadgeClass, severityOf } from '../counts-context'
import { usePendingActionsWatch } from '../pending-actions-watch'
import RequestsTab from './requests-tab'
import CancellationsTab from './cancellations-tab'
import BookingsTab from './bookings-tab'
import AdvancedSettingsTab from './advanced-settings-tab'
import SGASpacesTab from './sga-spaces-tab'

type Tab = 'Requests' | 'Cancellations' | 'Bookings' | 'SGA Spaces' | 'Advanced Settings'

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
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Administrator</h1>

        <div className="flex gap-1 border-b border-[#1e5080] overflow-x-auto overflow-y-hidden">
          {(['Bookings', 'SGA Spaces', 'Cancellations', 'Requests', 'Advanced Settings'] as Tab[]).map(tab => (
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
          {activeTab === 'Advanced Settings' && <AdvancedSettingsTab />}
        </div>
      </div>
    </AdminGuard>
  )
}