'use client'

import { useEffect, useState } from 'react'

type Filter = 1 | 3 | 7

const statusColors: Record<string, string> = {
  'Reserved': 'bg-green-100 border-green-400',
  'Alternate Room': 'bg-blue-100 border-blue-400',
  'Alternate Time': 'bg-blue-100 border-blue-400',
  'Waitlisted': 'bg-red-100 border-red-400',
  'Unavailable': 'bg-red-100 border-red-400',
  'Pending Cancellation': 'bg-orange-100 border-orange-400',
  'Cancelled': 'bg-purple-100 border-purple-400',
  'Virtual': 'bg-cyan-100 border-cyan-400',
}

const statusTextColors: Record<string, string> = {
  'Reserved': 'text-green-700',
  'Alternate Room': 'text-blue-700',
  'Alternate Time': 'text-blue-700',
  'Waitlisted': 'text-red-700',
  'Unavailable': 'text-red-700',
  'Pending Cancellation': 'text-orange-700',
  'Cancelled': 'text-purple-700',
  'Virtual': 'text-cyan-700',
}

interface FlatBooking {
  id: string
  type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
  bodyName: string
  purpose: string
  location: string
  date: string
  startTime: string
  endTime: string
  status: string
  reservationCode: string | null
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
  const [upcoming, setUpcoming] = useState<FlatBooking[]>([])
  const [all, setAll] = useState<FlatBooking[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchBookings = async () => {
      const res = await fetch('/api/my-rooms')
      const data = await res.json()
      const flat: FlatBooking[] = []

      // One-time rooms
      for (const b of data.oneTimeBookings || []) {
        const d = b.one_time_room_bookings?.[0]
        if (!d) continue
        flat.push({
          id: b.id,
          type: 'One-Time Room',
          bodyName: b.bodies?.name || '',
          purpose: b.purpose,
          location: d.room_name,
          date: d.booking_date,
          startTime: d.start_time,
          endTime: d.end_time,
          status: d.status,
          reservationCode: d.reservation_code,
        })
      }

      // Weekly rooms — use occurrences, fall back to parent values
      for (const b of data.weeklyBookings || []) {
        const w = b.weekly_room_bookings?.[0]
        if (!w) continue
        for (const occ of w.weekly_room_occurrences || []) {
          flat.push({
            id: occ.id,
            type: 'Weekly Room',
            bodyName: b.bodies?.name || '',
            purpose: b.purpose,
            location: occ.room_name || w.room_name,
            date: occ.occurrence_date,
            startTime: occ.start_time || w.start_time,
            endTime: occ.end_time || w.end_time,
            status: occ.status || w.status,
            reservationCode: occ.reservation_code || w.reservation_code,
          })
        }
      }

      // Tabling — one entry per session
      for (const b of data.tablingBookings || []) {
        const t = b.tabling_bookings?.[0]
        if (!t) continue
        for (const s of t.tabling_sessions || []) {
          flat.push({
            id: s.id,
            type: 'Tabling',
            bodyName: b.bodies?.name || '',
            purpose: b.purpose,
            location: s.location,
            date: s.session_date,
            startTime: s.start_time,
            endTime: s.end_time,
            status: s.status,
            reservationCode: s.reservation_code,
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

    fetchBookings()
  }, [])

  const filteredUpcoming = all.filter(b => isWithinDays(b.date, filter))

  if (loading) return <div className="text-slate-500 text-sm">Loading...</div>

  return (
    <div className="space-y-10">
      {/* My Upcoming Spaces */}
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-[#0f172a]">My Upcoming Spaces</h2>
          <div className="flex gap-2">
            {([1, 3, 7] as Filter[]).map(d => (
              <button
                key={d}
                onClick={() => setFilter(d)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                  filter === d
                    ? 'bg-[#0a1628] text-white border-[#0a1628]'
                    : 'border-[#e2e8f0] text-slate-600 hover:border-slate-400 bg-white'
                }`}
              >
                Next {d} Day{d > 1 ? 's' : ''}
              </button>
            ))}
          </div>
        </div>

        {filteredUpcoming.length === 0 ? (
          <p className="text-slate-400 text-sm">No upcoming spaces in this range.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredUpcoming.map(b => (
              <div key={b.id} className={`rounded-xl p-5 shadow-sm border ${statusColors[b.status] || 'bg-gray-100 border-gray-400'}`}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-semibold uppercase tracking-widest text-slate-400">{b.type}</span>
                  <span className={`text-xs font-semibold ${statusTextColors[b.status] || 'text-slate-600'}`}>{b.status}</span>
                </div>
                <p className="font-semibold text-[#0f172a]">{b.bodyName}</p>
                <p className="text-sm text-slate-600 mt-0.5">{b.location}</p>
                <p className="text-sm text-slate-500 mt-1">{formatDate(b.date)}</p>
                <p className="text-sm text-slate-500">{formatTime(b.startTime)} – {formatTime(b.endTime)}</p>
                {b.reservationCode && (
                  <p className="text-xs text-slate-400 mt-2">Code: {b.reservationCode}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {/* All Bookings */}
      <section>
        <h2 className="text-xl font-bold text-[#0f172a] mb-5">All Bookings</h2>
        {all.length === 0 ? (
          <p className="text-slate-400 text-sm">No bookings found.</p>
        ) : (
          <div className="divide-y divide-[#e2e8f0] border border-[#e2e8f0] rounded-xl overflow-hidden bg-white">
            {all.map(b => (
              <div key={b.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-slate-50 transition-colors">
                <div className={`w-1.5 h-8 rounded-full flex-shrink-0 ${statusColors[b.status]?.split(' ')[0] || 'bg-slate-300'}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-800 truncate">{b.bodyName} — {b.location}</p>
                  <p className="text-sm text-slate-500">{formatDate(b.date)} · {formatTime(b.startTime)} – {formatTime(b.endTime)}</p>
                </div>
                <span className="text-xs text-slate-400 flex-shrink-0">{b.type}</span>
                <span className={`text-xs font-semibold flex-shrink-0 ${statusTextColors[b.status] || 'text-slate-600'}`}>{b.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}