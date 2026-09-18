'use client'

import { useEffect, useState } from 'react'

/**
 * A read-only view of someone else's SGA Space booking (issue #142).
 *
 * The calendar block can only fit so much -- often just the start of a title --
 * and until this existed there was no way to see the rest. Only the booking's
 * own creator could open it, and that opened the editor.
 *
 * Deliberately shows no external attendee addresses, only how many there are.
 * They are people without Chambers accounts, often interview candidates, and
 * the room display already refers to them as guests rather than by address for
 * the same reason (#132).
 */

interface ViewedBooking {
  title: string
  space_id: string
  start_time: string
  end_time: string
  attendee_ids: string[]
  external_attendees?: string[] | null
  creator_name: string | null
  series_id: string | null
}

interface SpaceBookingDetailsProps {
  booking: ViewedBooking
  spaceName: string
  onClose: () => void
}

// Booking times are stored as wall-clock values labelled UTC (local 2 PM is
// T14:00Z), so they are formatted in UTC to read back as the local time.
function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC',
  })
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric', minute: '2-digit', timeZone: 'UTC',
  })
}

export default function SpaceBookingDetails({ booking, spaceName, onClose }: SpaceBookingDetailsProps) {
  const [attendeeNames, setAttendeeNames] = useState<string[] | null>(null)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  // Names are fetched rather than carried on the booking, the same lookup the
  // editor uses. Until they arrive the count stands in, so nothing jumps.
  useEffect(() => {
    if (booking.attendee_ids.length === 0) return
    let cancelled = false
    fetch(`/api/users/by-ids?ids=${booking.attendee_ids.join(',')}`)
      .then(res => (res.ok ? res.json() : []))
      .then((users: { full_name: string }[]) => {
        if (!cancelled) setAttendeeNames(users.map(u => u.full_name).sort((a, b) => a.localeCompare(b)))
      })
      .catch(() => { if (!cancelled) setAttendeeNames([]) })
    return () => { cancelled = true }
  }, [booking.attendee_ids])

  const guests = booking.external_attendees?.length ?? 0
  const attendeeCount = booking.attendee_ids.length

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="space-booking-details-title"
        className="bg-[#0a1628] border border-[#1e5080] rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-[#1e5080]">
          <div className="min-w-0">
            {/* The whole title, wrapped: this view exists because the calendar can't fit it. */}
            <h2 id="space-booking-details-title" className="text-lg font-semibold text-[#f0f6ff] break-words">
              {booking.title}
            </h2>
            <p className="text-xs text-[#93b8d8] mt-0.5">{spaceName}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-[#93b8d8] hover:text-[#f0f6ff] transition-colors flex-shrink-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <dl className="p-5 space-y-3 text-sm">
          <div className="flex gap-3">
            <dt className="text-[#6a96bb] w-24 flex-shrink-0">When</dt>
            <dd className="text-[#f0f6ff]">
              {formatDay(booking.start_time)}
              <br />
              {formatTime(booking.start_time)} – {formatTime(booking.end_time)}
              {booking.series_id && <span className="block text-xs text-[#93b8d8] mt-0.5">Repeats weekly</span>}
            </dd>
          </div>
          <div className="flex gap-3">
            <dt className="text-[#6a96bb] w-24 flex-shrink-0">Host</dt>
            <dd className="text-[#f0f6ff]">{booking.creator_name ?? 'Unknown'}</dd>
          </div>
          {(attendeeCount > 0 || guests > 0) && (
            <div className="flex gap-3">
              <dt className="text-[#6a96bb] w-24 flex-shrink-0">Attendees</dt>
              <dd className="text-[#f0f6ff] min-w-0">
                {attendeeCount > 0 && (
                  attendeeNames && attendeeNames.length > 0
                    ? <span className="break-words">{attendeeNames.join(', ')}</span>
                    : <span>{attendeeCount} {attendeeCount === 1 ? 'person' : 'people'}</span>
                )}
                {guests > 0 && (
                  <span className="block text-[#93b8d8]">
                    {guests === 1 ? '1 guest' : `${guests} guests`} without a Chambers account
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>

        <p className="px-5 pb-5 text-xs text-[#6a96bb]">
          Read only. To change this booking, contact its host.
        </p>
      </div>
    </div>
  )
}
