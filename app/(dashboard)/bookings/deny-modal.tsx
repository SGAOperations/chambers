'use client'

import { useState } from 'react'
import BookingModal from './booking-modal'

interface DenyModalProps {
  requestId: string
  onClose: () => void
  onDenied: () => void
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

export default function DenyModal({ requestId, onClose, onDenied }: DenyModalProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async () => {
    setSaving(true)
    const res = await fetch('/api/administrator/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: requestId,
        status: 'Denied',
        denial_reason: reason.trim() || null,
      }),
    })

    if (res.ok) {
      onDenied()
      onClose()
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSaving(false)
  }

  return (
    <BookingModal title="Deny Request" onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Reason (optional)</label>
          <textarea
            placeholder="Provide a reason for denial..."
            value={reason}
            onChange={e => setReason(e.target.value)}
            rows={3}
            className={inputCls}
          />
        </div>

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={saving}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {saving ? 'Denying...' : 'Deny Request'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </BookingModal>
  )
}
