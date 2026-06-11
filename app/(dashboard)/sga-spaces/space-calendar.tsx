'use client'

import { useMemo, useRef, useState, useEffect, useCallback } from 'react'

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

interface SpaceCalendarProps {
  weekStart: Date // Sunday 00:00 UTC
  bookings: Booking[]
  blackouts: Blackout[]
  currentUserId?: string
  minHoursAdvance?: number
  canBook?: boolean
  onSlotClick: (startIso: string, endIso: string) => void
  onBookingClick?: (booking: Booking) => void
}

// Total slots: 24 hours * 4 slots/hour = 96
const TOTAL_SLOTS = 96
const SLOT_HEIGHT = 14 // px per 15-min slot
const DEAD_ZONE_START = 0  // slot index 0 = 00:00
const DEAD_ZONE_END = 28   // slot index 28 = 07:00 (7 * 4)

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
  onSlotClick,
  onBookingClick,
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

  // ── Booking spans per day ────────────────────────────────────────────────────
  interface BookingSpan { booking: Booking; startSlot: number; endSlot: number }
  const bookingsByDay: BookingSpan[][] = useMemo(() => {
    const days: BookingSpan[][] = Array.from({ length: 7 }, () => [])
    for (const b of bookings) {
      const dayIdx = dayOfWeekUTC(b.start_time)
      const rawEndSlot = slotIndex(b.end_time)
      // Booking ending at next-day midnight has slotIndex 0 — fill to end of column instead
      const endsNextDayMidnight = rawEndSlot === 0 && b.end_time.slice(0, 10) > b.start_time.slice(0, 10)
      const endSlot = endsNextDayMidnight ? TOTAL_SLOTS : rawEndSlot
      days[dayIdx].push({ booking: b, startSlot: slotIndex(b.start_time), endSlot })
    }
    return days
  }, [bookings])

  // ── Blackout spans per day (multi-day blackouts clipped per column, overlaps merged) ───────────
  const blackoutsByDay: { startSlot: number; endSlot: number }[][] = useMemo(() => {
    const days: { startSlot: number; endSlot: number }[][] = Array.from({ length: 7 }, () => [])
    for (const bl of blackouts) {
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
        days[dayIdx].push({ startSlot, endSlot })
      }
    }
    return days.map(spans => {
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
    })
  }, [blackouts, weekStart])

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
  const isSlotBlocked = useCallback((dayIdx: number, slot: number): boolean => {
    if (slot >= DEAD_ZONE_START && slot < DEAD_ZONE_END) return true
    return blackoutsByDay[dayIdx].some(bl => slot >= bl.startSlot && slot < bl.endSlot)
  }, [blackoutsByDay])

  const isSlotInNoticeZone = useCallback((dayIdx: number, slot: number): boolean => {
    return slot < noticeZoneEndSlots[dayIdx]
  }, [noticeZoneEndSlots])

  const isSlotBooked = useCallback((dayIdx: number, slot: number): boolean => {
    return bookingsByDay[dayIdx].some(bs => slot >= bs.startSlot && bs.endSlot > slot)
  }, [bookingsByDay])

  const slotFromClientY = useCallback((clientY: number): number => {
    if (!scrollRef.current) return 0
    const rect = scrollRef.current.getBoundingClientRect()
    const headerHeight = headerRef.current?.offsetHeight ?? 0
    const y = clientY - rect.top - headerHeight + scrollRef.current.scrollTop
    return Math.max(0, Math.min(TOTAL_SLOTS - 1, Math.floor(y / SLOT_HEIGHT)))
  }, [])

  // ── Mouse interaction ────────────────────────────────────────────────────────
  const handleOverlayMouseMove = useCallback((e: React.MouseEvent, dayIdx: number) => {
    if (!canBook) {
      setOverlayCursor('default')
      return
    }
    const slot = slotFromClientY(e.clientY)
    if (isSlotBlocked(dayIdx, slot) || isSlotInNoticeZone(dayIdx, slot)) {
      setOverlayCursor('default')
      setHoveredBookingId(null)
    } else if (isSlotBooked(dayIdx, slot)) {
      const hit = bookingsByDay[dayIdx].find(bs => slot >= bs.startSlot && slot < bs.endSlot)
      if (hit && hit.booking.creator_id === currentUserId) {
        setOverlayCursor('pointer')
        setHoveredBookingId(hit.booking.id)
      } else {
        setOverlayCursor('default')
        setHoveredBookingId(null)
      }
    } else {
      setOverlayCursor('crosshair')
      setHoveredBookingId(null)
    }
  }, [canBook, slotFromClientY, isSlotBlocked, isSlotInNoticeZone, isSlotBooked, bookingsByDay, currentUserId])

  const handleColumnMouseDown = useCallback((e: React.MouseEvent, dayIdx: number) => {
    e.preventDefault()
    const slot = slotFromClientY(e.clientY)
    if (isSlotBlocked(dayIdx, slot) || isSlotInNoticeZone(dayIdx, slot)) return
    if (isSlotBooked(dayIdx, slot)) {
      if (currentUserId && onBookingClick) {
        const hit = bookingsByDay[dayIdx].find(bs => slot >= bs.startSlot && slot < bs.endSlot)
        if (hit && hit.booking.creator_id === currentUserId) onBookingClick(hit.booking)
      }
      return
    }
    if (!canBook) return
    dragRef.current = { dayIdx, startSlot: slot, currentSlot: slot }
    setDragPreview({ dayIdx, startSlot: slot, endSlot: slot + 1 })
  }, [canBook, slotFromClientY, isSlotBlocked, isSlotInNoticeZone, isSlotBooked, currentUserId, onBookingClick, bookingsByDay])

  const clampEndSlot = useCallback((dayIdx: number, startSlot: number, rawEnd: number): number => {
    let end = Math.max(startSlot + 1, rawEnd)
    for (let s = startSlot + 1; s < end; s++) {
      if (isSlotBlocked(dayIdx, s) || isSlotInNoticeZone(dayIdx, s) || isSlotBooked(dayIdx, s)) {
        end = s
        break
      }
    }
    return Math.min(end, TOTAL_SLOTS)
  }, [isSlotBlocked, isSlotInNoticeZone, isSlotBooked])

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return
      const { dayIdx, startSlot } = dragRef.current
      const slot = slotFromClientY(e.clientY)
      dragRef.current.currentSlot = slot
      const endSlot = clampEndSlot(dayIdx, startSlot, slot + 1)
      setDragPreview({ dayIdx, startSlot, endSlot })
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (!dragRef.current) return
      const { dayIdx, startSlot } = dragRef.current
      const slot = slotFromClientY(e.clientY)
      const endSlot = clampEndSlot(dayIdx, startSlot, slot + 1)
      dragRef.current = null
      setDragPreview(null)
      const start = slotToIso(weekStart, dayIdx, startSlot)
      const end = slotToIso(weekStart, dayIdx, endSlot)
      onSlotClick(start, end)
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
    }
  }, [weekStart, onSlotClick, slotFromClientY, clampEndSlot])

  const totalHeight = TOTAL_SLOTS * SLOT_HEIGHT

  return (
    <div className="rounded-xl border border-[#1e5080] overflow-hidden bg-[#0a1628] select-none">
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '648px' }}>
        {/* Sticky day header */}
        <div ref={headerRef} className="flex border-b border-[#1e5080] sticky top-0 z-50 bg-[#0a1628]">
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
                className="flex-1 min-w-0 border-r border-[#1e5080] last:border-r-0 relative"
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
                {blackoutsByDay[dayIdx].map((bl, i) => (
                  <div
                    key={i}
                    className="absolute inset-x-0 z-20 pointer-events-none"
                    style={{
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
                ))}

                {/* Booking overlays */}
                {bookingsByDay[dayIdx].map((bs, i) => {
                  const isShort = (bs.endSlot - bs.startSlot) <= 2
                  return (
                    <div
                      key={i}
                      className="absolute inset-x-0 z-30 pointer-events-none"
                      style={{
                        top: bs.startSlot * SLOT_HEIGHT,
                        height: (bs.endSlot - bs.startSlot) * SLOT_HEIGHT,
                      }}
                    >
                      <div className={`h-full mx-0.5 rounded border border-[#c8102e] flex px-1 overflow-hidden transition-opacity ${
                        isShort ? 'flex-row items-center gap-1' : 'flex-col items-start pt-0.5'
                      } ${hoveredBookingId === bs.booking.id ? 'bg-[#c8102e]/60 opacity-80' : 'bg-[#c8102e]/80'}`}>
                        <span className="text-[9px] text-white font-semibold truncate leading-none min-w-0">{bs.booking.title}</span>
                        {bs.booking.creator_name && (
                          <span className={`text-[8px] text-white/70 leading-none ${isShort ? 'flex-shrink-0 truncate' : 'truncate w-full'}`}>
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
                  className="absolute inset-0 z-50"
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
