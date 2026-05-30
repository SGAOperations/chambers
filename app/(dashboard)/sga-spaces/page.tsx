'use client'

import { useState, useEffect, useCallback } from 'react'
import AuthGuard from '../authguard'
import SpaceCalendar from './space-calendar'
import SpaceBookingModal from './space-booking-modal'
import { Skeleton } from '@/app/_components/skeleton'

interface Space {
  id: string
  name: string
  capacity: number
}

interface Booking {
  id: string
  space_id: string
  creator_id: string
  title: string
  start_time: string
  end_time: string
  attendee_ids: string[]
  creator_name: string | null
}

interface Blackout {
  id: string
  space_id: string | null
  start_time: string
  end_time: string
}

interface ModalSlot {
  start: string
  end: string
}

interface EditBooking {
  id: string
  spaceId: string
  title: string
  start: string
  end: string
  attendees: { id: string; full_name: string; email: string }[]
}

// Skeleton shown on initial page load before spaces are fetched
function SGASpacesSkeleton() {
  return (
    <div className="space-y-5 animate-pulse">
      {/* Header row */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">SGA Spaces</h1>
        <Skeleton className="h-9 w-48 border border-[#1e5080]" />
      </div>

      {/* Space switcher tabs */}
      <div className="flex gap-1 border-b border-[#1e5080] pb-px">
        <Skeleton className="h-9 w-28 rounded-b-none" />
        <Skeleton className="h-9 w-24 rounded-b-none" />
        <Skeleton className="h-9 w-32 rounded-b-none" />
      </div>

      {/* Week nav */}
      <div className="flex items-center gap-3">
        <Skeleton className="h-7 w-7 rounded-lg" />
        <Skeleton className="h-4 w-36" />
        <Skeleton className="h-7 w-7 rounded-lg" />
      </div>

      {/* Calendar skeleton */}
      <CalendarSkeleton />
    </div>
  )
}

// Skeleton for the calendar grid itself (used both on initial load and during refresh)
function CalendarSkeleton() {
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  // A few fake booking blocks scattered across the grid for visual interest
  const fakeBlocks = [
    { day: 1, topPct: 30, heightPct: 8 },
    { day: 1, topPct: 52, heightPct: 5 },
    { day: 3, topPct: 38, heightPct: 12 },
    { day: 5, topPct: 25, heightPct: 6 },
    { day: 6, topPct: 60, heightPct: 9 },
  ]

  return (
    <div className="rounded-xl border border-[#1e5080] overflow-hidden bg-[#0a1628]">
      {/* Day headers */}
      <div className="flex border-b border-[#1e5080]">
        <div className="w-14 flex-shrink-0 border-r border-[#1e5080]" />
        {DAYS.map((name, i) => (
          <div key={i} className="flex-1 min-w-0 text-center py-2 border-r border-[#1e5080] last:border-r-0">
            <div className="text-xs font-medium text-[#93b8d8]">{name}</div>
            <Skeleton className="h-4 w-12 mx-auto mt-1" />
          </div>
        ))}
      </div>

      {/* Grid body */}
      <div style={{ height: 400, overflow: 'hidden' }} className="relative flex">
        {/* Time label column */}
        <div className="w-14 flex-shrink-0 border-r border-[#1e5080] relative">
          {[2, 16, 30, 44, 58, 72, 86].map(top => (
            <div key={top} className="absolute right-1 h-2.5 w-8 rounded-lg bg-[#1e3a5c]" style={{ top: `${top}%` }} />
          ))}
        </div>

        {/* Day columns */}
        {DAYS.map((_, dayIdx) => (
          <div key={dayIdx} className="flex-1 min-w-0 border-r border-[#1e5080] last:border-r-0 relative">
            {/* Hour lines */}
            {[14, 28, 42, 56, 70, 84].map(pct => (
              <div key={pct} className="absolute inset-x-0 border-t border-[#1e5080]" style={{ top: `${pct}%` }} />
            ))}
            {/* CSC Closed band */}
            <div className="absolute inset-x-0 top-0 bg-[#c8102e]/8" style={{ height: '10%' }} />
            {/* Fake booking blocks */}
            {fakeBlocks
              .filter(b => b.day === dayIdx)
              .map((b, i) => (
                <div
                  key={i}
                  className="absolute inset-x-0.5 rounded bg-[#1e3a5c]"
                  style={{ top: `${b.topPct}%`, height: `${b.heightPct}%` }}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function SGASpacesPage() {
  const [spaces, setSpaces] = useState<Space[]>([])
  const [spacesLoading, setSpacesLoading] = useState(true)
  const [selectedSpaceId, setSelectedSpaceId] = useState<string | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [blackouts, setBlackouts] = useState<Blackout[]>([])
  const [weekStart, setWeekStart] = useState<Date>(() => {
    const now = new Date()
    const day = now.getUTCDay()
    const sun = new Date(now)
    sun.setUTCDate(now.getUTCDate() - day)
    sun.setUTCHours(0, 0, 0, 0)
    return sun
  })
  const [remainingHours, setRemainingHours] = useState<number | null>(null)
  const [limitHours, setLimitHours] = useState<number>(18)
  const [minHoursAdvance, setMinHoursAdvance] = useState<number>(24)
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [modalSlot, setModalSlot] = useState<ModalSlot | null>(null)
  const [editBooking, setEditBooking] = useState<EditBooking | null>(null)
  const [calendarLoading, setCalendarLoading] = useState(false)

  const isTodayWeek = (() => {
    const now = new Date()
    const day = now.getUTCDay()
    const sun = new Date(now)
    sun.setUTCDate(now.getUTCDate() - day)
    sun.setUTCHours(0, 0, 0, 0)
    return weekStart.getTime() === sun.getTime()
  })()

  useEffect(() => {
    fetch('/api/spaces')
      .then(r => r.json())
      .then((data: Space[]) => {
        setSpaces(data)
        if (data.length > 0) setSelectedSpaceId(data[0].id)
      })
      .finally(() => setSpacesLoading(false))
  }, [])

  useEffect(() => {
    fetch('/api/spaces/remaining-hours')
      .then(r => r.json())
      .then(data => {
        setRemainingHours(data.remaining)
        setLimitHours(data.limit)
        if (data.user_id) setCurrentUserId(data.user_id)
        if (data.min_hours_advance != null) setMinHoursAdvance(data.min_hours_advance)
      })
  }, [bookings])

  const fetchCalendarData = useCallback(async () => {
    if (!selectedSpaceId) return
    setCalendarLoading(true)
    try {
      const res = await fetch(`/api/spaces/bookings?space_id=${selectedSpaceId}&week_start=${weekStart.toISOString()}`)
      if (res.ok) {
        const data = await res.json()
        setBookings(data.bookings ?? [])
        setBlackouts(data.blackouts ?? [])
      }
    } finally {
      setCalendarLoading(false)
    }
  }, [selectedSpaceId, weekStart])

  useEffect(() => {
    fetchCalendarData()
  }, [fetchCalendarData])

  const handleBookingClick = useCallback(async (booking: Booking) => {
    const space = spaces.find(s => s.id === booking.space_id)
    if (!space) return
    let attendees: { id: string; full_name: string; email: string }[] = []
    if (booking.attendee_ids.length > 0) {
      const res = await fetch(`/api/users/by-ids?ids=${booking.attendee_ids.join(',')}`)
      if (res.ok) attendees = await res.json()
    }
    setEditBooking({
      id: booking.id,
      spaceId: booking.space_id,
      title: booking.title,
      start: booking.start_time,
      end: booking.end_time,
      attendees,
    })
  }, [spaces])

  const advanceWeek = () => {
    setWeekStart(prev => {
      const next = new Date(prev)
      next.setUTCDate(prev.getUTCDate() + 7)
      return next
    })
  }

  const retreatWeek = () => {
    if (isTodayWeek) return
    setWeekStart(prev => {
      const next = new Date(prev)
      next.setUTCDate(prev.getUTCDate() - 7)
      return next
    })
  }

  const formatWeekLabel = () => {
    const end = new Date(weekStart)
    end.setUTCDate(weekStart.getUTCDate() + 6)
    const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' }
    return `${weekStart.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', opts)}`
  }

  const selectedSpace = spaces.find(s => s.id === selectedSpaceId)

  if (spacesLoading) {
    return (
      <AuthGuard>
        <SGASpacesSkeleton />
      </AuthGuard>
    )
  }

  return (
    <AuthGuard>
      <div className="space-y-5">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <h1 className="text-2xl font-bold text-[#f0f6ff]">SGA Spaces</h1>
          {remainingHours !== null ? (
            <div className="flex items-center gap-3 flex-wrap justify-end">
              <div className="flex items-center gap-2 bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-4 py-2">
                <span className="text-sm text-[#93b8d8]">This week:</span>
                <span className={`text-sm font-semibold ${remainingHours <= 2 ? 'text-[#c8102e]' : 'text-[#f0f6ff]'}`}>
                  {remainingHours.toFixed(1)} / {limitHours} hrs remaining
                </span>
              </div>
              <div className="flex items-center gap-2 bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-4 py-2">
                <span className="text-sm text-[#93b8d8]">{minHoursAdvance}h advance notice required</span>
              </div>
            </div>
          ) : (
            <Skeleton className="h-9 w-48 border border-[#1e5080] animate-pulse" />
          )}
        </div>

        {/* Space switcher */}
        <div className="flex gap-1 border-b border-[#1e5080]">
          {spaces.map(space => (
            <button
              key={space.id}
              onClick={() => setSelectedSpaceId(space.id)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
                selectedSpaceId === space.id
                  ? 'border-[#c8102e] text-[#f0f6ff] font-semibold'
                  : 'border-transparent text-[#93b8d8] hover:text-[#c8102e]'
              }`}
            >
              {space.name}
              <span className="ml-1.5 text-xs text-[#93b8d8]">(cap. {space.capacity})</span>
            </button>
          ))}
        </div>

        {/* Week navigation */}
        <div className="flex items-center gap-3">
          <button
            onClick={retreatWeek}
            disabled={isTodayWeek}
            className="p-1.5 rounded-lg text-[#93b8d8] hover:text-[#f0f6ff] hover:bg-white/10 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            aria-label="Previous week"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className="text-sm font-medium text-[#f0f6ff]">{formatWeekLabel()}</span>
          <button
            onClick={advanceWeek}
            className="p-1.5 rounded-lg text-[#93b8d8] hover:text-[#f0f6ff] hover:bg-white/10 transition-colors"
            aria-label="Next week"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>
        </div>

        {/* Calendar — skeleton during refresh, real calendar once loaded */}
        {selectedSpaceId && (
          calendarLoading ? (
            <CalendarSkeleton />
          ) : (
            <SpaceCalendar
              weekStart={weekStart}
              bookings={bookings}
              blackouts={blackouts}
              currentUserId={currentUserId ?? undefined}
              minHoursAdvance={minHoursAdvance}
              onSlotClick={(start, end) => setModalSlot({ start, end })}
              onBookingClick={handleBookingClick}
            />
          )
        )}

        {/* Create booking modal */}
        {modalSlot && selectedSpaceId && selectedSpace && (
          <SpaceBookingModal
            spaceId={selectedSpaceId}
            spaceName={selectedSpace.name}
            initialStart={modalSlot.start}
            initialEnd={modalSlot.end}
            onClose={() => setModalSlot(null)}
            onSuccess={() => {
              setModalSlot(null)
              fetchCalendarData()
            }}
          />
        )}

        {/* Edit booking modal */}
        {editBooking && (
          <SpaceBookingModal
            spaceId={editBooking.spaceId}
            spaceName={spaces.find(s => s.id === editBooking.spaceId)?.name ?? 'SGA Space'}
            initialStart={editBooking.start}
            initialEnd={editBooking.end}
            editBookingId={editBooking.id}
            initialTitle={editBooking.title}
            initialAttendees={editBooking.attendees}
            onClose={() => setEditBooking(null)}
            onSuccess={() => {
              setEditBooking(null)
              fetchCalendarData()
            }}
          />
        )}
      </div>
    </AuthGuard>
  )
}
