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
  type Wayfinding,
} from '@/lib/committee-display'
import { type DisplaySpace } from '@/lib/spaces-display'
import { SpacesCard } from './spaces-card'

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

const BEARING_WORDS: Record<Bearing, string> = {
  up: 'Upstairs',
  down: 'Downstairs',
  left: 'To your left',
  right: 'To your right',
  'up-left': 'Upstairs',
  'up-right': 'Upstairs',
}

/**
 * The wording for a room in another building.
 *
 * BEARING_WORDS is about this building: it reads 'up' as a staircase, which is
 * the wrong thing to say about Ryder. These say which way to walk and leave the
 * building name to the room line, which already carries it.
 */
const BUILDING_BEARING_WORDS: Record<Bearing, string> = {
  up: 'Straight ahead',
  down: 'Back the way you came',
  left: 'To your left',
  right: 'To your right',
  'up-left': 'Ahead and to your left',
  'up-right': 'Ahead and to your right',
}

/**
 * How far a right-pointing glyph must turn to face each bearing.
 *
 * Used to aim the double chevron, which exists only pointing right. Rotating
 * one glyph beats collecting six: Unicode has no double chevron for the
 * diagonals at all, and the arrowhead pairs it does have (U+21C7 and friends)
 * are missing from enough fonts that the board would fall back to tofu on a
 * screen nobody is standing at to notice.
 */
const BEARING_ROTATION: Record<Bearing, number> = {
  right: 0,
  'up-right': -45,
  up: -90,
  'up-left': -135,
  left: 180,
  down: 90,
}

/**
 * How big every direction mark is drawn.
 *
 * One size for all three, so an arrow and a chevron carry the same weight and
 * only their shape says how far the walk is. Larger than the text arrows it
 * replaced: a glyph only ever inks part of its em box -- the old arrow used
 * about 70% of its height and a good deal less of its width -- while a drawing
 * uses all of it.
 */
const MARK_SIZE = 'w-[min(7.5vw,13.3vh)] h-[min(7.5vw,13.3vh)]'

/**
 * Which way to walk, and how far the walk is.
 *
 * A plain arrow for a room on this floor, one chevron for another floor of this
 * building, two for another building. The shape carries the distance, so a
 * reader learns the scale once and then reads it at a glance: the arrow for 333
 * means "turn round", and nothing that means "go upstairs" wears the same mark.
 *
 * All three are drawn rather than typed. The arrows were glyphs until the board
 * went up and they proved too light beside the chevrons to read from the far
 * end of a corridor -- a font gives no way to thicken one, and U+00BB was worse
 * still, punctuation whose ink runs about two thirds of an arrow's. These are
 * mitred strokes at a weight chosen for the wall.
 *
 * One square drawing rotated per bearing, rather than six drawn: the glyph sets
 * have no diagonals for the chevrons at all, and this way every mark turns on
 * the same axis and cannot drift out of step with the others.
 */
/**
 * A gap that holds its size while there is room and gives it up when there is not.
 *
 * The card's vertical rhythm was fixed margins, which is right until a body
 * name wraps: "Global Experience Committee" takes two lines of the largest type
 * on the board, and the room and its arrow were pushed down onto the footer
 * with the day's meetings still to come. Centring does not help -- the content
 * is simply taller than the card.
 *
 * As flex basis instead, every gap shrinks in proportion once the content stops
 * fitting, and the text keeps its size because only these give way. A one-line
 * card is spaced exactly as it was; a two- or three-line one closes up rather
 * than running off the bottom.
 */
function Gap({ size, min }: { size: string; min: string }) {
  return <div aria-hidden style={{ flexBasis: size, minHeight: min }} />
}

function DirectionArrow({ direction }: { direction: Wayfinding }) {
  const away = direction.offBuilding || direction.offFloor

  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      className={`${MARK_SIZE} flex-shrink-0`}
      style={{ transform: `rotate(${BEARING_ROTATION[direction.bearing]}deg)` }}
      fill="none"
      stroke="#4ade80"
      strokeWidth={4}
      // Butt ends and a mitred point: square cuts and a sharp apex, rather than
      // the rounded nib a default cap would give it.
      strokeLinecap="butt"
      strokeLinejoin="miter"
    >
      {!away && (
        <>
          <line x1="2" y1="12" x2="18" y2="12" />
          <polyline points="11,5 18,12 11,19" />
        </>
      )}
      {away && direction.offFloor && !direction.offBuilding && (
        <polyline points="8,5 16,12 8,19" />
      )}
      {direction.offBuilding && (
        <>
          <polyline points="3,5 11,12 3,19" />
          <polyline points="12,5 20,12 12,19" />
        </>
      )}
    </svg>
  )
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

/**
 * The screen's own date, so "today" matches the clock beside it.
 *
 * Local fields rather than UTC: the display hangs in Boston, which is the same
 * reason nowHm below is read the same way.
 */
function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
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
    <p className="text-[min(1.56vw,2.78vh)] font-medium text-[#93b8d8] uppercase tracking-widest">{children}</p>
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
  // A floor number only means anything in the building the screen is in: 'Egan
  // 306' is not this building's third floor.
  const floor = direction && isInDisplayBuilding(meeting.roomName) ? floorOf(meeting.roomName) : null
  const directionLine = direction
    ? [
        direction.note ??
          (direction.offBuilding
            ? BUILDING_BEARING_WORDS[direction.bearing]
            : BEARING_WORDS[direction.bearing]),
        floor !== null ? `${ordinalFloor(floor)} floor` : null,
      ].filter(Boolean).join(' · ')
    : ''

  return (
    /* py reserves clearance the content may not eat into. Centring alone gave
       a two-line name 15px above the footer rule and 15px below the clock --
       "Global Experience Committee" is two lines of the largest type on the
       board, and the card was very nearly full. Reserving the margin instead
       forces the Gaps below to give way, so the room and its arrow sit clear of
       the footer at any name length, and a one-line card is spaced exactly as
       it was because it never has to shrink at all. */
    <div className="flex-1 min-h-0 flex flex-col justify-center px-[4.2vw] py-[4vh]">
      <p
        className={`flex-shrink-0 text-[min(1.88vw,3.33vh)] font-medium uppercase tracking-widest ${
          cancelled ? 'text-[#f87171]' : 'text-[#93b8d8]'
        }`}
      >
        {label}
      </p>

      <Gap size="3vh" min="1vh" />

      <p
        className={`flex-shrink-0 text-[min(6.67vw,11.85vh)] font-bold leading-[1.05] text-balance ${
          cancelled ? 'text-[#93b8d8] line-through decoration-[#f87171] decoration-8' : 'text-[#f0f6ff]'
        }`}
      >
        {meeting.bodyName}
        {meeting.isEvent && (
          <span className="text-[min(1.88vw,3.33vh)] font-semibold uppercase tracking-wide align-middle ml-[1.7vw] px-[1.2vw] py-[0.6vh] rounded-full bg-[#062f3b] text-[#22d3ee]">
            Event
          </span>
        )}
      </p>

      {meeting.purpose && !cancelled && (
        <>
          <Gap size="2.2vh" min="0.7vh" />
          <p className="flex-shrink-0 text-[min(2.5vw,4.44vh)] text-[#93b8d8]">{meeting.purpose}</p>
        </>
      )}

      <Gap size="5.9vh" min="1.2vh" />

      <p className="flex-shrink-0 text-[min(3.75vw,6.67vh)] font-semibold text-[#f0f6ff] tabular-nums">
        {formatTime(meeting.meetingTime)}
      </p>

      <Gap size="5.2vh" min="1.2vh" />

      {virtual ? (
        <p className="flex-shrink-0 text-[min(3.75vw,6.67vh)] font-semibold text-[#93b8d8]">Virtual — no room</p>
      ) : (
        <div className="flex-shrink-0 flex items-center gap-[2.1vw]">
          {direction && <DirectionArrow direction={direction} />}
          <div>
            <p
              className={`text-[min(5vw,8.89vh)] font-semibold ${
                cancelled ? 'text-[#93b8d8] line-through decoration-[#f87171] decoration-8' : 'text-[#f0f6ff]'
              }`}
            >
              {room}
            </p>
            {directionLine && (
              <p className="text-[min(1.88vw,3.33vh)] text-[#93b8d8] mt-[1.5vh]">{directionLine}</p>
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
    <div className="flex items-center justify-center gap-[0.8vw] flex-shrink-0 pb-[2.2vh]" aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <span
          key={i}
          className={`rounded-full transition-colors ${
            i === index ? 'w-[0.9vh] h-[0.9vh] bg-[#4ade80]' : 'w-[0.7vh] h-[0.7vh] bg-white/25'
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

/**
 * One turn of the rotation: a meeting, or the All Spaces card.
 *
 * A union rather than a nullable meeting, so adding a third kind of card later
 * is a case to handle rather than a flag to thread through.
 */
type Card = { kind: 'meeting'; meeting: CommitteeMeeting } | { kind: 'spaces' }

function CommitteeDisplayContent() {
  const searchParams = useSearchParams()
  const key = searchParams.get('key')

  const [meetings, setMeetings] = useState<CommitteeMeeting[]>([])
  // Null until the spaces route has answered once. Distinct from an empty
  // list, which is a real answer meaning there are no spaces to show: the
  // card joins the rotation only once there is something true to put on it.
  const [spaces, setSpaces] = useState<DisplaySpace[] | null>(null)
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
      const localDate = localDateString()
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

    // Its own request, and its own failure. A spaces query that goes wrong
    // must not take the meetings board down with it, and vice versa -- so this
    // keeps whatever was last on the card and lets the next tick try again.
    async function fetchSpaces() {
      try {
        const res = await fetch(
          `/api/display/all-spaces?key=${encodeURIComponent(key!)}&date=${localDateString()}`
        )
        if (!res.ok) return
        const data = await res.json()
        setSpaces(data.spaces ?? [])
      } catch {
        // Nobody is here to retry it. Leave the last good card up.
      }
    }

    fetchData()
    fetchSpaces()

    // Same shape as the SGA Spaces kiosk (issue #25): the interval keeps running,
    // but the request is skipped while the tab is backgrounded, and a
    // visibilitychange listener catches the display up on return rather than
    // making it wait out the rest of the interval.
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData()
        fetchSpaces()
      }
    }, 50_000)

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        fetchData()
        fetchSpaces()
      }
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
  //
  // The spaces card rides at the end of the turn, once per rotation. It is a
  // card of a different kind rather than a meeting, hence the tag: everything
  // downstream has to know which of the two it is drawing.
  const order = useMemo<Card[]>(() => {
    const cards: Card[] = board
      ? [...board.ongoing, ...board.upcoming].map(meeting => ({ kind: 'meeting' as const, meeting }))
      : []
    // Only once the route has answered, and only if there is a space to draw.
    // An empty card in the rotation is a dead turn on a screen whose whole
    // budget is how long a passer-by will stand there.
    if (spaces && spaces.length) cards.push({ kind: 'spaces' })
    return cards
  }, [board, spaces])
  const ongoingIds = useMemo(() => new Set(board?.ongoing.map(m => m.id) ?? []), [board])
  // Minutes since midnight, in the same wall-clock domain the bookings use.
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

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
  const currentMeeting = current?.kind === 'meeting' ? current.meeting : null
  // On a future day the label says which day, because "Up next" beside tonight's
  // clock would read as tonight. Nothing on a future day is in progress, so
  // "Meeting now" cannot arise there.
  const dayPrefix = board && board.daysAhead > 0 ? futureDayLabel(board.date, board.daysAhead) : null
  const label = !currentMeeting
    ? ''
    : dayPrefix
      ? (isCancelled(currentMeeting.status) ? `${dayPrefix} · Cancelled` : dayPrefix)
      : isCancelled(currentMeeting.status)
        ? 'Cancelled'
        : ongoingIds.has(currentMeeting.id)
          ? 'Meeting now'
          : 'Up next'

  return (
    <div className={`h-screen w-screen overflow-hidden flex flex-col bg-[#0a1628] ${spaceGrotesk.className}`}>
      {/* Standing chrome: the clock stays put while the meetings turn over, so a
          reader can tell the board is live rather than frozen on one card. */}
      <div className="flex items-start justify-between px-[4.2vw] pt-[4.4vh] flex-shrink-0">
        <Eyebrow>{current?.kind === 'spaces' ? 'SGA Spaces' : <>Meetings &amp; events</>}</Eyebrow>
        <div className="text-right">
          <p className="text-[min(3.13vw,5.56vh)] font-bold text-[#f0f6ff] tabular-nums leading-none">{formatClock(now)}</p>
          <p className="text-[min(1.25vw,2.22vh)] text-[#93b8d8] mt-[1.1vh]">{formatDate(now)}</p>
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
          {current.kind === 'spaces' ? (
            <SpacesCard spaces={spaces!} nowMinutes={nowMinutes} />
          ) : (
            <MeetingCard
              meeting={current.meeting}
              label={label}
              pointTheWay={shouldPointAt(current.meeting, board!.daysAhead, nowHm)}
            />
          )}
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col items-center justify-center px-16">
          <p className="text-[min(5vw,8.89vh)] font-semibold text-[#93b8d8] text-center">Nothing scheduled</p>
          <p className="text-[min(1.88vw,3.33vh)] text-[#6a96bb] text-center mt-[3vh]">Nothing in the next two weeks</p>
        </div>
      )}

      <CycleDots count={order.length} index={order.length ? cardIndex % order.length : 0} />

      <div className="h-[3vh] flex items-center justify-between px-[4.2vw] border-t border-white/10 flex-shrink-0">
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
