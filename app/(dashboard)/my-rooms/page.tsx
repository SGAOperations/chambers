'use client'

import { useEffect, useState } from 'react'
import CancelModal from './cancel-modal'
import BookingDetailModal from './booking-detail-modal'
import NotificationBell from './notification-bell'
import {createClient} from "@/lib/supabase/client"

type Filter = 1 | 3 | 7

const statusColors: Record<string, string> = {
  'Reserved': 'bg-[#0f3d20] border-[#22c55e]',
  'Alternate Room': 'bg-[#0e2f4f] border-[#93c5fd]',
  'Alternate Time': 'bg-[#0e2f4f] border-[#93c5fd]',
  'Waitlisted': 'bg-[#3d0f0f] border-[#ef4444]',
  'Unavailable': 'bg-[#3d0f0f] border-[#ef4444]',
  'Pending Cancellation': 'bg-[#3d2200] border-[#f97316]',
  'Cancelled': 'bg-[#2a1042] border-[#a855f7]',
  'Virtual': 'bg-[#062f3b] border-[#06b6d4]',
  'Missed': 'bg-[#1a1a2e] border-[#a78bfa]',
}

const statusBarColors: Record<string, string> = {
  'Reserved': 'bg-[#22c55e]',
  'Alternate Room': 'bg-[#93c5fd]',
  'Alternate Time': 'bg-[#93c5fd]',
  'Waitlisted': 'bg-[#ef4444]',
  'Unavailable': 'bg-[#ef4444]',
  'Pending Cancellation': 'bg-[#f97316]',
  'Cancelled': 'bg-[#a855f7]',
  'Virtual': 'bg-[#06b6d4]',
  'Missed': 'bg-[#a78bfa]',
}

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
  bookingId: string //parent booking id
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

function isWithinDays(dateStr: string, days: number) {
  const now = new Date()
  now.setHours(0, 0, 0, 0)
  const target = new Date(dateStr + 'T00:00:00')
  const diff = (target.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
  return diff >= 0 && diff < days
}

export default function MyRoomsPage() {
  const [filter, setFilter] = useState<Filter>(7)
  const [all, setAll] = useState<FlatBooking[]>([])
  const [loading, setLoading] = useState(true)
  const [leadershipBodyIds, setLeadershipBodyIds] = useState<string[]>([])
  const [detailBooking, setDetailBooking] = useState<FlatBooking | null>(null)
  const [cancellingBooking, setCancellingBooking] = useState<{
    id: string
    type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
    bodyName: string
    purpose: string
    location: string
    date: string
    occurrenceId?: string
  } | null>(null)

  const fetchBookings = async () => {
      setLoading(true)
      const res = await fetch('/api/my-rooms')
      const data = await res.json()

      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      const { data: memberships } = await supabase
        .from('board_memberships')
        .select('body_id')
        .eq('user_id', user?.id)
        .eq('role', 'Leadership')
      setLeadershipBodyIds(memberships?.map(m => m.body_id) || [])

      const flat: FlatBooking[] = []

      for (const b of data.oneTimeBookings || []) {
        for (const d of b.one_time_room_bookings || []) {
          flat.push({
            id: d.id,
            bodyId: b.body_id,
            bookingId: b.id,
            type: 'One-Time Room',
            bodyName: b.bodies?.name || '',
            purpose: b.purpose,
            location: d.room_name,
            date: d.booking_date,
            startTime: d.start_time,
            endTime: d.end_time,
            status: d.status,
            reservationCode: d.reservation_code,
            senateType: null,
          })
        }
      }

      for (const b of data.weeklyBookings || []) {
        const w = b.weekly_room_bookings?.[0]
        if (!w) continue
        for (const occ of w.weekly_room_occurrences || []) {
          flat.push({
          id: occ.id,
          bodyId: b.body_id,
          bookingId: b.id,
          type: 'Weekly Room',
          bodyName: b.bodies?.name || '',
          purpose: b.purpose,
          location: occ.room_name || w.room_name,
          date: occ.occurrence_date,
          startTime: occ.start_time || w.start_time,
          endTime: occ.end_time || w.end_time,
          status: occ.status || w.status,
          reservationCode: occ.reservation_code || w.reservation_code,
          senateType: occ.senate_type ?? null,
        })
      }
    }

    for (const b of data.tablingBookings || []) {
      const t = b.tabling_bookings?.[0]
      if (!t) continue
      for (const s of t.tabling_sessions || []) {
        flat.push({
          id: s.id,
          bodyId: b.body_id,
          bookingId: b.id,
          type: 'Tabling',
          bodyName: b.bodies?.name || '',
          purpose: b.purpose,
          location: s.location,
          date: s.session_date,
          startTime: s.start_time,
          endTime: s.end_time,
          status: s.status,
          reservationCode: s.reservation_code,
          senateType: null,
        })
      }
    }

    flat.sort((a, b) => a.date.localeCompare(b.date) || a.startTime.localeCompare(b.startTime))

    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const futureOnly = flat.filter(b => new Date(b.date + 'T00:00:00') >= today)
    setAll(futureOnly)
    setLoading(false)
  }

  useEffect(() => {
    fetchBookings()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredUpcoming = all.filter(b => isWithinDays(b.date, filter))

  if (loading) return <div className="text-[#93b8d8] text-sm">Loading...</div>

  return (
    <div className="space-y-10">
      {/* My Upcoming Spaces */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-[#f0f6ff]">My Upcoming Spaces</h2>
            <NotificationBell />
          </div>
          <div className="flex gap-2">
            {([1, 3, 7] as Filter[]).map(d => (
              <button
                key={d}
                onClick={() => setFilter(d)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  filter === d
                    ? 'bg-[#0a1628] text-white border-[#0a1628]'
                    : 'border-[#1e5080] text-[#93b8d8] hover:border-[#6a96bb] bg-[#184073]'
                }`}
              >
                Next {d} Day{d > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>

        {filteredUpcoming.length === 0 ? (
          <p className="text-[#6a96bb] text-sm">No upcoming spaces in this range.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUpcoming.map(b => (
              <div key={b.id} className={`rounded-xl p-5 shadow-sm border ${statusColors[b.status] || 'bg-[#184073] border-[#1e5080]'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-[#6a96bb]">{b.type === 'One-Time Room' ? 'One-Time/Multiple Room' : b.type}</span>
                  <span className={`text-xs font-semibold ${statusTextColors[b.status] || 'text-[#93b8d8]'}`}>{b.status}</span>
                </div>
                <p className="font-semibold text-[#f0f6ff]">{b.bodyName}</p>
                <p className="text-sm text-[#93b8d8] mt-0.5">{b.location}</p>
                <p className="text-sm text-[#6a96bb] mt-1">{formatDate(b.date)}</p>
                <div className="flex items-center justify-between">
                  <p className="text-sm text-[#6a96bb]">{formatTime(b.startTime)} – {formatTime(b.endTime)}</p>
                  {b.senateType && (
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#c8102e] text-white">{b.senateType}</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* All Bookings */}
      <section>
        <h2 className="text-xl font-bold text-[#f0f6ff] mb-5">All Bookings</h2>
        {all.length === 0 ? (
          <p className="text-[#6a96bb] text-sm">No bookings found.</p>
        ) : (() => {
          const bodyMap = new Map<string, { bodyName: string, bookings: FlatBooking[] }>()
          for (const b of all) {
            if (!bodyMap.has(b.bodyId)) bodyMap.set(b.bodyId, { bodyName: b.bodyName, bookings: [] })
            bodyMap.get(b.bodyId)!.bookings.push(b)
          }
          const groups = Array.from(bodyMap.entries()).map(([bodyId, { bodyName, bookings }]) => ({
            bodyId, bodyName, bookings,
            isLeadership: leadershipBodyIds.includes(bodyId),
          }))
          groups.sort((a, b) => {
            if (a.isLeadership !== b.isLeadership) return a.isLeadership ? -1 : 1
            return a.bodyName.localeCompare(b.bodyName)
          })
          return (
            <div className="space-y-6">
              {groups.map(group => (
                <div key={group.bodyId} className="space-y-2">
                  <h3 className="text-sm font-semibold text-[#93b8d8] uppercase tracking-wider">
                    {group.bodyName}
                    {group.isLeadership && (
                      <span className="ml-1 text-[#c8102e] normal-case tracking-normal"> (Leadership)</span>
                    )}
                  </h3>
                  <div className="divide-y divide-[#1e5080] border border-[#1e5080] rounded-xl overflow-hidden bg-[#184073]">
                    {group.bookings.map(b => (
                      <div key={b.id} onClick={() => setDetailBooking(b)} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#1a4d8a] transition-colors cursor-pointer">
                        <div className={`w-1.5 h-8 rounded-full flex-shrink-0 ${statusBarColors[b.status] || 'bg-[#1e5080]'}`} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 min-w-0">
                            <p className="font-semibold text-[#f0f6ff] truncate">{b.location}</p>
                            {b.senateType && (
                              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#c8102e] text-white flex-shrink-0">{b.senateType}</span>
                            )}
                          </div>
                          <p className="text-sm text-[#6a96bb]">{formatDate(b.date)} · {formatTime(b.startTime)} – {formatTime(b.endTime)}</p>
                        </div>
                        <span className="text-xs text-[#6a96bb] flex-shrink-0">{b.type === 'One-Time Room' ? 'One-Time/Multiple Room' : b.type}</span>
                        <span className={`text-xs font-semibold flex-shrink-0 ${statusTextColors[b.status] || 'text-[#93b8d8]'}`}>{b.status}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )
        })()}
      </section>
      {detailBooking && (
        <BookingDetailModal
          booking={detailBooking}
          isLeadership={leadershipBodyIds.includes(detailBooking.bodyId)}
          onClose={() => setDetailBooking(null)}
          onCancelClick={() => {
            setCancellingBooking({
              id: detailBooking.bookingId,
              type: detailBooking.type,
              bodyName: detailBooking.bodyName,
              purpose: detailBooking.purpose,
              location: detailBooking.location,
              date: detailBooking.date,
              occurrenceId: detailBooking.type === 'Weekly Room' ? detailBooking.id : undefined,
            })
            setDetailBooking(null)
          }}
        />
      )}
      {cancellingBooking && (
        <CancelModal
          booking={cancellingBooking}
          onClose={() => setCancellingBooking(null)}
          onSuccess={() => {
            setCancellingBooking(null)
            fetchBookings()
          }}
        />
      )}
    </div>
  )
}