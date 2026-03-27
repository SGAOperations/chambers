'use client'

import { useState } from 'react'
import UsersTab from './users-tab'
import BodiesTab from './bodies-tab'
import AuditTab from './audit-tab'
import BookingSettingsTab from './booking-settings-tab'

type AdvancedSubTab = 'Users' | 'Bodies' | 'Audit' | 'Other Settings'

export default function AdvancedSettingsTab() {
  const [subTab, setSubTab] = useState<AdvancedSubTab>('Users')

  return (
    <div className="space-y-4">
      <div className="flex gap-1 border-b border-[#1e5080]">
        {(['Users', 'Bodies', 'Audit', 'Other Settings'] as AdvancedSubTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              subTab === tab
                ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                : 'border-transparent text-[#93b8d8] hover:text-[#f0f6ff]'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {subTab === 'Users' && <UsersTab />}
      {subTab === 'Bodies' && <BodiesTab />}
      {subTab === 'Audit' && <AuditTab />}
      {subTab === 'Other Settings' && <BookingSettingsTab />}
    </div>
  )
}
