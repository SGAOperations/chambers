'use client'

import { useState, useEffect } from 'react'
import AdminGuard from '../adminguard'
import RequestsTab from './requests-tab'
import CancellationsTab from './cancellations-tab'
import BookingsTab from './bookings-tab'
import UsersTab from './users-tab'
import BodiesTab from './bodies-tab'

type Tab = 'Requests' | 'Cancellations' | 'Bookings' | 'Users' | 'Bodies'

export default function ManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Requests')
  const [counts, setCounts] = useState({ requests: 0, cancellations: 0, total: 0 })

  useEffect(() => {
    const fetchCounts = async () => {
      const res = await fetch('/api/management/counts')
      if (res.ok) {
        const data = await res.json()
        setCounts(data)
      }
    }
    fetchCounts()
  }, [])

  const tabBadge = (tab: Tab) => {
    if (tab === 'Requests') return counts.requests
    if (tab === 'Cancellations') return counts.cancellations
    return 0
  }

  return (
    <AdminGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#0f172a]">Management</h1>

        <div className="flex gap-1 border-b border-[#e2e8f0]">
          {(['Requests', 'Cancellations', 'Bookings', 'Users', 'Bodies'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-[#c8102e] text-[#0a1628] font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
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
          {activeTab === 'Requests' && <RequestsTab onCountChange={() => fetch('/api/management/counts').then(r => r.json()).then(d => setCounts(d))} />}
          {activeTab === 'Cancellations' && <CancellationsTab onCountChange={() => fetch('/api/management/counts').then(r => r.json()).then(d => setCounts(d))} />}
          {activeTab === 'Bookings' && <BookingsTab />}
          {activeTab === 'Users' && <UsersTab />}
          {activeTab === 'Bodies' && <BodiesTab />}
        </div>
      </div>
    </AdminGuard>
  )
}