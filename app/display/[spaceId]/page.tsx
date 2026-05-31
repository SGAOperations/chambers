'use client'

import { Space_Grotesk } from 'next/font/google'
import { useState, useEffect, Suspense, use } from 'react'
import { useSearchParams } from 'next/navigation'

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'] })

interface Space {
  id: string
  name: string
  capacity: number
}

interface Booking {
  id: string
  title: string
  start_time: string
  end_time: string
  creator_name?: string | null
  attendee_names?: string[]
}

interface Blackout {
  id: string
  start_time: string
  end_time: string
}

// Timeline spans 7am–midnight (17 hours = 1020 minutes)
const BAR_START_MINS = 7 * 60
const BAR_END_MINS = 24 * 60
const BAR_RANGE = BAR_END_MINS - BAR_START_MINS

const HOUR_LABELS = [
  { label: '7am', hour: 7 },
  { label: '9am', hour: 9 },
  { label: '11am', hour: 11 },
  { label: '1pm', hour: 13 },
  { label: '3pm', hour: 15 },
  { label: '5pm', hour: 17 },
  { label: '7pm', hour: 19 },
  { label: '9pm', hour: 21 },
  { label: '11pm', hour: 23 },
]

function minsFromMidnight(iso: string): number {
  const d = new Date(iso)
  return d.getUTCHours() * 60 + d.getUTCMinutes()
}

function toBarPercent(mins: number): number {
  return Math.max(0, Math.min(100, ((mins - BAR_START_MINS) / BAR_RANGE) * 100))
}

function formatTime(iso: string): string {
  const d = new Date(iso)
  const h = d.getUTCHours()
  const m = d.getUTCMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m} ${ampm}`
}

function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`
}

// Formats wall-clock minutes (0–1440) as a time string.
// 1440 (midnight end-of-day) is displayed as 11:59 PM to indicate "all day".
function formatMins(mins: number): string {
  const clamped = Math.min(mins, 23 * 60 + 59)
  const h = Math.floor(clamped / 60)
  const m = (clamped % 60).toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m} ${ampm}`
}

function formatClock(d: Date): string {
  const h = d.getHours()
  const m = d.getMinutes().toString().padStart(2, '0')
  const ampm = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return `${hour}:${m} ${ampm}`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

function DisplayContent({ spaceId }: { spaceId: string }) {
  const searchParams = useSearchParams()
  const key = searchParams.get('key')

  const [space, setSpace] = useState<Space | null>(null)
  const [bookings, setBookings] = useState<Booking[]>([])
  const [blackouts, setBlackouts] = useState<Blackout[]>([])
  const [now, setNow] = useState(new Date())
  const [accessDenied, setAccessDenied] = useState(false)
  const [notFound, setNotFound] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (accessDenied) return
    if (!key) {
      setAccessDenied(true)
      return
    }

    async function fetchData() {
      // Send the client's local date so the server knows which wall-clock day to fetch.
      const localNow = new Date()
      const localDate = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`
      const res = await fetch(`/api/display/${spaceId}?key=${encodeURIComponent(key!)}&date=${localDate}`)
      if (res.status === 401) {
        setAccessDenied(true)
        return
      }
      if (res.status === 404) {
        setNotFound(true)
        setLoading(false)
        return
      }
      const data = await res.json()
      setSpace(data.space)
      setBookings(data.bookings)
      setBlackouts(data.blackouts ?? [])
      setLoading(false)
    }

    fetchData()
    const interval = setInterval(fetchData, 50_000)
    return () => clearInterval(interval)
  }, [spaceId, key, accessDenied])

  // Booking times are stored as UTC wall-clock (T17:00Z = 5pm local).
  // Compare using local minutes-from-midnight vs. the stored UTC hours/minutes.
  const nowLocalMins = now.getHours() * 60 + now.getMinutes()

  // Wall-clock date string for today — used to clamp multi-day blackouts to the visible range.
  // Must use local date components (not toISOString which is UTC and flips at 8 PM EDT).
  const todayUtcStr = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()))
    .toISOString().slice(0, 10)

  // Returns start/end in wall-clock minutes, clamped to [0, 1440] for today.
  function blackoutMins(b: Blackout): { start: number; end: number } {
    const startDate = b.start_time.slice(0, 10)
    const endDate = b.end_time.slice(0, 10)
    return {
      start: startDate < todayUtcStr ? 0 : minsFromMidnight(b.start_time),
      end: endDate > todayUtcStr ? 24 * 60 : minsFromMidnight(b.end_time),
    }
  }

  const activeBlackout = blackouts.find((b) => {
    const { start, end } = blackoutMins(b)
    return start <= nowLocalMins && nowLocalMins < end
  })
  const isBlackedOut = !!activeBlackout

  const currentBooking = bookings.find((b) => {
    const start = minsFromMidnight(b.start_time)
    const end = minsFromMidnight(b.end_time)
    return start <= nowLocalMins && nowLocalMins < end
  })
  const isOccupied = !!currentBooking
  const futureBookings = bookings.filter((b) => minsFromMidnight(b.start_time) > nowLocalMins)
  const nextBooking = futureBookings[0]
  const upcomingBookings = futureBookings.slice(1)

  const bgGradient = isBlackedOut || isOccupied
    ? 'from-[#4a0d0d] via-[#2e0707] to-[#1a0404]'
    : 'from-[#0d4a22] via-[#093318] to-[#051a0d]'

  const nowPercent = toBarPercent(nowLocalMins)

  if (accessDenied) {
    return (
      <div className={`h-screen w-screen flex items-center justify-center bg-[#0a1628] ${spaceGrotesk.className}`}>
        <p className="text-[#f87171] text-2xl font-semibold">Access denied</p>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={`h-screen w-screen flex items-center justify-center bg-[#0a1628] ${spaceGrotesk.className}`}>
        <p className="text-[#93b8d8] text-xl">Loading...</p>
      </div>
    )
  }

  if (notFound) {
    return (
      <div className={`h-screen w-screen flex items-center justify-center bg-[#0a1628] ${spaceGrotesk.className}`}>
        <p className="text-[#93b8d8] text-xl">Space not found</p>
      </div>
    )
  }

  return (
    <div
      className={`h-screen w-screen overflow-hidden flex flex-col bg-gradient-to-br ${bgGradient} transition-colors duration-1000 ${spaceGrotesk.className}`}
    >
      <div className="flex flex-row flex-1 min-h-0">
        {/* Left half */}
        <div className="w-1/2 flex flex-col px-12 py-10">
          {/* Space name + capacity + clock */}
          <div>
            <p className="text-2xl font-semibold text-[#93b8d8]">{space?.name}</p>
            <p className="text-sm text-[#6a96bb]">Capacity: {space?.capacity}</p>
            <p className="text-6xl font-bold text-[#f0f6ff] tabular-nums mt-6">{formatClock(now)}</p>
            <p className="text-sm text-[#93b8d8] mt-1">{formatDate(now)}</p>
          </div>

          {/* Vertical timeline bar — fills remaining height */}
          <div className="flex flex-row gap-3 flex-1 mt-8 min-h-0">
            <div className="relative w-10 flex-shrink-0">
              {HOUR_LABELS.map(({ label, hour }) => (
                <span
                  key={hour}
                  className="absolute text-xs text-[#6a96bb] right-0 -translate-y-1/2"
                  style={{ top: `${toBarPercent(hour * 60)}%` }}
                >
                  {label}
                </span>
              ))}
            </div>
            <div className="flex-1 rounded-lg relative overflow-hidden bg-white/10">
              {/* Hour tick lines */}
              {HOUR_LABELS.map(({ hour }) => (
                <div
                  key={hour}
                  className="absolute left-0 w-full h-px bg-white/20"
                  style={{ top: `${toBarPercent(hour * 60)}%` }}
                />
              ))}
              {/* Booking segments */}
              {bookings.map((b) => {
                const startPct = toBarPercent(minsFromMidnight(b.start_time))
                const endPct = toBarPercent(minsFromMidnight(b.end_time))
                const heightPct = endPct - startPct
                if (heightPct <= 0) return null
                return (
                  <div
                    key={b.id}
                    className="absolute left-0 w-full bg-[#c8102e]/70 rounded-sm overflow-hidden"
                    style={{ top: `${startPct}%`, height: `${heightPct}%` }}
                  >
                    {minsFromMidnight(b.end_time) - minsFromMidnight(b.start_time) >= 30 && (
                      <div className="px-2 pt-1 leading-tight">
                        <p className="text-xs font-semibold text-white truncate">{b.title}</p>
                        {b.creator_name && (
                          <p className="text-xs text-white/70 truncate">{b.creator_name}</p>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Blackout segments */}
              {blackouts.map((b) => {
                const { start, end } = blackoutMins(b)
                const startPct = toBarPercent(start)
                const endPct = toBarPercent(end)
                const heightPct = endPct - startPct
                if (heightPct <= 0) return null
                return (
                  <div
                    key={b.id}
                    className="absolute left-0 w-full bg-black/70 rounded-sm"
                    style={{ top: `${startPct}%`, height: `${heightPct}%` }}
                  />
                )
              })}
              {/* Current time marker */}
              <div
                className="absolute left-0 w-full h-0.5 bg-white/80"
                style={{ top: `${nowPercent}%` }}
              />
              <div
                className="absolute left-0 w-3 h-3 rounded-full bg-white -translate-y-1/2"
                style={{ top: `${nowPercent}%` }}
              />
            </div>
          </div>
        </div>

        {/* Right half */}
        <div className="w-1/2 flex flex-col px-12 py-10 border-l border-white/10">
          {/* Top section — status header fixed at clock level */}
          <div className="flex-shrink-0">
            {/* Spacer mirrors the two lines above the clock (space name + capacity) */}
            <div aria-hidden="true" className="opacity-0 pointer-events-none">
              <p className="text-2xl font-semibold">&nbsp;</p>
              <p className="text-sm">&nbsp;</p>
            </div>
            {/* Status — sits at same vertical level as the clock */}
            {isBlackedOut ? (
              <>
                <p className="text-5xl font-bold text-[#f87171] mt-6">Unavailable</p>
                <p className="text-sm text-[#93b8d8] mt-1">
                  {(() => { const { start, end } = blackoutMins(activeBlackout!); return `${formatMins(start)} – ${formatMins(end)}` })()}
                </p>
              </>
            ) : isOccupied ? (
              <>
                <p className="text-5xl font-bold text-[#f87171] mt-6">Reserved</p>
                <p className="text-xl text-[#f0f6ff] mt-1">{currentBooking!.title}</p>
                <p className="text-sm text-[#93b8d8]">
                  {formatTimeRange(currentBooking!.start_time, currentBooking!.end_time)}
                </p>
              </>
            ) : (
              <>
                <p className="text-5xl font-bold text-[#4ade80] mt-6">Available</p>
                {nextBooking ? (
                  <p className="text-xl text-[#93b8d8] mt-1">until {formatTime(nextBooking.start_time)}</p>
                ) : (
                  <p className="text-xl text-[#93b8d8] mt-1">for the rest of the day</p>
                )}
              </>
            )}
          </div>

          {/* Details — sits in bar area, clips at midnight */}
          <div className="flex-1 mt-8 min-h-0 overflow-hidden">
            {!isBlackedOut && isOccupied && (
              <>
                {currentBooking!.creator_name && (
                  <p className="text-sm text-[#93b8d8]">{currentBooking!.creator_name}</p>
                )}
                {(currentBooking!.attendee_names?.length ?? 0) > 0 && (
                  <p className="text-sm text-[#6a96bb] mt-1">
                    {currentBooking!.attendee_names?.join(', ')}
                  </p>
                )}
              </>
            )}
            {nextBooking && (
              <div className={!isBlackedOut && isOccupied ? 'mt-6 border-t border-white/10 pt-6' : ''}>
                <p className="text-xs font-medium text-[#6a96bb] uppercase tracking-widest">Next:</p>
                <p className="text-lg text-[#93b8d8]">{nextBooking.title}</p>
                <p className="text-sm text-[#6a96bb]">
                  {formatTimeRange(nextBooking.start_time, nextBooking.end_time)}
                </p>
                {nextBooking.creator_name && (
                  <p className="text-sm text-[#6a96bb] mt-3">{nextBooking.creator_name}</p>
                )}
                {(nextBooking.attendee_names?.length ?? 0) > 0 && (
                  <p className="text-sm text-[#6a96bb]/70 mt-1">
                    {nextBooking.attendee_names?.join(', ')}
                  </p>
                )}
              </div>
            )}
            {upcomingBookings.length > 0 && (
              <div className="mt-6 border-t border-white/10 pt-6">
                <p className="text-xs font-medium text-[#6a96bb] uppercase tracking-widest">Upcoming:</p>
                {upcomingBookings.map((b) => (
                  <div key={b.id} className="mt-4">
                    <p className="text-lg text-[#93b8d8]">{b.title}</p>
                    <p className="text-sm text-[#6a96bb]">{formatTimeRange(b.start_time, b.end_time)}</p>
                    {b.creator_name && (
                      <p className="text-sm text-[#6a96bb] mt-1">{b.creator_name}</p>
                    )}
                    {(b.attendee_names?.length ?? 0) > 0 && (
                      <p className="text-sm text-[#6a96bb]/70">{b.attendee_names?.join(', ')}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer strip */}
      <div className="h-8 flex items-center justify-between px-12 border-t border-white/10 flex-shrink-0">
        <span className="text-xs text-[#6a96bb]">Chambers · Northeastern SGA</span>
        <span className="text-xs text-[#6a96bb]">chambers.northeasternsga.com</span>
      </div>
    </div>
  )
}

export default function DisplayPage({ params }: { params: Promise<{ spaceId: string }> }) {
  const { spaceId } = use(params)
  return (
    <Suspense
      fallback={
        <div className={`h-screen w-screen flex items-center justify-center bg-[#0a1628] ${spaceGrotesk.className}`}>
          <p className="text-[#93b8d8] text-xl">Loading...</p>
        </div>
      }
    >
      <DisplayContent spaceId={spaceId} />
    </Suspense>
  )
}
