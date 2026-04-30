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

export default function SpaceCalendar({ weekStart, bookings, blackouts, currentUserId, onSlotClick, onBookingClick }: SpaceCalendarProps) {
  const today = new Date()
  const todayDay = today.getUTCDay()
  const todaySun = new Date(today)
  todaySun.setUTCDate(today.getUTCDate() - todayDay)
  todaySun.setUTCHours(0, 0, 0, 0)
  const isCurrentWeek = weekStart.getTime() === todaySun.getTime()

  const scrollRef = useRef<HTMLDivElement>(null)
  const headerRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragState | null>(null)
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null)
  const [overlayCursor, setOverlayCursor] = useState<string>('crosshair')
  const [hoveredBookingId, setHoveredBookingId] = useState<string | null>(null)

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

  interface BookingSpan { booking: Booking; startSlot: number; endSlot: number }
  const bookingsByDay: BookingSpan[][] = useMemo(() => {
    const days: BookingSpan[][] = Array.from({ length: 7 }, () => [])
    for (const b of bookings) {
      const dayIdx = dayOfWeekUTC(b.start_time)
      days[dayIdx].push({ booking: b, startSlot: slotIndex(b.start_time), endSlot: slotIndex(b.end_time) })
    }
    return days
  }, [bookings])

  interface BlackoutSpan { blackout: Blackout; startSlot: number; endSlot: number }
  const blackoutsByDay: BlackoutSpan[][] = useMemo(() => {
    const days: BlackoutSpan[][] = Array.from({ length: 7 }, () => [])
    for (const bl of blackouts) {
      const blStart = new Date(bl.start_time)
      const blEnd = new Date(bl.end_time)
      // Clip the blackout to each day of the current week it overlaps
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
        const endSlot = rawEndSlot === 0 ? TOTAL_SLOTS : rawEndSlot // midnight → fill to end of column
        days[dayIdx].push({ blackout: bl, startSlot, endSlot })
      }
    }
    return days
  }, [blackouts, weekStart])

  const isSlotBlocked = useCallback((dayIdx: number, slot: number): boolean => {
    if (slot >= DEAD_ZONE_START && slot < DEAD_ZONE_END) return true
    return blackoutsByDay[dayIdx].some(bl => slot >= bl.startSlot && slot < bl.endSlot)
  }, [blackoutsByDay])

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

  const handleOverlayMouseMove = useCallback((e: React.MouseEvent, dayIdx: number) => {
    const slot = slotFromClientY(e.clientY)
    if (isSlotBlocked(dayIdx, slot)) {
      setOverlayCursor('default')
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
  }, [slotFromClientY, isSlotBlocked, isSlotBooked, bookingsByDay, currentUserId])

  const handleColumnMouseDown = useCallback((e: React.MouseEvent, dayIdx: number) => {
    e.preventDefault()
    const slot = slotFromClientY(e.clientY)
    if (isSlotBlocked(dayIdx, slot)) return
    // If clicking an owned booking, open the edit modal instead of dragging
    if (isSlotBooked(dayIdx, slot)) {
      if (currentUserId && onBookingClick) {
        const hit = bookingsByDay[dayIdx].find(bs => slot >= bs.startSlot && slot < bs.endSlot)
        if (hit && hit.booking.creator_id === currentUserId) {
          onBookingClick(hit.booking)
        }
      }
      return
    }
    dragRef.current = { dayIdx, startSlot: slot, currentSlot: slot }
    setDragPreview({ dayIdx, startSlot: slot, endSlot: slot + 1 })
  }, [slotFromClientY, isSlotBlocked, isSlotBooked, currentUserId, onBookingClick, bookingsByDay])

  // Clamp endSlot so drag preview stops before blocked/booked slots
  const clampEndSlot = useCallback((dayIdx: number, startSlot: number, rawEnd: number): number => {
    let end = Math.max(startSlot + 1, rawEnd)
    // Don't extend into dead zone from above (dead zone is slots 0-27, so stop at 28 minimum)
    for (let s = startSlot + 1; s < end; s++) {
      if (isSlotBlocked(dayIdx, s) || isSlotBooked(dayIdx, s)) {
        end = s
        break
      }
    }
    return Math.min(end, TOTAL_SLOTS)
  }, [isSlotBlocked, isSlotBooked])

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
      {/* Scroll container wraps both header and body so scrollbar width is shared */}
      <div ref={scrollRef} className="overflow-y-auto" style={{ maxHeight: '648px' }}>
        {/* Sticky day header — inside the scroll container so its width matches the body */}
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
          {Array.from({ length: 7 }, (_, dayIdx) => (
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
              {bookingsByDay[dayIdx].map((bs, i) => (
                <div
                  key={i}
                  className="absolute inset-x-0 z-30 pointer-events-none"
                  style={{
                    top: bs.startSlot * SLOT_HEIGHT,
                    height: (bs.endSlot - bs.startSlot) * SLOT_HEIGHT,
                  }}
                >
                  <div className={`h-full mx-0.5 rounded border border-[#c8102e] flex flex-col px-1 pt-0.5 overflow-hidden transition-opacity ${hoveredBookingId === bs.booking.id ? 'bg-[#c8102e]/60 opacity-80' : 'bg-[#c8102e]/80'}`}>
                    <span className="text-[9px] text-white font-semibold truncate leading-tight">{bs.booking.title}</span>
                    {bs.booking.creator_name && (
                      <span className="text-[8px] text-white/70 truncate leading-tight">{bs.booking.creator_name}</span>
                    )}
                  </div>
                </div>
              ))}

              {/* Drag selection preview */}
              {dragPreview && dragPreview.dayIdx === dayIdx && (
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

              {/* Drag capture overlay — full-column, topmost, handles all mouse events */}
              <div
                className="absolute inset-0 z-50"
                style={{ cursor: overlayCursor }}
                onMouseMove={e => handleOverlayMouseMove(e, dayIdx)}
                onMouseLeave={() => { setOverlayCursor('crosshair'); setHoveredBookingId(null) }}
                onMouseDown={e => handleColumnMouseDown(e, dayIdx)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
