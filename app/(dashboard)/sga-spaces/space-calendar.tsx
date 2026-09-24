'use client'

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'
import { repeatsLabel } from '@/lib/space-series'

interface Booking {
  id: string
  space_id: string
  creator_id: string
  title: string
  start_time: string
  end_time: string
  attendee_ids: string[]
  external_attendees?: string[] | null
  creator_name: string | null
  series_id: string | null
  /** That series' cadence, 'weekly' or 'biweekly' (issue #173). Null on a one-off. */
  series_frequency?: string | null
}

interface Blackout {
  id: string
  space_id: string | null
  start_time: string
  end_time: string
}

interface CalendarSpace {
  id: string
  name: string
}

interface SpaceCalendarProps {
  weekStart: Date // Sunday 00:00 UTC
  bookings: Booking[]
  blackouts: Blackout[]
  currentUserId?: string
  minHoursAdvance?: number
  canBook?: boolean
  /**
   * Given for the All spaces view: each day splits into one lane per space, and
   * a time is open while any of them is free. Omitted, the calendar shows one
   * space, as it always has.
   */
  spaces?: CalendarSpace[]
  /** `freeSpaceIds` are the spaces free for the whole selection -- only filled in the All spaces view. */
  onSlotClick: (startIso: string, endIso: string, freeSpaceIds: string[]) => void
  /** A booking of yours was clicked: opens it to edit. */
  onBookingClick?: (booking: Booking) => void
  /**
   * Someone else's booking was clicked: opens it read-only (issue #142). A block
   * can often fit only the start of its title, and before this there was no way
   * to see the rest.
   */
  onViewBooking?: (booking: Booking) => void
}

// Total slots: 24 hours * 4 slots/hour = 96
const TOTAL_SLOTS = 96
const SLOT_HEIGHT = 14 // px per 15-min slot
const DEAD_ZONE_START = 0  // slot index 0 = 00:00
const DEAD_ZONE_END = 28   // slot index 28 = 07:00 (7 * 4)

/**
 * How long a plain click books: an hour. A 15-minute default meant nearly every
 * booking started with dragging the end out, which on a phone -- where there is
 * no drag, only a tap -- meant fixing the time in the form every time.
 */
const CLICK_SLOTS = 4

/**
 * The line height of text inside a booking block, in px. The block's height is
 * known exactly (slots x SLOT_HEIGHT), so this is what decides how many lines of
 * title fit before it has to clamp (issue #142).
 */
const BLOCK_LINE_PX = 10

/**
 * How a booking block spends its lines: the title gets as many as fit, and the
 * host's name one more only if there is room for both.
 *
 * Blocks used to truncate the title to a single line whatever their height, so
 * an hour-long booking read "Website Creat" with four empty lines under it. A
 * half-hour block was worse: it laid title and name side by side, the name kept
 * its full width, and the title was left with "W." (issue #142). The title is
 * what distinguishes one booking from another, so it comes first; the name is
 * one click away in the booking's details.
 */
function blockLines(slots: number, hasCreator: boolean): { titleLines: number; showCreator: boolean } {
  // 4px of the block goes to its border and top padding.
  const lines = Math.max(1, Math.floor((slots * SLOT_HEIGHT - 4) / BLOCK_LINE_PX))
  const showCreator = hasCreator && lines >= 2
  return { titleLines: showCreator ? lines - 1 : lines, showCreator }
}

/**
 * One colour per space in the All spaces view, in the order the spaces are
 * listed. The first is the red a single space has always been drawn in.
 */
const LANE_COLORS = ['#c8102e', '#2b7bd3', '#d18a0b', '#139e8c', '#8a5cd6']

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function slotIndex(iso: string): number {
  const d = new Date(iso)
  return d.getUTCHours() * 4 + Math.floor(d.getUTCMinutes() / 15)
}

function slotToLabel(slot: number): string {
  const totalMinutes = slot * 15
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  const period = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return m === 0 ? `${h12} ${period}` : `${h12}:${String(m).padStart(2, '0')} ${period}`
}

function slotToIso(weekStart: Date, dayIndex: number, slotIdx: number): string {
  const d = new Date(weekStart)
  d.setUTCDate(weekStart.getUTCDate() + dayIndex)
  d.setUTCHours(Math.floor(slotIdx / 4), (slotIdx % 4) * 15, 0, 0)
  return d.toISOString()
}

function dayOfWeekUTC(iso: string): number {
  return new Date(iso).getUTCDay()
}

/**
 * Where a selection wants to end. One that has not left the slot it started in
 * is a click, and asks for CLICK_SLOTS; dragging sets the length by hand.
 */
function rawEndFor(startSlot: number, slot: number): number {
  return slot === startSlot ? startSlot + CLICK_SLOTS : slot + 1
}

function isDeadZone(slot: number): boolean {
  return slot >= DEAD_ZONE_START && slot < DEAD_ZONE_END
}

interface DragState {
  dayIdx: number
  startSlot: number
  currentSlot: number
}

interface DragPreview {
  dayIdx: number
  startSlot: number
  endSlot: number // exclusive
}

export default function SpaceCalendar({
  weekStart,
  bookings,
  blackouts,
  currentUserId,
  minHoursAdvance = 24,
  canBook = false,
  spaces,
  onSlotClick,
  onBookingClick,
  onViewBooking,
}: SpaceCalendarProps) {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(timer)
  }, [])

  // Re-express "now" in wall-clock UTC space so day/hour comparisons align with
  // how the calendar stores times (local 2 PM → T14:00Z, not T18:00Z).
  const wallClockNow = new Date(Date.UTC(
    now.getFullYear(), now.getMonth(), now.getDate(),
    now.getHours(), now.getMinutes(), now.getSeconds(),
  ))

  const todayDay = wallClockNow.getUTCDay()
  const todaySun = new Date(wallClockNow)
  todaySun.setUTCDate(wallClockNow.getUTCDate() - todayDay)
  todaySun.setUTCHours(0, 0, 0, 0)
  const isCurrentWeek = weekStart.getTime() === todaySun.getTime()

  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [overlayCursor, setOverlayCursor] = useState<string>('crosshair')
  const [hoveredBookingId, setHoveredBookingId] = useState<string | null>(null)

  /**
   * Which day the narrow layout is showing, remembered against the week it was
   * chosen in (issue #125).
   *
   * Paired with its week rather than reset by an effect: stepping to another
   * week should go back to the default day, and deriving that during render
   * avoids a setState-in-effect and the extra paint that comes with it.
   */
  const [daySelection, setDaySelection] = useState<{ week: number; day: number } | null>(null)

  // ── Lanes: one per space in the All spaces view, otherwise just one ─────────
  // A single space is the one-lane case of the same logic, so it behaves exactly
  // as it did: the server has already filtered bookings and blackouts to it.
  const laneSpaces = useMemo(() => (spaces && spaces.length > 1 ? spaces : null), [spaces])
  const laneCount = laneSpaces?.length ?? 1
  const lanes = useMemo(() => Array.from({ length: laneCount }, (_, i) => i), [laneCount])

  // ── Day header labels ────────────────────────────────────────────────────────
  const dayLabels = useMemo(() => {
    return DAYS.map((name, i) => {
      const d = new Date(weekStart)
      d.setUTCDate(weekStart.getUTCDate() + i)
      const month = d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' })
      const day = d.getUTCDate()
      const isToday = isCurrentWeek && i === todayDay
      return { name, month, day, isToday }
    })
  }, [weekStart, isCurrentWeek, todayDay])

  /*
    ── One day at a time on a narrow screen (issue #125) ──────────────────────
    Seven days times one lane per space is 21 columns, and at phone width that
    left each about 17px -- not a layout to tune, a layout with no phone form.
    Narrow screens show a single day instead, keeping every space side by side,
    because "which room is free at 3pm" is the question this view exists to
    answer and it cannot be answered one room at a time.

    Done entirely in CSS, with all seven days still rendered and all but one
    hidden. Measuring the viewport in JS would mean either a server render that
    is wrong for half the visitors and corrects itself after hydration, or no
    server render at all; this way the markup is right at every width on the
    first paint.

    Single-space weeks are untouched at every width. Seven columns of one lane
    are what that view has always been, and they are fine.
  */
  const dayAtATime = laneSpaces !== null

  /**
   * Where the week stops fitting, which depends on how many lanes a day carries.
   *
   * The calendar never gets the whole viewport: the shell's sidebar takes 224px
   * from `md` up and <main> adds 64px of padding, so at a 1280px window the grid
   * is about 934px -- roughly 133px per day, which three spaces divide into 44px
   * each. The same window with five spaces gives 27px, and 1024px with three
   * gives 32px, which is the crushing this issue is about rather than a fix for
   * it. So the switch moves outward as lanes are added.
   *
   * Spelled as whole literal class names, never interpolated, because Tailwind
   * finds classes by scanning the source for exactly these strings.
   */
  const narrowVariant =
    laneCount <= 2
      ? { hide: 'max-lg:hidden', edge: 'max-lg:border-r-0', picker: 'lg:hidden' }
      : laneCount === 3
        ? { hide: 'max-xl:hidden', edge: 'max-xl:border-r-0', picker: 'xl:hidden' }
        : { hide: 'max-2xl:hidden', edge: 'max-2xl:border-r-0', picker: '2xl:hidden' }

  const selectedDay = daySelection?.week === weekStart.getTime()
    ? daySelection.day
    // Opening on today is right far more often than opening on Sunday, and on
    // any other week there is no better guess than the start of it.
    : (isCurrentWeek ? todayDay : 0)

  /**
   * Hides every day column but the selected one while the week does not fit; a
   * no-op for a single space. Only the grid needs this -- the header row above
   * it is dropped whole.
   */
  const dayVisibilityCls = (dayIdx: number) =>
    !dayAtATime ? '' : dayIdx === selectedDay
      // The one visible column sits against the container's own border here, so
      // its divider would draw a line just inside the rounded edge.
      ? narrowVariant.edge
      : narrowVariant.hide

  // ── Booking spans per day ────────────────────────────────────────────────────
  interface BookingSpan { booking: Booking; startSlot: number; endSlot: number; lane: number }
  const bookingsByDay: BookingSpan[][] = useMemo(() => {
    const days: BookingSpan[][] = Array.from({ length: 7 }, () => [])
    for (const b of bookings) {
      const lane = laneSpaces ? laneSpaces.findIndex(s => s.id === b.space_id) : 0
      if (lane < 0) continue
      const dayIdx = dayOfWeekUTC(b.start_time)
      const rawEndSlot = slotIndex(b.end_time)
      // Booking ending at next-day midnight has slotIndex 0 — fill to end of column instead
      const endsNextDayMidnight = rawEndSlot === 0 && b.end_time.slice(0, 10) > b.start_time.slice(0, 10)
      const endSlot = endsNextDayMidnight ? TOTAL_SLOTS : rawEndSlot
      days[dayIdx].push({ booking: b, startSlot: slotIndex(b.start_time), endSlot, lane })
    }
    return days
  }, [bookings, laneSpaces])

  // ── Blackout spans per day and lane (multi-day blackouts clipped per column, overlaps merged) ──
  // A blackout with no space covers every lane.
  const blackoutsByDay: { startSlot: number; endSlot: number }[][][] = useMemo(() => {
    const days: { startSlot: number; endSlot: number }[][][] =
      Array.from({ length: 7 }, () => Array.from({ length: laneCount }, () => []))
    for (const bl of blackouts) {
      const blLanes = !laneSpaces || bl.space_id === null
        ? lanes
        : [laneSpaces.findIndex(s => s.id === bl.space_id)].filter(l => l >= 0)
      const blStart = new Date(bl.start_time)
      const blEnd = new Date(bl.end_time)
      for (let dayIdx = 0; dayIdx < 7; dayIdx++) {
        const dayStart = new Date(weekStart)
        dayStart.setUTCDate(weekStart.getUTCDate() + dayIdx)
        dayStart.setUTCHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart)
        dayEnd.setUTCDate(dayStart.getUTCDate() + 1)
        if (blStart >= dayEnd || blEnd <= dayStart) continue
        const effStart = blStart > dayStart ? blStart : dayStart
        const effEnd = blEnd < dayEnd ? blEnd : dayEnd
        const startSlot = effStart.getUTCHours() * 4 + Math.floor(effStart.getUTCMinutes() / 15)
        const rawEndSlot = effEnd.getUTCHours() * 4 + Math.floor(effEnd.getUTCMinutes() / 15)
        const endSlot = rawEndSlot === 0 ? TOTAL_SLOTS : rawEndSlot
        for (const lane of blLanes) days[dayIdx][lane].push({ startSlot, endSlot })
      }
    }
    return days.map(dayLanes => dayLanes.map(spans => {
      if (spans.length <= 1) return spans
      spans.sort((a, b) => a.startSlot - b.startSlot)
      const merged: { startSlot: number; endSlot: number }[] = [{ ...spans[0] }]
      for (let i = 1; i < spans.length; i++) {
        const last = merged[merged.length - 1]
        if (spans[i].startSlot <= last.endSlot) {
          last.endSlot = Math.max(last.endSlot, spans[i].endSlot)
        } else {
          merged.push({ ...spans[i] })
        }
      }
      return merged
    }))
  }, [blackouts, weekStart, laneSpaces, laneCount, lanes])

  // ── Advance notice zone: end slot per day up to (now + minHoursAdvance) ──────
  const noticeZoneEndSlots: number[] = useMemo(() => {
    const cutoff = new Date(wallClockNow.getTime() + minHoursAdvance * 60 * 60 * 1000)
    return Array.from({ length: 7 }, (_, dayIdx) => {
      const dayStart = new Date(weekStart)
      dayStart.setUTCDate(weekStart.getUTCDate() + dayIdx)
      dayStart.setUTCHours(0, 0, 0, 0)
      const dayEnd = new Date(dayStart)
      dayEnd.setUTCDate(dayStart.getUTCDate() + 1)
      if (cutoff <= dayStart) return 0          // entire day is past the cutoff
      if (cutoff >= dayEnd) return TOTAL_SLOTS  // entire day is within the window
      return cutoff.getUTCHours() * 4 + Math.floor(cutoff.getUTCMinutes() / 15)
    })
  }, [now, minHoursAdvance, weekStart])

  // Pixel-precise position of the current time within today's column
  const todayLineTopPx = (wallClockNow.getUTCHours() * 60 + wallClockNow.getUTCMinutes()) / 15 * SLOT_HEIGHT

  // ── Slot state helpers ───────────────────────────────────────────────────────
  const isSlotInNoticeZone = useCallback((dayIdx: number, slot: number): boolean => {
    return slot < noticeZoneEndSlots[dayIdx]
  }, [noticeZoneEndSlots])

  /** Whether one space has nothing -- no booking, no blackout -- at this slot. */
  const isLaneFree = useCallback((dayIdx: number, lane: number, slot: number): boolean => {
    if (blackoutsByDay[dayIdx][lane].some(bl => slot >= bl.startSlot && slot < bl.endSlot)) return false
    return !bookingsByDay[dayIdx].some(bs => bs.lane === lane && slot >= bs.startSlot && slot < bs.endSlot)
  }, [blackoutsByDay, bookingsByDay])

  /** Whether a new booking could start at this slot in at least one space. */
  const isSlotOpen = useCallback((dayIdx: number, slot: number): boolean => {
    if (isDeadZone(slot) || isSlotInNoticeZone(dayIdx, slot)) return false
    return lanes.some(lane => isLaneFree(dayIdx, lane, slot))
  }, [isSlotInNoticeZone, isLaneFree, lanes])

  const slotFromClientY = useCallback((clientY: number): number => {
    if (!scrollRef.current) return 0
    const rect = scrollRef.current.getBoundingClientRect()
    const headerHeight = headerRef.current?.offsetHeight ?? 0
    const y = clientY - rect.top - headerHeight + scrollRef.current.scrollTop
    return Math.max(0, Math.min(TOTAL_SLOTS - 1, Math.floor(y / SLOT_HEIGHT)))
  }, [])

  /** Which lane of the column the pointer is over. Always 0 for a single space. */
  const laneFromEvent = useCallback((e: React.MouseEvent): number => {
    if (laneCount === 1) return 0
    const rect = e.currentTarget.getBoundingClientRect()
    const lane = Math.floor(((e.clientX - rect.left) / rect.width) * laneCount)
    return Math.max(0, Math.min(laneCount - 1, lane))
  }, [laneCount])

  /**
   * The booking under the pointer that a click would open, if any: yours to
   * edit, or anyone else's to view (issue #142). Either way it opens rather than
   * starting a new booking. A click on an empty lane beside it still books.
   */
  const openableBookingAt = useCallback((dayIdx: number, lane: number, slot: number) => {
    const hit = bookingsByDay[dayIdx].find(
      bs => bs.lane === lane && slot >= bs.startSlot && slot < bs.endSlot
    )
    if (!hit) return undefined
    const isOwn = !!currentUserId && hit.booking.creator_id === currentUserId
    if (isOwn ? !onBookingClick : !onViewBooking) return undefined
    return { span: hit, isOwn }
  }, [bookingsByDay, currentUserId, onBookingClick, onViewBooking])

  // ── Mouse interaction ────────────────────────────────────────────────────────
  const handleOverlayMouseMove = useCallback((e: React.MouseEvent, dayIdx: number) => {
    const slot = slotFromClientY(e.clientY)
    // Your own booking is reachable first, before the blocked and notice-zone
    // guards. Those guards are about claiming *new* time, and opening a booking
    // you already hold claims nothing -- it is how you shorten or cancel it
    // (issue #94). Deciding this here rather than in the guards keeps a blackout
    // or the notice window from swallowing the click on a booking sitting inside
    // it, which is what made such a booking impossible to touch at all.
    const hit = openableBookingAt(dayIdx, laneFromEvent(e), slot)
    if (hit) {
      setOverlayCursor('pointer')
      setHoveredBookingId(hit.span.booking.id)
    } else if (!canBook || !isSlotOpen(dayIdx, slot)) {
      setOverlayCursor('default')
      setHoveredBookingId(null)
    } else {
      setOverlayCursor('crosshair')
      setHoveredBookingId(null)
    }
  }, [canBook, slotFromClientY, isSlotOpen, openableBookingAt, laneFromEvent])

  /**
   * How far a selection from `startSlot` can run toward `rawEnd`: as far as the
   * space that stays free longest allows. With one space that is simply up to
   * the next booking, blackout or closed hour.
   */
  const clampEndSlot = useCallback((dayIdx: number, startSlot: number, rawEnd: number): number => {
    const target = Math.min(Math.max(startSlot + 1, rawEnd), TOTAL_SLOTS)
    let best = startSlot + 1
    for (const lane of lanes) {
      if (!isLaneFree(dayIdx, lane, startSlot)) continue
      let end = startSlot + 1
      while (end < target && !isDeadZone(end) && !isSlotInNoticeZone(dayIdx, end) && isLaneFree(dayIdx, lane, end)) end++
      best = Math.max(best, end)
    }
    return best
  }, [lanes, isLaneFree, isSlotInNoticeZone])

  /** The spaces free for every slot of [startSlot, endSlot). */
  const freeSpaceIdsFor = useCallback((dayIdx: number, startSlot: number, endSlot: number): string[] => {
    if (!laneSpaces) return []
    return lanes
      .filter(lane => {
        for (let s = startSlot; s < endSlot; s++) if (!isLaneFree(dayIdx, lane, s)) return false
        return true
      })
      .map(lane => laneSpaces[lane].id)
  }, [laneSpaces, lanes, isLaneFree])

  const handleColumnMouseDown = useCallback((e: React.MouseEvent, dayIdx: number) => {
    e.preventDefault()
    const slot = slotFromClientY(e.clientY)
    // Same order as the hover handler above: a booking opens even inside the
    // notice window (issue #94), and even for someone who cannot book, since
    // viewing one claims no time (issue #142).
    const hit = openableBookingAt(dayIdx, laneFromEvent(e), slot)
    if (hit) {
      if (hit.isOwn) onBookingClick!(hit.span.booking)
      else onViewBooking!(hit.span.booking)
      return
    }
    if (!isSlotOpen(dayIdx, slot)) return
    if (!canBook) return
    dragRef.current = { dayIdx, startSlot: slot, currentSlot: slot }
    setDragPreview({ dayIdx, startSlot: slot, endSlot: clampEndSlot(dayIdx, slot, slot + CLICK_SLOTS) })
  }, [canBook, slotFromClientY, isSlotOpen, onBookingClick, onViewBooking, openableBookingAt, laneFromEvent, clampEndSlot])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const { dayIdx, startSlot } = dragRef.current
      const slot = slotFromClientY(e.clientY)
      dragRef.current.currentSlot = slot
      const endSlot = clampEndSlot(dayIdx, startSlot, rawEndFor(startSlot, slot))
      setDragPreview({ dayIdx, startSlot, endSlot })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragRef.current) return
      const { dayIdx, startSlot } = dragRef.current
      const slot = slotFromClientY(e.clientY)
      const endSlot = clampEndSlot(dayIdx, startSlot, rawEndFor(startSlot, slot))
      dragRef.current = null
      setDragPreview(null)
      const start = slotToIso(weekStart, dayIdx, startSlot)
      const end = slotToIso(weekStart, dayIdx, endSlot)
      onSlotClick(start, end, freeSpaceIdsFor(dayIdx, startSlot, endSlot))
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [weekStart, onSlotClick, slotFromClientY, clampEndSlot, freeSpaceIdsFor])

  const totalHeight = TOTAL_SLOTS * SLOT_HEIGHT

  /** Horizontal placement of something drawn in one lane of a day column. */
  const laneStyle = (lane: number) => ({
    left: `${(lane / laneCount) * 100}%`,
    width: `${100 / laneCount}%`,
  })

  return (
    /*
      Fills whatever height the page gives it rather than the 648px it used to be
      pinned to (issue #70). A week is 96 quarter-hour slots -- 1344px of grid --
      so the box was always scrolling internally, and on a normal laptop it did
      that while leaving the bottom half of the page empty.

      h-full takes the height the parent hands down; min-h-0 is what actually
      lets it shrink, since a flex item defaults to min-height:auto and would
      otherwise refuse to go below its 1344px content and push the box off the
      bottom of the screen instead.
    */
    <div className="rounded-xl border border-[#1e5080] overflow-hidden bg-[#0a1628] select-none isolate flex flex-col h-full min-h-0">
      {/* Which colour, and which lane of each day, is which space */}
      {laneSpaces && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 border-b border-[#1e5080] flex-shrink-0">
          {laneSpaces.map((s, i) => (
            <div key={s.id} className="flex items-center gap-1.5 text-xs text-[#93b8d8]">
              <span className="w-2.5 h-2.5 rounded-sm flex-shrink-0" style={{ backgroundColor: LANE_COLORS[i % LANE_COLORS.length] }} />
              {s.name}
            </div>
          ))}
          <span className="text-xs text-[#6a96bb] sm:ml-auto">Left to right in each day</span>
        </div>
      )}

      {/*
        The day picker for the narrow layout. Only rendered for the all-spaces
        view, and only shown at the widths where the grid is down to one day.

        Seven buttons across a 375px phone is ~47px each, which clears the 44px
        tap target the rest of the app is built to.
      */}
      {dayAtATime && (
        <div className={`${narrowVariant.picker} flex gap-1 px-2 py-2 border-b border-[#1e5080] flex-shrink-0`}>
          {dayLabels.map((dl, i) => {
            const isSelected = i === selectedDay
            return (
              <button
                key={i}
                type="button"
                onClick={() => setDaySelection({ week: weekStart.getTime(), day: i })}
                aria-pressed={isSelected}
                aria-label={`${dl.name} ${dl.month} ${dl.day}`}
                className={`flex-1 min-w-0 rounded-lg py-1.5 transition-colors ${
                  isSelected ? 'bg-[#c8102e]' : 'hover:bg-white/5'
                }`}
              >
                <span className={`block text-[10px] leading-none ${isSelected ? 'text-white/80' : 'text-[#93b8d8]'}`}>
                  {dl.name}
                </span>
                <span className={`block text-xs font-semibold leading-none mt-0.5 ${
                  isSelected ? 'text-white' : dl.isToday ? 'text-[#c8102e]' : 'text-[#f0f6ff]'
                }`}>
                  {dl.day}
                </span>
              </button>
            )
          })}
        </div>
      )}

      <div ref={scrollRef} className="overflow-y-auto flex-1 min-h-0">
        {/*
          Sticky day header. Dropped in the narrow all-spaces layout: with one
          day on screen it would spend ~100px of a phone's height repeating what
          the picker above already says, and the picker sits outside the scroll
          area so it stays visible without needing to be sticky at all.

          slotFromClientY reads this element's offsetHeight, which is 0 once it
          is display:none, so the slot maths follows without being told.
        */}
        <div
          ref={headerRef}
          className={`flex border-b border-[#1e5080] sticky top-0 z-[60] bg-[#0a1628] ${
            dayAtATime ? narrowVariant.hide : ''
          }`}
        >
          <div className="w-14 flex-shrink-0 border-r border-[#1e5080]" />
          {dayLabels.map((dl, i) => (
            <div
              key={i}
              className={`flex-1 min-w-0 text-center py-2 text-xs font-medium border-r border-[#1e5080] last:border-r-0 ${
                dl.isToday ? 'text-[#c8102e]' : 'text-[#93b8d8]'
              }`}
            >
              <div>{dl.name}</div>
              <div className={`text-sm font-semibold ${dl.isToday ? 'text-[#c8102e]' : 'text-[#f0f6ff]'}`}>
                {dl.month} {dl.day}
              </div>
            </div>
          ))}
        </div>

        <div className="flex" style={{ height: totalHeight }}>
          {/* Time labels column */}
          <div className="w-14 flex-shrink-0 border-r border-[#1e5080] relative">
            {Array.from({ length: TOTAL_SLOTS }, (_, slot) => {
              if (slot % 4 !== 0) return null
              return (
                <div
                  key={slot}
                  className="absolute right-1 text-[10px] text-[#93b8d8] leading-none"
                  style={{ top: Math.max(2, slot * SLOT_HEIGHT - 5) }}
                >
                  {slotToLabel(slot)}
                </div>
              )
            })}
          </div>

          {/* Day columns */}
          {Array.from({ length: 7 }, (_, dayIdx) => {
            const noticeEndSlot = noticeZoneEndSlots[dayIdx]
            const isToday = isCurrentWeek && dayIdx === todayDay

            return (
              <div
                key={dayIdx}
                className={`flex-1 min-w-0 border-r border-[#1e5080] last:border-r-0 relative ${dayVisibilityCls(dayIdx)}`}
                style={{ height: totalHeight }}
              >
                {/* Hour grid lines */}
                {Array.from({ length: TOTAL_SLOTS }, (_, slot) => (
                  <div
                    key={slot}
                    className={`absolute inset-x-0 border-t ${
                      slot % 4 === 0 ? 'border-[#1e5080]' : 'border-white/5'
                    }`}
                    style={{ top: slot * SLOT_HEIGHT, height: SLOT_HEIGHT }}
                  />
                ))}

                {/* Lane dividers (All spaces view) */}
                {lanes.slice(1).map(lane => (
                  <div
                    key={lane}
                    className="absolute inset-y-0 border-l border-dashed border-white/10 pointer-events-none"
                    style={{ left: `${(lane / laneCount) * 100}%` }}
                  />
                ))}

                {/* Advance notice zone — darkened band */}
                {noticeEndSlot > 0 && (
                  <div
                    className="absolute inset-x-0 bg-black/[0.18] z-10 pointer-events-none"
                    style={{ top: 0, height: noticeEndSlot * SLOT_HEIGHT }}
                  />
                )}

                {/* Dead zone band */}
                <div
                  className="absolute inset-x-0 bg-[#c8102e]/8 z-10 pointer-events-none"
                  style={{
                    top: DEAD_ZONE_START * SLOT_HEIGHT,
                    height: (DEAD_ZONE_END - DEAD_ZONE_START) * SLOT_HEIGHT,
                  }}
                >
                  <div className="flex items-center justify-center h-full">
                    <span className="text-[9px] text-[#c8102e]/60 font-medium tracking-wide">CSC Closed</span>
                  </div>
                </div>

                {/* Blackout overlays */}
                {blackoutsByDay[dayIdx].flatMap((laneSpans, lane) => laneSpans.map((bl, i) => (
                  <div
                    key={`${lane}-${i}`}
                    className="absolute z-20 pointer-events-none"
                    style={{
                      ...laneStyle(lane),
                      top: bl.startSlot * SLOT_HEIGHT,
                      height: (bl.endSlot - bl.startSlot) * SLOT_HEIGHT,
                    }}
                  >
                    <div
                      className="h-full mx-0.5 rounded bg-[#1e5080]/60 border border-[#1e5080] flex items-start px-1 pt-0.5 overflow-hidden"
                      style={{ backgroundImage: 'repeating-linear-gradient(135deg, transparent, transparent 3px, rgba(30,80,128,0.3) 3px, rgba(30,80,128,0.3) 6px)' }}
                    >
                      <span className="text-[8px] text-[#93b8d8] font-medium truncate">Blocked</span>
                    </div>
                  </div>
                )))}

                {/* Booking overlays */}
                {bookingsByDay[dayIdx].map((bs, i) => {
                  const { titleLines, showCreator } = blockLines(bs.endSlot - bs.startSlot, !!bs.booking.creator_name)
                  const color = LANE_COLORS[bs.lane % LANE_COLORS.length]
                  const hovered = hoveredBookingId === bs.booking.id
                  return (
                    <div
                      key={i}
                      className="absolute z-30 pointer-events-none"
                      style={{
                        ...laneStyle(bs.lane),
                        top: bs.startSlot * SLOT_HEIGHT,
                        height: (bs.endSlot - bs.startSlot) * SLOT_HEIGHT,
                      }}
                      title={laneSpaces ? `${bs.booking.title} · ${laneSpaces[bs.lane].name}` : bs.booking.title}
                    >
                      <div
                        className={`h-full mx-0.5 rounded border flex flex-col items-stretch px-1 pt-0.5 overflow-hidden transition-opacity ${
                          hovered ? 'opacity-80' : ''
                        }`}
                        style={{ borderColor: color, backgroundColor: `${color}${hovered ? '99' : 'cc'}` }}
                      >
                        {/*
                          Wraps, and clamps at however many lines the block has
                          room for. overflow-wrap: anywhere so a long word still
                          breaks in a narrow All spaces lane rather than being cut.
                        */}
                        <span
                          className="text-[9px] text-white font-semibold min-w-0"
                          style={{
                            lineHeight: `${BLOCK_LINE_PX}px`,
                            display: '-webkit-box',
                            WebkitBoxOrient: 'vertical',
                            WebkitLineClamp: titleLines,
                            overflow: 'hidden',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {/* Marks one week of a recurring booking (#112, #173). */}
                          {bs.booking.series_id && (
                            <span
                              aria-label={repeatsLabel(bs.booking.series_frequency)}
                              title={repeatsLabel(bs.booking.series_frequency)}
                            >↻ </span>
                          )}
                          {bs.booking.title}
                        </span>
                        {showCreator && (
                          <span className="text-[8px] text-white/70 truncate flex-shrink-0" style={{ lineHeight: `${BLOCK_LINE_PX}px` }}>
                            {bs.booking.creator_name}
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}

                {/* Current time line — only on today's column */}
                {isToday && (
                  <div
                    className="absolute inset-x-0 z-35 pointer-events-none"
                    style={{ top: todayLineTopPx }}
                  >
                    <div className="relative flex items-center">
                      <div className="w-2 h-2 rounded-full bg-[#c8102e] flex-shrink-0 -translate-y-px" />
                      <div className="flex-1 h-px bg-[#c8102e]" />
                    </div>
                  </div>
                )}

                {/* Drag selection preview */}
                {canBook && dragPreview && dragPreview.dayIdx === dayIdx && (
                  <div
                    className="absolute inset-x-0 z-40 pointer-events-none"
                    style={{
                      top: dragPreview.startSlot * SLOT_HEIGHT,
                      height: (dragPreview.endSlot - dragPreview.startSlot) * SLOT_HEIGHT,
                    }}
                  >
                    <div className="h-full mx-0.5 rounded bg-[#c8102e]/25 border border-[#c8102e]/70 border-dashed flex items-start px-1 pt-0.5 overflow-hidden">
                      <span className="text-[9px] text-[#c8102e] font-semibold">
                        {slotToLabel(dragPreview.startSlot)} – {slotToLabel(dragPreview.endSlot)}
                      </span>
                    </div>
                  </div>
                )}

                {/* Drag capture overlay */}
                <div
                  className="absolute inset-0 z-20"
                  style={{ cursor: overlayCursor }}
                  onMouseMove={e => handleOverlayMouseMove(e, dayIdx)}
                  onMouseLeave={() => { setOverlayCursor(canBook ? 'crosshair' : 'default'); setHoveredBookingId(null) }}
                  onMouseDown={e => handleColumnMouseDown(e, dayIdx)}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
