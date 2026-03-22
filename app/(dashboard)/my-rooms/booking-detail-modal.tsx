'use client'

import BookingModal from '../management/booking-modal'

const statusTextColors: Record<string, string> = {
  'Reserved': 'text-[#4ade80]',
  'Alternate Room': 'text-[#93c5fd]',
  'Alternate Time': 'text-[#93c5fd]',
  'Waitlisted': 'text-[#f87171]',
  'Unavailable': 'text-[#f87171]',
  'Pending Cancellation': 'text-[#fb923c]',
  'Cancelled': 'text-[#c084fc]',
  'Virtual': 'text-[#22d3ee]',
  'Missed': 'text-[#a78bfa]',
}

interface FlatBooking {
  id: string
  bookingId: string
  bodyId: string
  type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
  bodyName: string
  purpose: string
  location: string
  date: string
  startTime: string
  endTime: string
  status: string
  reservationCode: string | null
  senateType: string | null
}

interface BookingDetailModalProps {
  booking: FlatBooking
  isLeadership: boolean
  onClose: () => void
  onCancelClick: () => void
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

export default function BookingDetailModal({ booking, isLeadership, onClose, onCancelClick }: BookingDetailModalProps) {
  const canCancel = isLeadership && !['Pending Cancellation', 'Cancelled', 'Virtual'].includes(booking.status)

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

        <div className="flex items-center gap-2">
          <p className="text-lg font-bold text-[#f0f6ff]">{booking.bodyName}</p>
          {booking.senateType && (
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#c8102e] text-white">{booking.senateType}</span>
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

        {canCancel && (
          <button
            onClick={onCancelClick}
            className="w-full mt-2 py-2.5 rounded-xl bg-[#c8102e] hover:bg-[#a00d24] text-white font-semibold text-sm transition-colors"
          >
            Request Cancellation
          </button>
        )}
      </div>
    </BookingModal>
  )
}
