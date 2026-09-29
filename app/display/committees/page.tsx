'use client'

import { Space_Grotesk } from 'next/font/google'
import { useState, useEffect, Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  directionTo,
  floorOf,
  isCancelled,
  isVirtual,
  ordinalFloor,
  splitByTime,
  type CommitteeMeeting,
  type Direction,
} from '@/lib/committee-display'

/**
 * The committee wayfinding display (issue #187).
 *
 * Built like the SGA Spaces kiosk in app/display/[spaceId]: a client component
 * behind ?key=, polling every 50s but only while the tab is actually on screen,
 * and sized for a monitor read from across a corridor rather than a desk.
 *
 * ?floor= is what makes the arrows mean anything -- it says which floor the
 * screen itself is hanging on, so one page serves every screen. Without it the
 * display still names the room and the floor, it just does not point.
 */

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'] })

const ARROWS: Record<Direction, string> = {
  up: '↑',
  down: '↓',
  'same-floor': '→',
}

const DIRECTION_WORDS: Record<Direction, string> = {
  up: 'Upstairs',
  down: 'Downstairs',
  'same-floor': 'This floor',
}

function formatTime(time: string): string {
  const [h, m] = time.split(':').map(Number)
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
}

function formatClock(d: Date): string {
  const h = d.getHours()
  const ampm = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`
}

function formatDate(d: Date): string {
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
}

/** The room line, plus which way to walk when the screen knows where it is. */
function Wayfinding({ meeting, viewerFloor, large }: {
  meeting: CommitteeMeeting
  viewerFloor: number | null
  large?: boolean
}) {
  if (isVirtual(meeting.status)) {
    return <p className={`${large ? 'text-4xl' : 'text-xl'} text-[#93b8d8]`}>Virtual</p>
  }

  const room = meeting.roomName || 'Room to be confirmed'
  const floor = floorOf(meeting.roomName)
  const direction = isCancelled(meeting.status) ? null : directionTo(meeting.roomName, viewerFloor)

  return (
    <div className="flex items-baseline gap-4">
      {direction && (
        <span
          aria-hidden
          className={`${large ? 'text-6xl' : 'text-3xl'} font-bold text-[#4ade80] leading-none`}
        >
          {ARROWS[direction]}
        </span>
      )}
      <div>
        <p className={`${large ? 'text-5xl' : 'text-2xl'} font-semibold text-[#f0f6ff]`}>{room}</p>
        <p className={`${large ? 'text-xl' : 'text-sm'} text-[#6a96bb] mt-1`}>
          {[
            direction ? DIRECTION_WORDS[direction] : null,
            floor !== null ? `${ordinalFloor(floor)} floor` : null,
          ].filter(Boolean).join(' · ')}
        </p>
      </div>
    </div>
  )
}

function MeetingHeading({ meeting, large }: { meeting: CommitteeMeeting; large?: boolean }) {
  return (
    <>
      <p className={`${large ? 'text-6xl' : 'text-3xl'} font-bold text-[#f0f6ff]`}>{meeting.bodyName}</p>
      {meeting.purpose && (
        <p className={`${large ? 'text-2xl' : 'text-lg'} text-[#93b8d8] mt-2`}>{meeting.purpose}</p>
      )}
    </>
  )
}

function CommitteeDisplayContent() {
  const searchParams = useSearchParams()
  const key = searchParams.get('key')
  const floorParam = searchParams.get('floor')
  const viewerFloor = floorParam && /^\d+$/.test(floorParam) ? Number(floorParam) : null

  const [meetings, setMeetings] = useState<CommitteeMeeting[]>([])
  const [now, setNow] = useState(new Date())
  const [accessDenied, setAccessDenied] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Skip the tick while backgrounded -- nothing reads `now` when nobody can see it.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (accessDenied) return
    if (!key) {
      setAccessDenied(true)
      return
    }

    async function fetchData() {
      // The screen's own date, so "today" matches the clock beside it.
      const localNow = new Date()
      const localDate = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`
      const res = await fetch(`/api/display/committees?key=${encodeURIComponent(key!)}&date=${localDate}`)
      if (res.status === 401) {
        setAccessDenied(true)
        return
      }
      if (!res.ok) {
        setLoading(false)
        return
      }
      const data = await res.json()
      setMeetings(data.meetings ?? [])
      setLoading(false)
    }

    fetchData()

    // Same shape as the SGA Spaces kiosk (issue #25): the interval keeps running,
    // but the request is skipped while the tab is backgrounded, and a
    // visibilitychange listener catches the display up on return rather than
    // making it wait out the rest of the interval.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') fetchData()
    }, 50_000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') fetchData()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [key, accessDenied])

  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const { ongoing, upcoming } = useMemo(() => splitByTime(meetings, nowHm), [meetings, nowHm])

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

  // The one meeting the left half is given over to, and everything else in
  // start order behind it.
  const featured = ongoing[0] ?? upcoming[0] ?? null
  const rest = featured ? [...ongoing, ...upcoming].filter(m => m.id !== featured.id) : []

  return (
    <div className={`h-screen w-screen overflow-hidden flex flex-col bg-[#0a1628] ${spaceGrotesk.className}`}>
      <div className="flex flex-row flex-1 min-h-0">
        {/* Left: the meeting someone in this corridor is most likely looking for */}
        <div className="w-1/2 flex flex-col px-12 py-10">
          <div className="flex-shrink-0">
            <p className="text-xs font-medium text-[#6a96bb] uppercase tracking-widest">
              Committee meetings
            </p>
            <p className="text-6xl font-bold text-[#f0f6ff] tabular-nums mt-4">{formatClock(now)}</p>
            <p className="text-sm text-[#93b8d8] mt-1">{formatDate(now)}</p>
          </div>

          <div className="flex-1 mt-10 min-h-0">
            {featured ? (
              <>
                <p className="text-xs font-medium text-[#6a96bb] uppercase tracking-widest">
                  {ongoing.length ? 'Meeting now' : 'Up next'}
                </p>
                <div className="mt-3">
                  <MeetingHeading meeting={featured} large />
                </div>
                <p className="text-3xl text-[#93b8d8] mt-4 tabular-nums">
                  {formatTime(featured.meetingTime)}
                </p>
                {isCancelled(featured.status) && (
                  <p className="text-4xl font-bold text-[#f87171] mt-6">Cancelled</p>
                )}
                <div className="mt-8">
                  <Wayfinding meeting={featured} viewerFloor={viewerFloor} large />
                </div>
              </>
            ) : (
              <p className="text-4xl text-[#6a96bb]">No committee meetings left today</p>
            )}
          </div>
        </div>

        {/* Right: everything else still to come */}
        <div className="w-1/2 flex flex-col px-12 py-10 border-l border-white/10">
          <p className="text-xs font-medium text-[#6a96bb] uppercase tracking-widest flex-shrink-0">
            Also today
          </p>
          <div className="flex-1 mt-6 min-h-0 overflow-hidden">
            {rest.length === 0 && (
              <p className="text-xl text-[#6a96bb]">Nothing else scheduled</p>
            )}
            {rest.map(m => (
              <div key={m.id} className="mb-7 pb-7 border-b border-white/10 last:border-b-0">
                <div className="flex items-baseline justify-between gap-6">
                  <MeetingHeading meeting={m} />
                  <p className="text-2xl text-[#93b8d8] tabular-nums whitespace-nowrap">
                    {formatTime(m.meetingTime)}
                  </p>
                </div>
                <div className="mt-3">
                  <Wayfinding meeting={m} viewerFloor={viewerFloor} />
                </div>
                {isCancelled(m.status) && (
                  <p className="text-xl font-bold text-[#f87171] mt-2">Cancelled</p>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="h-8 flex items-center justify-between px-12 border-t border-white/10 flex-shrink-0">
        <span className="text-xs text-[#6a96bb]">Chambers · Northeastern SGA</span>
        <span className="text-xs text-[#6a96bb]">chambers.northeasternsga.com</span>
      </div>
    </div>
  )
}

export default function CommitteeDisplayPage() {
  return (
    <Suspense
      fallback={
        <div className={`h-screen w-screen flex items-center justify-center bg-[#0a1628] ${spaceGrotesk.className}`}>
          <p className="text-[#93b8d8] text-xl">Loading...</p>
        </div>
      }
    >
      <CommitteeDisplayContent />
    </Suspense>
  )
}
