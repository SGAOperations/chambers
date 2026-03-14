'use client'

import { useState } from 'react'
import AdminGuard from '../adminguard'
import RequestsTab from './requests-tab'
import BookingsTab from './bookings-tab'
import UsersTab from './users-tab'
import BodiesTab from './bodies-tab'

type Tab = 'Requests' | 'Bookings' | 'Users' | 'Bodies'

export default function ManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Requests')

  return (
    <AdminGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#0f172a]">Management</h1>

        <div className="flex gap-1 border-b border-[#e2e8f0]">
          {(['Requests', 'Bookings', 'Users', 'Bodies'] as Tab[]).map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-[#c8102e] text-[#0a1628] font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'Requests' && <RequestsTab />}
          {activeTab === 'Bookings' && <BookingsTab />}
          {activeTab === 'Users' && <UsersTab />}
          {activeTab === 'Bodies' && <BodiesTab />}
        </div>
      </div>
    </AdminGuard>
  )
}