'use client'

import { useEffect, useMemo, useState } from 'react'
import CancelModal from './cancel-modal'
import RevisionModal from './revision-modal'
import BookingDetailModal from './booking-detail-modal'
import NotificationBell from './notification-bell'
import CalendarView from './calendar-view'
import { Skeleton } from '@/app/_components/skeleton'
import {
  type FlatBooking,
  SENATE_TYPES,
  statusColors,
  statusBarColors,
  statusTextColors,
  senateTypeBadgeColors,
  DEFAULT_SENATE_BADGE,
  formatTime,
  formatDate,
} from './shared'

function MyRoomsSkeleton() {
  return (
    <div className="space-y-10">
      <section>
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-xl font-bold text-[#f0f6ff]">My Upcoming Spaces</h2>
          <div className="flex gap-2">
            {[0, 1, 2].map(i => (
              <Skeleton key={i} className="h-8 w-24 animate-pulse border border-[#1e5080]" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map(i => (
            <div key={i} className="rounded-xl p-5 border border-[#1e5080] bg-[#184073] animate-pulse">
              <div className="flex items-center justify-between mb-2">
                <Skeleton className="h-2.5 w-24" />
                <Skeleton className="h-2.5 w-16" />
              </div>
              <Skeleton className="h-4 w-36 mb-2" />
              <Skeleton className="h-3.5 w-28 mb-1.5" />
              <Skeleton className="h-3.5 w-24 mb-1.5" />
              <Skeleton className="h-3.5 w-32" />
            </div>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-xl font-bold text-[#f0f6ff] mb-5">All Bookings</h2>
        <div className="space-y-2">
          <Skeleton className="h-3.5 w-36 animate-pulse" />
          <div className="divide-y divide-[#1e5080] border border-[#1e5080] rounded-xl overflow-hidden bg-[#184073] animate-pulse">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                <Skeleton className="w-1.5 h-8 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-56" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}

type Filter = 1 | 3 | 7
type ViewMode = 'list' | 'calendar'

const SENATE_TYPE_FILTER_KEY = 'chambers-senate-type-filter'

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
  const [viewMode, setViewMode] = useState<ViewMode>('list')
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [senateTypeFilter, setSenateTypeFilter] = useState<Set<string>>(new Set(SENATE_TYPES))
  const [cancellingBooking, setCancellingBooking] = useState<{
    id: string
    type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
    bodyName: string
    purpose: string
    location: string
    date: string
    occurrenceId?: string
    sessionCount?: number
  } | null>(null)
  const [revisingBooking, setRevisingBooking] = useState<{
    id: string
    type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
    bodyName: string
    purpose: string
    location: string
  } | null>(null)

  useEffect(() => {
    try {
      const stored = localStorage.getItem(SENATE_TYPE_FILTER_KEY)
      if (stored) setSenateTypeFilter(new Set(JSON.parse(stored)))
    } catch {
      // Ignore malformed/unavailable storage — falls back to showing all types.
    }
  }, [])

  const toggleSenateType = (type: string) => {
    setSenateTypeFilter(prev => {
      const next = new Set(prev)
      if (next.has(type)) next.delete(type)
      else next.add(type)
      try {
        localStorage.setItem(SENATE_TYPE_FILTER_KEY, JSON.stringify([...next]))
      } catch {
        // Best-effort persistence only.
      }
      return next
    })
  }

  const fetchBookings = async () => {
      setLoading(true)
      // /api/my-rooms already resolves the caller's Leadership bodies, so this
      // no longer needs a second round trip to auth + board_memberships.
      const res = await fetch('/api/my-rooms')
      const data = await res.json()

      setLeadershipBodyIds(data.leadershipBodyIds || [])

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
          reservationCode: s.reservation_code || t.reservation_code,
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

  const hasSenateBookings = useMemo(() => all.some(b => b.bodyName === 'Senate'), [all])

  const passesSenateFilter = (b: FlatBooking) =>
    b.bodyName !== 'Senate' || !b.senateType || senateTypeFilter.has(b.senateType)

  const filteredUpcoming = all.filter(b => isWithinDays(b.date, filter) && passesSenateFilter(b))

  const statusOptions = useMemo(
    () => ['All', ...Array.from(new Set(all.map(b => b.status))).sort()],
    [all]
  )

  const visibleAll = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter(b => {
      if (!passesSenateFilter(b)) return false
      if (statusFilter !== 'All' && b.status !== statusFilter) return false
      if (q && !(b.location.toLowerCase().includes(q) || b.purpose.toLowerCase().includes(q) || b.bodyName.toLowerCase().includes(q))) return false
      return true
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [all, search, statusFilter, senateTypeFilter])

  const filtersActive = search.trim() !== '' || statusFilter !== 'All'

  if (loading) return <MyRoomsSkeleton />

  return (
    <div className="space-y-10">
      {hasSenateBookings && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-[#6a96bb]">Senate Sessions</span>
          {SENATE_TYPES.map(t => (
            <button
              key={t}
              onClick={() => toggleSenateType(t)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-all ${
                senateTypeFilter.has(t)
                  ? senateTypeBadgeColors[t]
                  : 'border-[#1e5080] text-[#4a6b8a] bg-transparent hover:text-[#6a96bb]'
              }`}
            >
              {t}
            </button>
          ))}
        </div>
      )}

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
                    ? 'bg-white/20 text-white border-white/30'
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
            {filteredUpcoming.map(b => {
              const cardContent = (
                <>
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
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${senateTypeBadgeColors[b.senateType] || DEFAULT_SENATE_BADGE}`}>{b.senateType}</span>
                    )}
                  </div>
                </>
              )
              return b.bodyName === 'Senate' ? (
                <a key={b.id} href="https://attendance.northeasternsga.com" target="_blank" rel="noopener noreferrer" className={`block rounded-xl p-5 shadow-sm border cursor-pointer hover:bg-transparent transition-colors ${statusColors[b.status] || 'bg-[#184073] border-[#1e5080]'}`}>
                  {cardContent}
                </a>
              ) : (
                <div key={b.id} className={`rounded-xl p-5 shadow-sm border ${statusColors[b.status] || 'bg-[#184073] border-[#1e5080]'}`}>
                  {cardContent}
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* All Bookings */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3 mb-5">
          <h2 className="text-xl font-bold text-[#f0f6ff]">All Bookings</h2>
          <div className="flex gap-2">
            {(['list', 'calendar'] as ViewMode[]).map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-all capitalize ${
                  viewMode === mode
                    ? 'bg-white/20 text-white border-white/30'
                    : 'border-[#1e5080] text-[#93b8d8] hover:border-[#6a96bb] bg-[#184073]'
                }`}
              >
                {mode}
              </button>
            ))}
          </div>
        </div>

        {all.length === 0 ? (
          <p className="text-[#6a96bb] text-sm">No bookings found.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3 mb-4">
              <input
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Search by room, purpose, or body…"
                className="flex-1 min-w-[200px] px-3 py-2 rounded-lg bg-[#0e2f4f] border border-[#1e5080] text-sm text-[#f0f6ff] placeholder:text-[#4a6b8a] focus:outline-none focus:border-[#4285f4]"
              />
              <select
                value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}
                className="px-3 py-2 rounded-lg bg-[#0e2f4f] border border-[#1e5080] text-sm text-[#f0f6ff] focus:outline-none focus:border-[#4285f4]"
              >
                {statusOptions.map(s => (
                  <option key={s} value={s}>{s === 'All' ? 'All Statuses' : s}</option>
                ))}
              </select>
              {filtersActive && (
                <button
                  onClick={() => { setSearch(''); setStatusFilter('All') }}
                  className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium"
                >
                  Clear filters
                </button>
              )}
            </div>

            {visibleAll.length === 0 ? (
              <p className="text-[#6a96bb] text-sm">No bookings match your filters.</p>
            ) : viewMode === 'calendar' ? (
              <CalendarView bookings={visibleAll} onSelect={setDetailBooking} />
            ) : (() => {
              const bodyMap = new Map<string, { bodyName: string, bookings: FlatBooking[] }>()
              for (const b of visibleAll) {
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
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${senateTypeBadgeColors[b.senateType] || DEFAULT_SENATE_BADGE}`}>{b.senateType}</span>
                                )}
                              </div>
                              <p className="text-sm text-[#6a96bb]">{formatDate(b.date)} · {formatTime(b.startTime)} – {formatTime(b.endTime)}</p>
                            </div>
                            <span className="hidden md:inline text-xs text-[#6a96bb] flex-shrink-0">{b.type === 'One-Time Room' ? 'One-Time/Multiple Room' : b.type}</span>
                            <span className={`hidden md:inline text-xs font-semibold flex-shrink-0 ${statusTextColors[b.status] || 'text-[#93b8d8]'}`}>{b.status}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )
            })()}
          </>
        )}
      </section>
      {detailBooking && (
        <BookingDetailModal
          booking={detailBooking}
          isLeadership={leadershipBodyIds.includes(detailBooking.bodyId)}
          onClose={() => setDetailBooking(null)}
          onCancelClick={() => {
            const sessionCount = all.filter(b => b.bookingId === detailBooking.bookingId).length
            setCancellingBooking({
              id: detailBooking.bookingId,
              type: detailBooking.type,
              bodyName: detailBooking.bodyName,
              purpose: detailBooking.purpose,
              location: detailBooking.location,
              date: detailBooking.date,
              occurrenceId: detailBooking.id,
              sessionCount,
            })
            setDetailBooking(null)
          }}
          onRevisionClick={() => {
            setRevisingBooking({
              id: detailBooking.bookingId,
              type: detailBooking.type,
              bodyName: detailBooking.bodyName,
              purpose: detailBooking.purpose,
              location: detailBooking.location,
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
      {revisingBooking && (
        <RevisionModal
          booking={revisingBooking}
          onClose={() => setRevisingBooking(null)}
          onSuccess={() => setRevisingBooking(null)}
        />
      )}
    </div>
  )
}
