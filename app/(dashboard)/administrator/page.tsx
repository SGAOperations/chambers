'use client'

import { useState, useEffect } from 'react'
import AdminGuard from '../adminguard'
import RequestsTab from './requests-tab'
import CancellationsTab from './cancellations-tab'
import BookingsTab from './bookings-tab'
import AdvancedSettingsTab from './advanced-settings-tab'
import SGASpacesTab from './sga-spaces-tab'

type Tab = 'Requests' | 'Cancellations' | 'Bookings' | 'SGA Spaces' | 'Advanced Settings'

export default function AdministratorPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Requests')
  const [counts, setCounts] = useState({ requests: 0, cancellations: 0, revisions: 0, total: 0 })

  useEffect(() => {
    const fetchCounts = async () => {
      const res = await fetch('/api/administrator/counts')
      if (res.ok) {
        const data = await res.json()
        setCounts(data)
      }
    }
    fetchCounts()
  }, [])

  const tabBadge = (tab: Tab) => {
    if (tab === 'Requests') return counts.requests + counts.revisions
    if (tab === 'Cancellations') return counts.cancellations
    return 0
  }

  return (
    <AdminGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Administrator</h1>

        <div className="flex gap-1 border-b border-[#1e5080]">
          {(['Requests', 'Cancellations', 'Bookings', 'SGA Spaces', 'Advanced Settings'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                  : 'border-transparent text-[#93b8d8] hover:text-[#f0f6ff]'
              }`}
            >
              {tab}
              {tabBadge(tab) > 0 && (
                <span className="bg-[#c8102e] text-white text-xs font-bold px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                  {tabBadge(tab)}
                </span>
              )}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'Requests' && <RequestsTab onCountChange={() => fetch('/api/administrator/counts').then(r => r.json()).then(d => setCounts(d))} />}
          {activeTab === 'Cancellations' && <CancellationsTab onCountChange={() => fetch('/api/administrator/counts').then(r => r.json()).then(d => setCounts(d))} />}
          {activeTab === 'Bookings' && <BookingsTab />}
          {activeTab === 'SGA Spaces' && <SGASpacesTab />}
          {activeTab === 'Advanced Settings' && <AdvancedSettingsTab />}
        </div>
      </div>
    </AdminGuard>
  )
}