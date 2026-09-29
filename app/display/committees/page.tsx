'use client'

import { Space_Grotesk } from 'next/font/google'
import { useState, useEffect, Suspense, useMemo } from 'react'
import { useSearchParams } from 'next/navigation'
import {
  directionTo,
  floorOf,
  isCancelled,
  isInDisplayBuilding,
  isVirtual,
  ordinalFloor,
  splitByTime,
  type CommitteeMeeting,
  type Bearing,
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
 *
 * Everything here is read while walking past, which is why there is no smallest
 * tier of type below ~20px except the footer chrome, why nothing is revealed by
 * hover or a tap, and why a cancelled meeting is struck through rather than
 * merely annotated: a glance has to be enough, and a glance that lands on the
 * room number of a meeting that is not happening sends someone up two floors
 * for nothing.
 */

const spaceGrotesk = Space_Grotesk({ subsets: ['latin'] })

const ARROWS: Record<Bearing, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  'up-left': '↖',
  'up-right': '↗',
}

const BEARING_WORDS: Record<Bearing, string> = {
  up: 'Upstairs',
  down: 'Downstairs',
  left: 'To your left',
  'up-left': 'Upstairs',
  'up-right': 'Upstairs',
}

/**
 * How many of the day's remaining meetings the right-hand column lists.
 *
 * At this type size the column holds about this many on a 1080p screen, and a
 * row half off the bottom edge is worse than a count saying it is there --
 * `overflow-hidden` alone would clip silently, with nothing to tell a reader
 * that the list they are looking at is not the whole day.
 */
const REST_LIMIT = 4

/** How long stale data may sit on screen before the footer admits it (ms). */
const STALE_AFTER_MS = 5 * 60_000

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

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-2xl font-medium text-[#93b8d8] uppercase tracking-widest">{children}</p>
  )
}

/** The room line, plus which way to walk when the screen knows the way. */
function Wayfinding({ meeting, large }: {
  meeting: CommitteeMeeting
  large?: boolean
}) {
  if (isVirtual(meeting.status)) {
    return <p className={`${large ? 'text-5xl' : 'text-2xl'} font-semibold text-[#93b8d8]`}>Virtual — no room</p>
  }

  const room = meeting.roomName || 'Room to be confirmed'
  // A floor number only means anything in the building the screen is in: 'Egan
  // 306' is not this building's third floor.
  const floor = isInDisplayBuilding(meeting.roomName) ? floorOf(meeting.roomName) : null
  const cancelled = isCancelled(meeting.status)
  // No arrow for a cancelled meeting: an arrow is an instruction to walk, and
  // there is nothing at the other end of it.
  const direction = cancelled ? null : directionTo(meeting.roomName)
  const arrow = direction ? ARROWS[direction.bearing] : null

  return (
    <div className="flex items-baseline gap-4">
      {arrow && (
        <span
          aria-hidden
          className={`${large ? 'text-6xl' : 'text-3xl'} font-bold text-[#4ade80] leading-none`}
        >
          {arrow}
        </span>
      )}
      <div>
        <p
          className={`${large ? 'text-5xl' : 'text-2xl'} font-semibold ${
            cancelled ? 'text-[#93b8d8] line-through decoration-[#f87171] decoration-4' : 'text-[#f0f6ff]'
          }`}
        >
          {room}
        </p>
        {!cancelled && (direction || floor !== null) && (
          <p className={`${large ? 'text-2xl' : 'text-xl'} text-[#93b8d8] mt-1`}>
            {[
              direction ? (direction.note ?? BEARING_WORDS[direction.bearing]) : null,
              floor !== null ? `${ordinalFloor(floor)} floor` : null,
            ].filter(Boolean).join(' · ')}
          </p>
        )}
      </div>
    </div>
  )
}

function MeetingHeading({ meeting, large }: { meeting: CommitteeMeeting; large?: boolean }) {
  const cancelled = isCancelled(meeting.status)
  return (
    <div>
      <p
        className={`${large ? 'text-6xl' : 'text-3xl'} font-bold ${
          cancelled ? 'text-[#93b8d8] line-through decoration-[#f87171] decoration-4' : 'text-[#f0f6ff]'
        }`}
      >
        {meeting.bodyName}
        {meeting.isEvent && (
          <span
            className={`${large ? 'text-2xl' : 'text-lg'} font-semibold uppercase tracking-wide align-middle ml-4 px-3 py-1 rounded-full bg-[#062f3b] text-[#22d3ee]`}
          >
            Event
          </span>
        )}
      </p>
      {/* Immediately under the name, at the name's own weight -- not a footnote
          below the room, where the room is the larger thing on the line. */}
      {cancelled && (
        <p className={`${large ? 'text-5xl' : 'text-3xl'} font-bold text-[#f87171] uppercase tracking-wide mt-2`}>
          Cancelled
        </p>
      )}
      {meeting.purpose && !cancelled && (
        <p className={`${large ? 'text-3xl' : 'text-2xl'} text-[#93b8d8] mt-2`}>{meeting.purpose}</p>
      )}
    </div>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className={`h-screen w-screen flex items-center justify-center bg-[#0a1628] ${spaceGrotesk.className}`}>
      {children}
    </div>
  )
}

function CommitteeDisplayContent() {
  const searchParams = useSearchParams()
  const key = searchParams.get('key')

  const [meetings, setMeetings] = useState<CommitteeMeeting[]>([])
  const [now, setNow] = useState(new Date())
  // Only the 401 needs to be remembered: a missing ?key= is already knowable
  // from the URL at render time, so deriving it beats an effect that sets state
  // on first paint just to re-render into the denied screen.
  const [keyRejected, setKeyRejected] = useState(false)
  const accessDenied = !key || keyRejected
  const [loading, setLoading] = useState(true)
  const [lastLoaded, setLastLoaded] = useState<number | null>(null)

  useEffect(() => {
    // Skip the tick while backgrounded -- nothing reads `now` when nobody can see it.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }, 1000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!key || keyRejected) return

    async function fetchData() {
      // The screen's own date, so "today" matches the clock beside it.
      const localNow = new Date()
      const localDate = `${localNow.getFullYear()}-${String(localNow.getMonth() + 1).padStart(2, '0')}-${String(localNow.getDate()).padStart(2, '0')}`
      try {
        const res = await fetch(`/api/display/committees?key=${encodeURIComponent(key!)}&date=${localDate}`)
        if (res.status === 401) {
          setKeyRejected(true)
          return
        }
        if (!res.ok) {
          setLoading(false)
          return
        }
        const data = await res.json()
        setMeetings(data.meetings ?? [])
        setLastLoaded(Date.now())
        setLoading(false)
      } catch {
        // Nobody is standing here to retry it. Keep the last good board up, let
        // the footer say how old it is, and wait for the next tick.
        setLoading(false)
      }
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
  }, [key, keyRejected])

  const nowHm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
  const { ongoing, upcoming } = useMemo(() => splitByTime(meetings, nowHm), [meetings, nowHm])

  if (accessDenied) {
    return <Shell><p className="text-[#f87171] text-4xl font-semibold">Access denied</p></Shell>
  }

  if (loading) {
    return <Shell><p className="text-[#93b8d8] text-3xl">Loading…</p></Shell>
  }

  // Never got an answer, so there is nothing to say about today. Drawing the
  // board here would show an empty schedule -- "Nothing left today" --
  // which is a claim this screen has no grounds to make, and the one
  // failure mode that actively sends people home. The interval keeps retrying
  // behind this.
  if (lastLoaded === null) {
    return (
      <Shell>
        <p className="text-[#f87171] text-4xl font-semibold text-center px-12">
          Can&rsquo;t load today&rsquo;s meetings
        </p>
      </Shell>
    )
  }

  // The one meeting the left half is given over to, and everything else in
  // start order behind it.
  const featured = ongoing[0] ?? upcoming[0] ?? null
  const rest = featured ? [...ongoing, ...upcoming].filter(m => m.id !== featured.id) : []
  const shown = rest.slice(0, REST_LIMIT)
  const hidden = rest.length - shown.length

  const stale = lastLoaded !== null && now.getTime() - lastLoaded > STALE_AFTER_MS

  const header = (
    <div className="flex-shrink-0">
      <Eyebrow>Meetings &amp; events</Eyebrow>
      <p className="text-7xl font-bold text-[#f0f6ff] tabular-nums mt-4">{formatClock(now)}</p>
      <p className="text-2xl text-[#93b8d8] mt-2">{formatDate(now)}</p>
    </div>
  )

  return (
    <div className={`h-screen w-screen overflow-hidden flex flex-col bg-[#0a1628] ${spaceGrotesk.className}`}>
      {featured ? (
        <div className="flex flex-row flex-1 min-h-0">
          {/* Left: the meeting someone in this corridor is most likely looking for */}
          <div className="w-1/2 flex flex-col px-12 py-10">
            {header}
            <div className="flex-1 mt-10 min-h-0">
              <Eyebrow>{ongoing.length ? 'Meeting now' : 'Up next'}</Eyebrow>
              <div className="mt-3">
                <MeetingHeading meeting={featured} large />
              </div>
              <p className="text-4xl text-[#93b8d8] mt-6 tabular-nums">
                {formatTime(featured.meetingTime)}
              </p>
              <div className="mt-8">
                <Wayfinding meeting={featured} large />
              </div>
            </div>
          </div>

          {/* Right: everything else still to come */}
          <div className="w-1/2 flex flex-col px-12 py-10 border-l border-white/10">
            <div className="flex-shrink-0">
              <Eyebrow>Also today</Eyebrow>
            </div>
            <div className="flex-1 mt-6 min-h-0 overflow-hidden">
              {shown.length === 0 && (
                <p className="text-3xl text-[#93b8d8]">Nothing else scheduled</p>
              )}
              {shown.map(m => (
                <div key={m.id} className="mb-7 pb-7 border-b border-white/10 last:border-b-0">
                  <div className="flex items-baseline justify-between gap-6">
                    <MeetingHeading meeting={m} />
                    <p className="text-3xl text-[#93b8d8] tabular-nums whitespace-nowrap">
                      {formatTime(m.meetingTime)}
                    </p>
                  </div>
                  <div className="mt-3">
                    <Wayfinding meeting={m} />
                  </div>
                </div>
              ))}
              {hidden > 0 && (
                <p className="text-2xl text-[#93b8d8] mt-2">
                  + {hidden} more {hidden === 1 ? 'meeting' : 'meetings'} later today
                </p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* Nothing left to point at. One message across the whole screen rather
           than an empty column beside an empty column. */
        <div className="flex-1 min-h-0 flex flex-col px-12 py-10">
          {header}
          <div className="flex-1 flex items-center justify-center">
            <p className="text-6xl font-semibold text-[#93b8d8] text-center">
              Nothing left today
            </p>
          </div>
        </div>
      )}

      <div className="h-8 flex items-center justify-between px-12 border-t border-white/10 flex-shrink-0">
        <span className="text-xs text-[#6a96bb]">Chambers · Northeastern SGA</span>
        {stale ? (
          <span className="text-xs text-[#f87171]">Not updating — last checked {formatClock(new Date(lastLoaded!))}</span>
        ) : (
          <span className="text-xs text-[#6a96bb]">chambers.northeasternsga.com</span>
        )}
      </div>
    </div>
  )
}

export default function CommitteeDisplayPage() {
  return (
    <Suspense fallback={<Shell><p className="text-[#93b8d8] text-3xl">Loading…</p></Shell>}>
      <CommitteeDisplayContent />
    </Suspense>
  )
}
