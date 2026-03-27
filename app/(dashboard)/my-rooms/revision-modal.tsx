'use client'

import { useState } from 'react'
import TimePicker from '../management/time-picker'

interface RevisionModalProps {
  booking: {
    id: string
    type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
    bodyName: string
    purpose: string
    location: string
  }
  onClose: () => void
  onSuccess: () => void
}

export default function RevisionModal({ booking, onClose, onSuccess }: RevisionModalProps) {
  const [changeType, setChangeType] = useState<'Time' | 'Room' | 'Both'>('Time')
  const [hoveredOpt, setHoveredOpt] = useState<string | null>(null)
  const [newStartTime, setNewStartTime] = useState('')
  const [newEndTime, setNewEndTime] = useState('')
  const [newRoom, setNewRoom] = useState('')
  const [moreInfo, setMoreInfo] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const showTime = changeType === 'Time' || changeType === 'Both'
  const showRoom = changeType === 'Room' || changeType === 'Both'

  const handleSubmit = async () => {
    if (!moreInfo.trim()) {
      setError('More information is required.')
      return
    }
    setSubmitting(true)
    setError('')
    const res = await fetch('/api/revision-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: booking.id,
        change_type: changeType,
        new_start_time: showTime ? newStartTime || null : null,
        new_end_time: showTime ? newEndTime || null : null,
        new_room: showRoom ? newRoom || null : null,
        more_info: moreInfo.trim(),
      }),
    })

    if (res.ok) {
      onSuccess()
      onClose()
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSubmitting(false)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#f0f6ff]">Request Revision</h2>
          <button onClick={onClose} className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors">✕</button>
        </div>

        {/* Booking summary */}
        <div className="bg-[#0f2a4a] rounded-lg px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-[#f0f6ff]">{booking.bodyName} — {booking.location}</p>
          <p className="text-xs text-[#93b8d8]">{booking.purpose} · {booking.type === 'One-Time Room' ? 'One-Time/Multiple Room' : booking.type}</p>
        </div>

        {/* Change type selector */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#93b8d8]">What would you like to change?</p>
          <div className="flex flex-col gap-2">
            {(['Time', 'Room', 'Both'] as const).map(opt => (
              <label
                key={opt}
                onMouseEnter={() => setHoveredOpt(opt)}
                onMouseLeave={() => setHoveredOpt(null)}
                className={`flex items-center gap-3 cursor-pointer px-3 py-2 rounded-lg ring-1 transition-all ${hoveredOpt === opt ? 'ring-red-600' : 'ring-transparent'}`}
              >
                <input
                  type="radio"
                  name="changeType"
                  value={opt}
                  checked={changeType === opt}
                  onChange={() => setChangeType(opt)}
                  className="accent-[#c8102e]"
                />
                <span className="text-sm text-[#f0f6ff]">{opt === 'Both' ? 'Both Time and Room' : opt}</span>
              </label>
            ))}
          </div>
        </div>

        {/* Time fields */}
        {showTime && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#93b8d8]">Requested Time</p>
            <div className="flex gap-3">
              <div className="flex-1 space-y-1">
                <label className="text-xs text-[#6a96bb]">Start</label>
                <TimePicker value={newStartTime} onChange={setNewStartTime} />
              </div>
              <div className="flex-1 space-y-1">
                <label className="text-xs text-[#6a96bb]">End</label>
                <TimePicker value={newEndTime} onChange={setNewEndTime} />
              </div>
            </div>
          </div>
        )}

        {/* Room field */}
        {showRoom && (
          <div className="space-y-2">
            <p className="text-xs font-medium text-[#93b8d8]">Requested Room</p>
            <input
              type="text"
              value={newRoom}
              onChange={e => setNewRoom(e.target.value)}
              placeholder="Room name or preference"
              className="w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2 text-sm text-[#f0f6ff] placeholder-[#3a6080] focus:outline-none focus:border-[#6a96bb]"
            />
          </div>
        )}

        {/* More information */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#93b8d8]">More Information <span className="text-[#c8102e]">*</span></p>
          <textarea
            value={moreInfo}
            onChange={e => setMoreInfo(e.target.value)}
            placeholder="Provide any additional context or reason for this revision..."
            rows={3}
            className="w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2 text-sm text-[#f0f6ff] placeholder-[#3a6080] focus:outline-none focus:border-[#6a96bb] resize-none"
          />
        </div>

        {error && <p className="text-[#c8102e] text-sm">{error}</p>}

        <div className="flex gap-2 pt-2">
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Request'}
          </button>
          <button
            onClick={onClose}
            className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
