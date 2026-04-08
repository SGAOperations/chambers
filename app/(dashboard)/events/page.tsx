'use client'

import { useEffect, useState } from 'react'
import EventsGuard from '../eventsguard'
import { Skeleton } from '@/app/_components/skeleton'

interface EventBooking {
  id: string
  purpose: string
  type: string
  created_at: string
  bodies: { name: string } | null
  users: { full_name: string } | null
  one_time_room_bookings: {
    room_name: string | null
    booking_date: string
    start_time: string
    end_time: string
  }[] | null
  weekly_room_bookings: {
    room_name: string | null
    start_date: string
    end_date: string
    start_time: string
    end_time: string
  }[] | null
  tabling_bookings: {
    tabling_sessions: {
      location: string
      session_date: string
      start_time: string
      end_time: string
    }[]
  }[] | null
  event_tracking: {
    event_management_form: boolean
    engage_form: boolean
  }[] | null
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
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function ChecklistRow({
  label,
  checked,
  onChange,
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-center gap-3 cursor-pointer select-none group">
      <input
        type="checkbox"
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        className="w-4 h-4 rounded border border-[#1e5080] bg-[#0f2a4a] accent-[#c8102e] cursor-pointer"
      />
      <span className={`text-sm transition-colors ${checked ? 'text-[#4ade80] line-through' : 'text-[#f0f6ff] group-hover:text-white'}`}>
        {label}
      </span>
    </label>
  )
}

function BookingDetails({ booking }: { booking: EventBooking }) {
  if (booking.type === 'One-Time Room' && booking.one_time_room_bookings?.length) {
    const d = booking.one_time_room_bookings[0]
    return (
      <div className="text-sm text-[#93b8d8] space-y-0.5">
        {d.room_name && <p><span className="font-medium text-[#f0f6ff]">Room:</span> {d.room_name}</p>}
        <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(d.booking_date)}</p>
        <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(d.start_time)} – {formatTime(d.end_time)}</p>
      </div>
    )
  }

  if (booking.type === 'Weekly Room' && booking.weekly_room_bookings?.length) {
    const w = booking.weekly_room_bookings[0]
    return (
      <div className="text-sm text-[#93b8d8] space-y-0.5">
        {w.room_name && <p><span className="font-medium text-[#f0f6ff]">Room:</span> {w.room_name}</p>}
        <p><span className="font-medium text-[#f0f6ff]">Dates:</span> {formatDate(w.start_date)} – {formatDate(w.end_date)}</p>
        <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(w.start_time)} – {formatTime(w.end_time)}</p>
      </div>
    )
  }

  if (booking.type === 'Tabling' && booking.tabling_bookings?.[0]?.tabling_sessions?.length) {
    const sessions = booking.tabling_bookings[0].tabling_sessions
    return (
      <div className="text-sm text-[#93b8d8] space-y-1">
        {sessions.map((s, i) => (
          <div key={i} className={sessions.length > 1 ? 'border-t border-[#1e5080] pt-1 first:border-0 first:pt-0' : ''}>
            <p><span className="font-medium text-[#f0f6ff]">Location:</span> {s.location}</p>
            <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(s.session_date)}</p>
            <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(s.start_time)} – {formatTime(s.end_time)}</p>
          </div>
        ))}
      </div>
    )
  }

  return null
}

export default function EventsPage() {
  const [bookings, setBookings] = useState<EventBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [checklist, setChecklist] = useState<Record<string, { event_management_form: boolean; engage_form: boolean }>>({})

  useEffect(() => {
    const fetchEvents = async () => {
      const res = await fetch('/api/events')
      if (res.ok) {
        const data = await res.json()
        const list: EventBooking[] = data.bookings || []
        setBookings(list)

        // Initialise checklist state from DB
        const initial: typeof checklist = {}
        for (const b of list) {
          const t = b.event_tracking?.[0]
          initial[b.id] = {
            event_management_form: t?.event_management_form ?? false,
            engage_form: t?.engage_form ?? false,
          }
        }
        setChecklist(initial)
      }
      setLoading(false)
    }
    fetchEvents()
  }, [])

  const updateStep = async (bookingId: string, step: 'event_management_form' | 'engage_form', checked: boolean) => {
    // Optimistic update
    setChecklist(prev => ({
      ...prev,
      [bookingId]: { ...prev[bookingId], [step]: checked },
    }))

    await fetch('/api/events/checklist', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ booking_id: bookingId, step, checked }),
    })
  }

  return (
    <EventsGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Events</h1>

        {loading ? (
          <div className="space-y-4">
            {[0, 1].map(i => (
              <div key={i} className="border border-[#1e5080] rounded-xl bg-[#184073] shadow-sm overflow-hidden animate-pulse">
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3.5 w-56" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Skeleton className="h-5 w-12 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-3.5 w-40" />
                  </div>
                </div>
                <div className="border-t border-[#1e5080] px-5 py-4 bg-[#0f2a4a]/50 space-y-3">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <p className="text-[#6a96bb] text-sm">No event bookings found.</p>
        ) : (
          <div className="space-y-4">
            {bookings.map(b => {
              const steps = checklist[b.id] ?? { event_management_form: false, engage_form: false }
              return (
                <div key={b.id} className="border border-[#1e5080] rounded-xl bg-[#184073] shadow-sm overflow-hidden">
                  {/* Header */}
                  <div className="p-5 space-y-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold text-[#f0f6ff]">{b.bodies?.name}</p>
                        <p className="text-sm text-[#93b8d8]">{b.purpose}</p>
                        {b.users?.full_name && (
                          <p className="text-xs text-[#6a96bb] mt-0.5">Requested by {b.users.full_name}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#062f3b] text-[#22d3ee]">Event</span>
                        <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#0f2a4a] text-[#93b8d8]">{b.type}</span>
                      </div>
                    </div>

                    <BookingDetails booking={b} />
                  </div>

                  {/* Checklist */}
                  <div className="border-t border-[#1e5080] px-5 py-4 bg-[#0f2a4a]/50 space-y-3">
                    <p className="text-xs font-semibold text-[#93b8d8] uppercase tracking-wide">Tracking</p>
                    <ChecklistRow
                      label="Event Management Form"
                      checked={steps.event_management_form}
                      onChange={checked => updateStep(b.id, 'event_management_form', checked)}
                    />
                    <ChecklistRow
                      label="Engage Form"
                      checked={steps.engage_form}
                      onChange={checked => updateStep(b.id, 'engage_form', checked)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </EventsGuard>
  )
}
