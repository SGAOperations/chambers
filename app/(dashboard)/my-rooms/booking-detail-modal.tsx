'use client'

import { useEffect, useState } from 'react'
import BookingModal from '../bookings/booking-modal'
import { type FlatBooking, statusTextColors, senateTypeBadgeColors, DEFAULT_SENATE_BADGE } from './shared'
import { AWAITING_CSC, OPEN_STATUS_DESCRIPTIONS, type OpenRequestStatus } from '@/lib/request-status'

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

  // The booking's open revision request, if any, so its leaders can see where it
  // stands -- with Operational Affairs or with CSC (issue #128). Only leaders may
  // request a revision, so only they are asked about one.
  const [openRevision, setOpenRevision] = useState<{ status: OpenRequestStatus; created_at: string } | null>(null)
  useEffect(() => {
    if (!isLeadership) return
    let cancelled = false
    fetch(`/api/revision-requests?booking_id=${encodeURIComponent(booking.bookingId)}`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => { if (!cancelled) setOpenRevision(data?.revision ?? null) })
      .catch(() => {})
    return () => { cancelled = true }
  }, [isLeadership, booking.bookingId])

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
          {/*
            Both rows, always, even when they carry the same time. This is the
            detail view -- the one place someone comes to find out exactly what
            was booked -- so it is worth a line to say that the meeting starts at
            one time and the room is held from another, rather than collapsing
            them the way the cards do and leaving the distinction unexplained
            (issue #126).
          */}
          <div className="flex gap-2">
            <span className="text-[#6a96bb] w-24 flex-shrink-0">Meeting Time</span>
            <span className="text-[#f0f6ff] font-semibold">{formatTime(booking.meetingTime)}</span>
          </div>
          <div className="flex gap-2">
            <span className="text-[#6a96bb] w-24 flex-shrink-0">Reserved</span>
            <span className="text-[#f0f6ff]">{formatTime(booking.startTime)} – {formatTime(booking.endTime)}</span>
          </div>
          {booking.reservationCode && (
            <div className="flex gap-2">
              <span className="text-[#6a96bb] w-24 flex-shrink-0">Res. Code</span>
              <span className="text-[#f0f6ff] font-mono">{booking.reservationCode}</span>
            </div>
          )}
        </div>

        {openRevision && (
          <div className={`rounded-lg border px-3 py-2.5 text-sm ${
            openRevision.status === AWAITING_CSC
              ? 'border-[#a78bfa]/30 bg-[#a78bfa]/10 text-[#c4b5fd]'
              : 'border-[#fbbf24]/30 bg-[#fbbf24]/10 text-[#fcd34d]'
          }`}>
            <p className="font-semibold">Revision request: {openRevision.status}</p>
            <p className="text-xs mt-0.5 opacity-90">
              {OPEN_STATUS_DESCRIPTIONS[openRevision.status]} Submitted{' '}
              {new Date(openRevision.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}.
            </p>
          </div>
        )}

        {(canCancel || canRevise) && (
          <div className="flex flex-col gap-2 mt-2">
            {canRevise && !openRevision && (
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
