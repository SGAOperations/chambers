'use client'

import { useState } from 'react'
import BookingModal from '../administrator/booking-modal'
import { type FlatBooking, statusTextColors, senateTypeBadgeColors, DEFAULT_SENATE_BADGE } from './shared'

interface BookingDetailModalProps {
  booking: FlatBooking
  isLeadership: boolean
  onClose: () => void
  onCancelClick: () => void
  onRevisionClick: () => void
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

export default function BookingDetailModal({ booking, isLeadership, onClose, onCancelClick, onRevisionClick }: BookingDetailModalProps) {
  const canCancel = isLeadership && !['Pending Cancellation', 'Cancelled', 'Virtual'].includes(booking.status)
  const canRevise = isLeadership && !['Cancelled', 'Missed', 'Repurposed'].includes(booking.status)

  // A multi-body booking collapses to "Owner + N others". There is no hover on
  // touch, so the field has to be tap-to-expand to reveal the peer bodies (#28).
  const [bodiesExpanded, setBodiesExpanded] = useState(false)
  const scopeFull = booking.scopeFull ?? [booking.scopeLabel]
  const hasPeerBodies = scopeFull.length > 1

  return (
    <BookingModal title="Booking Details" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#6a96bb]">
            {booking.type === 'One-Time Room' ? 'One-Time/Multiple Room' : booking.type}
          </span>
          <span className={`text-sm font-semibold ${statusTextColors[booking.status] || 'text-[#93b8d8]'}`}>
            {booking.status}
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {hasPeerBodies ? (
            <button
              type="button"
              onClick={() => setBodiesExpanded(v => !v)}
              aria-expanded={bodiesExpanded}
              className="text-lg font-bold text-[#f0f6ff] text-left underline decoration-dotted underline-offset-4 hover:text-[#c8102e] transition-colors"
            >
              {bodiesExpanded ? scopeFull.join(' + ') : booking.scopeLabel}
            </button>
          ) : (
            <p className="text-lg font-bold text-[#f0f6ff]">{booking.scopeLabel}</p>
          )}
          {booking.senateType && (
            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${senateTypeBadgeColors[booking.senateType] || DEFAULT_SENATE_BADGE}`}>{booking.senateType}</span>
          )}
        </div>

        <div className="space-y-2 text-sm">
          <div className="flex gap-2">
            <span className="text-[#6a96bb] w-24 flex-shrink-0">Purpose</span>
            <span className="text-[#f0f6ff]">{booking.purpose}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#6a96bb] w-24 flex-shrink-0">Location</span>
            <span className="text-[#f0f6ff]">{booking.location}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#6a96bb] w-24 flex-shrink-0">Date</span>
            <span className="text-[#f0f6ff]">{formatDate(booking.date)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#6a96bb] w-24 flex-shrink-0">Time</span>
            <span className="text-[#f0f6ff]">{formatTime(booking.startTime)} – {formatTime(booking.endTime)}</span>
          </div>
          {booking.reservationCode && (
            <div className="flex gap-2">
              <span className="text-[#6a96bb] w-24 flex-shrink-0">Res. Code</span>
              <span className="text-[#f0f6ff] font-mono">{booking.reservationCode}</span>
            </div>
          )}
        </div>

        {(canCancel || canRevise) && (
          <div className="flex flex-col gap-2 mt-2">
            {canRevise && (
              <button
                onClick={onRevisionClick}
                className="w-full py-2.5 rounded-xl bg-[#1a4d8a] hover:bg-[#2563eb] hover:scale-105 text-white font-semibold text-sm transition-all"
              >
                Request Revision
              </button>
            )}
            {canCancel && (
              <button
                onClick={onCancelClick}
                className="w-full py-2.5 rounded-xl bg-[#c8102e] hover:bg-[#a00d24] hover:scale-105 text-white font-semibold text-sm transition-all"
              >
                Request Cancellation
              </button>
            )}
          </div>
        )}
      </div>
    </BookingModal>
  )
}
