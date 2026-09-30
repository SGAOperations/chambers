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
  selectBoard,
  shouldPointAt,
  type CommitteeMeeting,
  type Bearing,
} from '@/lib/committee-display'

/**
 * The committee wayfinding display (issue #187).
 *
 * Shaped like an airport board rather than the SGA Spaces kiosk: one meeting
 * fills the screen at a time and the day cycles through it, so every meeting
 * gets the whole display instead of a column of it. Dots say how many are in the
 * rotation, because a reader who sees one card must not conclude it is the only
 * one. From the kiosk it keeps only the plumbing -- a client component behind
 * ?key=, polling every 50s and only while the tab is actually on screen.
 *
 * ?key= is the only parameter. The arrows come from a bearing table in
 * lib/committee-display.ts, given for this one screen rather than derived, since
 * no room number can say which way to turn on the floor you are already on.
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
 * How long each meeting holds the screen before the next one (ms).
 *
 * The board shows one meeting at a time, so this is the whole budget a passer-by
 * gets to read four things -- who, when, which way, which room -- from across a
 * corridor. Much under this and the screen is unreadable to anyone not standing
 * still; much over and someone waiting for a later meeting to come round gives
 * up. The cost is the full rotation: at eight seconds a six-meeting evening
 * takes about fifty to come all the way round.
 */
const CYCLE_MS = 8_000

/**
 * How long a card takes to fade out before the next one fades in (ms).
 *
 * Cuts read as a glitch on a screen nobody is looking directly at -- a fade is
 * what tells a passer-by at the edge of their vision that the board changed
 * rather than broke. It is spent twice per turn, out and back in, so it comes
 * out of CYCLE_MS and cannot be long.
 */
const FADE_MS = 400

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

/**
 * Names a day the board has rolled forward to.
 *
 * A weekday alone is unambiguous inside a week and reads faster than a date;
 * past that it needs the date, since "Tuesday" two weeks out is a guess.
 */
function futureDayLabel(date: string, daysAhead: number): string {
  if (daysAhead === 1) return 'Tomorrow'
  const d = new Date(`${date}T00:00:00`)
  return daysAhead < 7
    ? d.toLocaleDateString('en-GB', { weekday: 'long' })
    : d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-2xl font-medium text-[#93b8d8] uppercase tracking-widest">{children}</p>
  )
}

/**
 * One meeting, filling the screen.
 *
 * There is only ever one on screen at a time, so everything here is sized for
 * the whole board rather than a column of it -- read at a walking pace from the
 * far end of a corridor.
 */
function MeetingCard({ meeting, label, pointTheWay }: {
  meeting: CommitteeMeeting
  label: string
  pointTheWay: boolean
}) {
  const cancelled = isCancelled(meeting.status)
  const virtual = isVirtual(meeting.status)

  const room = meeting.roomName || 'Room to be confirmed'
  // The arrow and the line under it are one piece of guidance, not two: "to your
  // left" is as much an instruction to walk as the arrow is, and neither belongs
  // on a meeting nobody should be setting off for yet. Both appear together or
  // not at all -- see shouldPointAt, which already excludes cancelled and
  // virtual. The room name is left standing on its own, since saying where
  // something is helps a reader whatever the hour.
  const direction = pointTheWay ? directionTo(meeting.roomName) : null
  const arrow = direction ? ARROWS[direction.bearing] : null
  // A floor number only means anything in the building the screen is in: 'Egan
  // 306' is not this building's third floor.
  const floor = direction && isInDisplayBuilding(meeting.roomName) ? floorOf(meeting.roomName) : null
  const directionLine = direction
    ? [
        direction.note ?? BEARING_WORDS[direction.bearing],
        floor !== null ? `${ordinalFloor(floor)} floor` : null,
      ].filter(Boolean).join(' · ')
    : ''

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-center px-16">
      <p
        className={`text-3xl font-medium uppercase tracking-widest ${
          cancelled ? 'text-[#f87171]' : 'text-[#93b8d8]'
        }`}
      >
        {label}
      </p>

      <p
        className={`text-8xl font-bold mt-6 text-balance ${
          cancelled ? 'text-[#93b8d8] line-through decoration-[#f87171] decoration-8' : 'text-[#f0f6ff]'
        }`}
      >
        {meeting.bodyName}
        {meeting.isEvent && (
          <span className="text-3xl font-semibold uppercase tracking-wide align-middle ml-6 px-4 py-1.5 rounded-full bg-[#062f3b] text-[#22d3ee]">
            Event
          </span>
        )}
      </p>

      {meeting.purpose && !cancelled && (
        <p className="text-4xl text-[#93b8d8] mt-5">{meeting.purpose}</p>
      )}

      <p className="text-6xl font-semibold text-[#f0f6ff] tabular-nums mt-10">
        {formatTime(meeting.meetingTime)}
      </p>

      {virtual ? (
        <p className="text-6xl font-semibold text-[#93b8d8] mt-8">Virtual — no room</p>
      ) : (
        <div className="flex items-center gap-8 mt-8">
          {arrow && (
            <span aria-hidden className="text-8xl font-bold text-[#4ade80] leading-none">
              {arrow}
            </span>
          )}
          <div>
            <p
              className={`text-7xl font-semibold ${
                cancelled ? 'text-[#93b8d8] line-through decoration-[#f87171] decoration-8' : 'text-[#f0f6ff]'
              }`}
            >
              {room}
            </p>
            {directionLine && (
              <p className="text-3xl text-[#93b8d8] mt-3">{directionLine}</p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Which of the day's meetings is on screen, and how many there are.
 *
 * A passer-by needs to know the board is a rotation rather than the whole story,
 * or they will read one meeting and walk away believing it is the only one.
 */
function CycleDots({ count, index }: { count: number; index: number }) {
  if (count < 2) return null
  return (
    <div className="flex items-center justify-center gap-3 flex-shrink-0 pb-6" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`rounded-full transition-colors ${
            i === index ? 'w-4 h-4 bg-[#4ade80]' : 'w-3 h-3 bg-white/25'
          }`}
        />
      ))}
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
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  // Today while any of it is left, otherwise whatever day is next. The screen
  // does not go blank at the end of an afternoon.
  const board = useMemo(() => selectBoard(meetings, todayStr, nowHm), [meetings, todayStr, nowHm])

  // What is happening now comes round first, then the rest of the day in start
  // order. One flat rotation rather than a board: there is no second column to
  // put anything in.
  const order = useMemo(() => (board ? [...board.ongoing, ...board.upcoming] : []), [board])
  const ongoingIds = useMemo(() => new Set(board?.ongoing.map(m => m.id) ?? []), [board])

  const [cardIndex, setCardIndex] = useState(0)
  const [visible, setVisible] = useState(true)

  // Advance on a timer, not on the clock tick, so a meeting gets its full turn.
  // Paused while backgrounded and skipped entirely for a single meeting, which
  // would otherwise "cycle" from itself to itself.
  //
  // Fade out, swap, fade back in -- the card is only exchanged while it is
  // already invisible, so the text never changes in front of anyone. That is
  // also why the index moves inside the timeout rather than beside it.
  useEffect(() => {
    if (order.length < 2) return
    let swap: ReturnType<typeof setTimeout> | undefined
    const interval = setInterval(() => {
      if (document.visibilityState !== 'visible') return
      setVisible(false)
      swap = setTimeout(() => {
        setCardIndex(i => (i + 1) % order.length)
        setVisible(true)
      }, FADE_MS)
    }, CYCLE_MS)
    return () => {
      clearInterval(interval)
      clearTimeout(swap)
    }
  }, [order.length])

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

  const stale = lastLoaded !== null && now.getTime() - lastLoaded > STALE_AFTER_MS

  // The rotation can shrink under the index when a meeting ends, so wrap rather
  // than trusting the timer's own count.
  const current = order.length ? order[cardIndex % order.length] : null
  // On a future day the label says which day, because "Up next" beside tonight's
  // clock would read as tonight. Nothing on a future day is in progress, so
  // "Meeting now" cannot arise there.
  const dayPrefix = board && board.daysAhead > 0 ? futureDayLabel(board.date, board.daysAhead) : null
  const label = !current
    ? ''
    : dayPrefix
      ? (isCancelled(current.status) ? `${dayPrefix} · Cancelled` : dayPrefix)
      : isCancelled(current.status)
        ? 'Cancelled'
        : ongoingIds.has(current.id)
          ? 'Meeting now'
          : 'Up next'

  return (
    <div className={`h-screen w-screen overflow-hidden flex flex-col bg-[#0a1628] ${spaceGrotesk.className}`}>
      {/* Standing chrome: the clock stays put while the meetings turn over, so a
          reader can tell the board is live rather than frozen on one card. */}
      <div className="flex items-start justify-between px-16 pt-10 flex-shrink-0">
        <Eyebrow>Meetings &amp; events</Eyebrow>
        <div className="text-right">
          <p className="text-5xl font-bold text-[#f0f6ff] tabular-nums leading-none">{formatClock(now)}</p>
          <p className="text-xl text-[#93b8d8] mt-2">{formatDate(now)}</p>
        </div>
      </div>

      {current ? (
        /* No key on the card: remounting it would snap straight to the new text
           at full opacity, which is the cut this wrapper exists to prevent. The
           swap happens inside, while opacity is already 0. */
        <div
          className={`flex-1 min-h-0 flex flex-col transition-opacity ease-in-out ${
            visible ? 'opacity-100' : 'opacity-0'
          }`}
          style={{ transitionDuration: `${FADE_MS}ms` }}
        >
          <MeetingCard
            meeting={current}
            label={label}
            pointTheWay={shouldPointAt(current, board!.daysAhead, nowHm)}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-16">
          <p className="text-7xl font-semibold text-[#93b8d8] text-center">Nothing scheduled</p>
          <p className="text-3xl text-[#6a96bb] text-center mt-6">Nothing in the next two weeks</p>
        </div>
      )}

      <CycleDots count={order.length} index={order.length ? cardIndex % order.length : 0} />

      <div className="h-8 flex items-center justify-between px-16 border-t border-white/10 flex-shrink-0">
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
