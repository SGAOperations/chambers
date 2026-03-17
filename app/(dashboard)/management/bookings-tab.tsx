'use client'

import { useEffect, useState } from 'react'
import BookingModal from './booking-modal'
import OneTimeForm from './one-time-form'
import WeeklyForm from './weekly-form'
import TablingForm from './tabling-form'
import EditOneTimeForm from './edit-one-time-form'
import EditWeeklyForm from './edit-weekly-form'
import EditTablingForm from './edit-tabling-form'

type BookingSubTab = 'One-Time Rooms' | 'Weekly Rooms' | 'Tables'

interface Body {
  id: string
  name: string
}

interface OneTimeBooking {
  id: string
  body_id: string
  purpose: string
  bodies: { name: string } | null
  users: { admin_role: string | null } | null
  one_time_room_bookings: {
    id: string
    room_name: string
    booking_date: string
    start_time: string
    end_time: string
    status: string
    reservation_code: string | null
  }[] | null
}

interface WeeklyBooking {
  id: string
  body_id: string
  purpose: string
  bodies: { name: string } | null
  users: { admin_role: string | null } | null
  weekly_room_bookings: {
    id: string
    room_name: string
    start_date: string
    end_date: string
    start_time: string
    end_time: string
    status: string
    reservation_code: string | null
    weekly_room_occurrences: {
        id: string
        occurrence_date: string
        room_name: string | null
        start_time: string | null
        end_time: string | null
        status: string | null
        reservation_code: string | null
        senate_type: string | null
    }[]
  }[] | null
}

interface TablingBooking {
  id: string
  body_id: string
  purpose: string
  bodies: { name: string } | null
  users: { admin_role: string | null } | null
  tabling_bookings: {
    id: string
    reservation_code: string | null
    tabling_sessions: {
      location: string
      session_date: string
      start_time: string
      end_time: string
      status: string
      reservation_code: string | null
    }[]
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
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

const statusColors: Record<string, string> = {
  'Reserved': 'bg-[#0f3d20] text-[#4ade80]',
  'Alternate Room': 'bg-[#0e2f4f] text-[#93c5fd]',
  'Alternate Time': 'bg-[#0e2f4f] text-[#93c5fd]',
  'Waitlisted': 'bg-[#3d0f0f] text-[#f87171]',
  'Unavailable': 'bg-[#3d0f0f] text-[#f87171]',
  'Pending Cancellation': 'bg-[#3d2200] text-[#fb923c]',
  'Cancelled': 'bg-[#2a1042] text-[#c084fc]',
  'Virtual': 'bg-[#062f3b] text-[#22d3ee]',
}

function AdminRoleBadge({ role }: { role: string | null | undefined }) {
  if (role === 'Comptroller') {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#f87171] text-[#450a0a]">
        Comptroller
      </span>
    )
  }
  if (role === 'Vice President of Operational Affairs') {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#22d3ee] text-[#0c4a6e]">
        Vice President
      </span>
    )
  }
  return null
}

export default function BookingsTab() {
  const [subTab, setSubTab] = useState<BookingSubTab>('One-Time Rooms')
  const [oneTime, setOneTime] = useState<OneTimeBooking[]>([])
  const [weekly, setWeekly] = useState<WeeklyBooking[]>([])
  const [tabling, setTabling] = useState<TablingBooking[]>([])
  const [bodies, setBodies] = useState<Body[]>([])
  const [loading, setLoading] = useState(true)
  const [showModal, setShowModal] = useState(false)
  const [editingBooking, setEditingBooking] = useState<OneTimeBooking | null>(null)
  const [editingWeekly, setEditingWeekly] = useState<WeeklyBooking | null>(null)
  const [editingTabling, setEditingTabling] = useState<TablingBooking | null>(null)

  const fetchBookings = async () => {
    const res = await fetch('/api/management/bookings')
    const data = await res.json()
    setOneTime(data.oneTime || [])
    setWeekly(data.weekly || [])
    setTabling(data.tabling || [])
    setLoading(false)
  }

  const fetchBodies = async () => {
    const res = await fetch('/api/management/bodies')
    const data = await res.json()
    setBodies(data.bodies || [])
  }

  useEffect(() => {
    fetchBookings()
    fetchBodies()
  }, [])

  if (loading) return <div className="text-[#93b8d8] text-sm">Loading...</div>

  const sortedWeekly = [...weekly].sort((a, b) => {
    const wa = a.weekly_room_bookings?.[0]
    const wb = b.weekly_room_bookings?.[0]
    if (!wa || !wb) return 0
    const dayA = (new Date(wa.start_date + 'T00:00:00').getDay() + 6) % 7
    const dayB = (new Date(wb.start_date + 'T00:00:00').getDay() + 6) % 7
    if (dayA !== dayB) return dayA - dayB
    return wa.start_time.localeCompare(wb.start_time)
  })

  return (
    <div className="space-y-4">
      {/* Sub-tab bar */}
      <div className="flex gap-1 border-b border-[#1e5080]">
        {(['One-Time Rooms', 'Weekly Rooms', 'Tables'] as BookingSubTab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setSubTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
              subTab === tab
                ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                : 'border-transparent text-[#93b8d8] hover:text-[#f0f6ff]'
            }`}
          >
            {tab === 'One-Time Rooms' ? 'One-Time/Multiple Rooms' : tab}
          </button>
        ))}
      </div>

      {/* Create button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowModal(true)}
          className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors"
        >
          + New Booking
        </button>
      </div>

      {/* Modal */}
      {showModal && (
        <BookingModal
          title={`New ${subTab === 'Tables' ? 'Tabling' : subTab === 'One-Time Rooms' ? 'One-Time/Multiple Room' : subTab.replace('s', '')} Booking`}
          onClose={() => setShowModal(false)}
        >
          {subTab === 'One-Time Rooms' && (
            <OneTimeForm
              bodies={bodies}
              onClose={() => setShowModal(false)}
              onSuccess={fetchBookings}
            />
          )}
          {subTab === 'Weekly Rooms' && (
            <WeeklyForm
                bodies={bodies}
                onClose={() => setShowModal(false)}
                onSuccess={fetchBookings}
            />
          )}
          {subTab === 'Tables' && (
            <TablingForm
                bodies={bodies}
                onClose={() => setShowModal(false)}
                onSuccess={fetchBookings}
            />
          )}
        </BookingModal>
      )}
      {editingBooking && (
        <BookingModal
            title="Edit One-Time/Multiple Room Booking"
            onClose={() => setEditingBooking(null)}
        >
            <EditOneTimeForm
                booking={editingBooking}
                bodies={bodies}
                onClose={() => setEditingBooking(null)}
                onSuccess={fetchBookings}
            />
        </BookingModal>
      )}

      {editingWeekly && (
        <BookingModal
            title="Edit Weekly Room Booking"
            onClose={() => setEditingWeekly(null)}
        >
            <EditWeeklyForm
                booking={editingWeekly}
                bodies={bodies}
                onClose={() => setEditingWeekly(null)}
                onSuccess={fetchBookings}
            />
        </BookingModal>
      )}

      {editingTabling && (
        <BookingModal
            title="Edit Tabling Booking"
            onClose={() => setEditingTabling(null)}
        >
            <EditTablingForm
                booking={editingTabling}
                bodies={bodies}
                onClose={() => setEditingTabling(null)}
                onSuccess={fetchBookings}
            />
        </BookingModal>
      )}

      {/* One-Time Rooms */}
      {subTab === 'One-Time Rooms' && (
        <div className="space-y-3">
          {oneTime.length === 0 ? (
            <p className="text-[#6a96bb] text-sm">No one-time room bookings found.</p>
          ) : (
            oneTime.map(b => {
              if (!b.one_time_room_bookings?.length) return null
              const firstSession = b.one_time_room_bookings[0]
              return (
                <div key={b.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-[#f0f6ff]">{b.bodies?.name}</p>
                      <p className="text-sm text-[#93b8d8]">{b.purpose}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <AdminRoleBadge role={b.users?.admin_role} />
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[firstSession.status] || 'bg-[#184073] text-[#93b8d8]'}`}>
                        {firstSession.status}
                      </span>
                      <button
                        onClick={() => setEditingBooking(b)}
                        className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[#93b8d8] space-y-1">
                    {b.one_time_room_bookings.map((d, i) => (
                      <div key={i} className={b.one_time_room_bookings!.length > 1 ? 'border-t border-[#1e5080] pt-1 first:border-0 first:pt-0' : ''}>
                        {d.room_name && <p><span className="font-medium text-[#f0f6ff]">Room:</span> {d.room_name}</p>}
                        <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(d.booking_date)}</p>
                        <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(d.start_time)} – {formatTime(d.end_time)}</p>
                        {d.reservation_code && <p><span className="font-medium text-[#f0f6ff]">Code:</span> {d.reservation_code}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Weekly Rooms */}
      {subTab === 'Weekly Rooms' && (
        <div className="space-y-3">
          {weekly.length === 0 ? (
            <p className="text-[#6a96bb] text-sm">No weekly room bookings found.</p>
          ) : (
            sortedWeekly.map(b => {
              const w = b.weekly_room_bookings?.[0]
              if (!w) return null
              return (
                <div key={b.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-[#f0f6ff]">{b.bodies?.name}</p>
                      <p className="text-sm text-[#93b8d8]">{b.purpose}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <AdminRoleBadge role={b.users?.admin_role} />
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[w.status] || 'bg-[#184073] text-[#93b8d8]'}`}>
                        {w.status}
                      </span>
                      <button
                        onClick={() => setEditingWeekly(b)}
                        className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[#93b8d8] space-y-0.5">
                    <p><span className="font-medium text-[#f0f6ff]">Room:</span> {w.room_name}</p>
                    <p><span className="font-medium text-[#f0f6ff]">Dates:</span> {formatDate(w.start_date)} – {formatDate(w.end_date)}</p>
                    <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(w.start_time)} – {formatTime(w.end_time)}</p>
                    {w.reservation_code && <p><span className="font-medium text-[#f0f6ff]">Code:</span> {w.reservation_code}</p>}
                    {b.bodies?.name === 'Senate' && w.weekly_room_occurrences?.some(o => o.senate_type) && (
                      <p><span className="font-medium text-[#f0f6ff]">Session Types:</span> {
                        [...new Set(w.weekly_room_occurrences.map(o => o.senate_type).filter(Boolean))].join(', ')
                      }</p>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}

      {/* Tables */}
      {subTab === 'Tables' && (
        <div className="space-y-3">
          {tabling.length === 0 ? (
            <p className="text-[#6a96bb] text-sm">No tabling bookings found.</p>
          ) : (
            tabling.map(b => {
              const t = b.tabling_bookings?.[0]
              if (!t) return null
              return (
                <div key={b.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-[#f0f6ff]">{b.bodies?.name}</p>
                    <div className="flex items-center gap-3">
                      <AdminRoleBadge role={b.users?.admin_role} />
                      <button
                        onClick={() => setEditingTabling(b)}
                        className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium transition-colors"
                      >
                        Edit
                      </button>
                    </div>
                  </div>
                  <p className="text-sm text-[#93b8d8] mb-3">{b.purpose}</p>
                  <div className="space-y-2">
                    {t.tabling_sessions.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm text-[#93b8d8] bg-[#0f2a4a] rounded-lg px-3 py-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColors[s.status] || 'bg-[#184073] text-[#93b8d8]'}`}>
                          {s.status}
                        </span>
                        <span>{s.location}</span>
                        <span>{formatDate(s.session_date)}</span>
                        <span>{formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })
          )}
        </div>
      )}
    </div>
  )
}