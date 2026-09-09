'use client'

import { useState } from 'react'
import BookingModal from './booking-modal'

interface DenyModalProps {
  requestId: string
  onClose: () => void
  onDenied: () => void
  /**
   * Which kind of thing is being denied. Room requests and revision requests ask
   * the admin for exactly the same thing -- an optional reason -- and differ only
   * in where that goes, so they share this modal rather than having two that
   * drift apart (issue #77).
   */
  kind?: 'request' | 'revision'
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

export default function DenyModal({ requestId, onClose, onDenied, kind = 'request' }: DenyModalProps) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const isRevision = kind === 'revision'

  const handleSubmit = async () => {
    setSaving(true)
    setError('')

    const res = await fetch(
      isRevision ? '/api/administrator/revisions' : '/api/administrator/requests',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          isRevision
            // The revisions route only ever denies, so it takes no status --
            // there is no other transition to ask it for.
            ? { id: requestId, denial_reason: reason.trim() || null }
            : { id: requestId, status: 'Denied', denial_reason: reason.trim() || null }
        ),
      }
    )

    if (res.ok) {
      onDenied()
      onClose()
    } else {
      const data = await res.json().catch(() => ({}))
      setError(data.error || 'Something went wrong.')
      // Left open on failure. A 409 here means someone else already resolved
      // this one, and the admin needs to read that rather than have the modal
      // vanish as though it had worked.
      setSaving(false)
      return
    }
    setSaving(false)
  }

  return (
    <BookingModal title={isRevision ? 'Deny Revision Request' : 'Deny Request'} onClose={onClose}>
      <div className="space-y-4">
        <div>
          <label className={labelCls}>Reason (optional)</label>
          <textarea
            placeholder={isRevision
              ? 'e.g. that room is already booked for this slot...'
              : 'Provide a reason for denial...'}
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
            {saving ? 'Denying...' : isRevision ? 'Deny Revision' : 'Deny Request'}
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
