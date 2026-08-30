'use client'

import { useState } from 'react'
import ManagementGuard from '../managementguard'
import UsersTab from './users-tab'
import BodiesTab from './bodies-tab'
import AuditTab from './audit-tab'
import ArchiveTab from './archive-tab'
import BookingSettingsTab from './booking-settings-tab'

/**
 * Management -- the former Administrator > Advanced Settings sub-tabs, promoted
 * to a root page of their own (issue #64).
 *
 * Administrator had outgrown a single tab strip: five tabs, one of which opened
 * a second strip of five underneath it. These five have a different audience
 * anyway -- they configure the system rather than run the week's bookings -- so
 * they became their own page with their own guard, and Administrator was renamed
 * to Bookings for what it actually is now.
 */
type Tab = 'Users' | 'Bodies' | 'Audit' | 'Archive' | 'Other Settings'

const TABS: Tab[] = ['Users', 'Bodies', 'Audit', 'Archive', 'Other Settings']

export default function ManagementPage() {
  const [activeTab, setActiveTab] = useState<Tab>('Users')

  return (
    <ManagementGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Management</h1>

        <div className="flex gap-1 border-b border-[#1e5080] overflow-x-auto overflow-y-hidden">
          {TABS.map(tab => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap flex-shrink-0 ${
                activeTab === tab
                  ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                  : 'border-transparent text-[#93b8d8] hover:text-[#c8102e]'
              }`}
            >
              {tab}
            </button>
          ))}
        </div>

        <div>
          {activeTab === 'Users' && <UsersTab />}
          {activeTab === 'Bodies' && <BodiesTab />}
          {activeTab === 'Audit' && <AuditTab />}
          {activeTab === 'Archive' && <ArchiveTab />}
          {activeTab === 'Other Settings' && <BookingSettingsTab />}
        </div>
      </div>
    </ManagementGuard>
  )
}
