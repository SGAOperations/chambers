'use client'

import { useMemo, useState } from 'react'
import {
  type FlatBooking,
  statusBarColors,
  statusTextColors,
  formatTime,
} from './shared'

interface CalendarViewProps {
  bookings: FlatBooking[]
  onSelect: (booking: FlatBooking) => void
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MAX_VISIBLE_PER_DAY = 3

function toDateKey(year: number, month: number, day: number) {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function todayKey() {
  const now = new Date()
  return toDateKey(now.getFullYear(), now.getMonth(), now.getDate())
}

export default function CalendarView({ bookings, onSelect }: CalendarViewProps) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date()
    return { year: now.getFullYear(), month: now.getMonth() }
  })
  const [selectedDate, setSelectedDate] = useState<string | null>(null)

  const byDate = useMemo(() => {
    const map = new Map<string, FlatBooking[]>()
    for (const b of bookings) {
      if (!map.has(b.date)) map.set(b.date, [])
      map.get(b.date)!.push(b)
    }
    return map
  }, [bookings])

  const cells = useMemo(() => {
    const { year, month } = cursor
    const firstOfMonth = new Date(year, month, 1)
    const startOffset = firstOfMonth.getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const total = Math.ceil((startOffset + daysInMonth) / 7) * 7
    return Array.from({ length: total }, (_, i) => {
      const day = i - startOffset + 1
      if (day < 1 || day > daysInMonth) return null
      return { day, dateKey: toDateKey(year, month, day) }
    })
  }, [cursor])

  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString('en-US', {
    month: 'long', year: 'numeric',
  })

  const goToMonth = (delta: number) => {
    setCursor(prev => {
      const d = new Date(prev.year, prev.month + delta, 1)
      return { year: d.getFullYear(), month: d.getMonth() }
    })
    setSelectedDate(null)
  }

  const goToToday = () => {
    const now = new Date()
    setCursor({ year: now.getFullYear(), month: now.getMonth() })
    setSelectedDate(todayKey())
  }

  const selectedBookings = selectedDate ? byDate.get(selectedDate) ?? [] : []

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => goToMonth(-1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#1e5080] text-[#93b8d8] hover:border-[#6a96bb] bg-[#184073]"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            onClick={() => goToMonth(1)}
            className="w-8 h-8 flex items-center justify-center rounded-lg border border-[#1e5080] text-[#93b8d8] hover:border-[#6a96bb] bg-[#184073]"
            aria-label="Next month"
          >
            ›
          </button>
          <h3 className="text-lg font-semibold text-[#f0f6ff] ml-1">{monthLabel}</h3>
        </div>
        <button
          onClick={goToToday}
          className="px-3 py-1.5 rounded-lg text-sm font-medium border border-[#1e5080] text-[#93b8d8] hover:border-[#6a96bb] bg-[#184073]"
        >
          Today
        </button>
      </div>

      <div className="grid grid-cols-7 gap-px bg-[#1e5080] border border-[#1e5080] rounded-xl overflow-hidden">
        {WEEKDAY_LABELS.map(label => (
          <div key={label} className="bg-[#0e2f4f] text-center text-[10px] font-semibold uppercase tracking-widest text-[#6a96bb] py-2">
            {label}
          </div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={i} className="bg-[#122a45] min-h-[92px]" />
          const dayBookings = byDate.get(cell.dateKey) ?? []
          const isToday = cell.dateKey === todayKey()
          const isSelected = cell.dateKey === selectedDate
          return (
            <button
              key={i}
              onClick={() => setSelectedDate(cell.dateKey)}
              className={`min-h-[92px] p-1.5 text-left bg-[#184073] hover:bg-[#1a4d8a] transition-colors flex flex-col gap-1 ${isSelected ? 'ring-2 ring-inset ring-[#4285f4]' : ''}`}
            >
              <span className={`text-xs font-medium ${isToday ? 'inline-flex items-center justify-center w-5 h-5 rounded-full bg-[#c8102e] text-white' : 'text-[#93b8d8]'}`}>
                {cell.day}
              </span>
              <div className="flex-1 space-y-0.5 overflow-hidden">
                {dayBookings.slice(0, MAX_VISIBLE_PER_DAY).map(b => (
                  <div key={b.id} className="flex items-center gap-1 text-[10px] text-[#f0f6ff] truncate">
                    <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${statusBarColors[b.status] || 'bg-[#1e5080]'}`} />
                    <span className="truncate">{b.scopeLabel}</span>
                  </div>
                ))}
                {dayBookings.length > MAX_VISIBLE_PER_DAY && (
                  <p className="text-[10px] text-[#6a96bb]">+{dayBookings.length - MAX_VISIBLE_PER_DAY} more</p>
                )}
              </div>
            </button>
          )
        })}
      </div>

      {selectedDate && (
        <div className="mt-4">
          <h3 className="text-sm font-semibold text-[#93b8d8] uppercase tracking-wider mb-2">
            {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </h3>
          {selectedBookings.length === 0 ? (
            <p className="text-[#6a96bb] text-sm">No bookings on this day.</p>
          ) : (
            <div className="divide-y divide-[#1e5080] border border-[#1e5080] rounded-xl overflow-hidden bg-[#184073]">
              {selectedBookings.map(b => (
                <div key={b.id} onClick={() => onSelect(b)} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[#1a4d8a] transition-colors cursor-pointer">
                  <div className={`w-1.5 h-8 rounded-full flex-shrink-0 ${statusBarColors[b.status] || 'bg-[#1e5080]'}`} />
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-[#f0f6ff] truncate">{b.scopeLabel}</p>
                    <p className="text-sm text-[#6a96bb]">{b.location} · {formatTime(b.startTime)} – {formatTime(b.endTime)}</p>
                  </div>
                  <span className={`hidden md:inline text-xs font-semibold flex-shrink-0 ${statusTextColors[b.status] || 'text-[#93b8d8]'}`}>{b.status}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
