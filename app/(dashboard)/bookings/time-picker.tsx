'use client'

const inputCls = "bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-2 py-2.5 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition w-full min-w-0"

const hours = Array.from({ length: 12 }, (_, i) => i + 1)

interface TimePickerProps {
  value: string // HH:MM in 24hr format
  onChange: (value: string) => void
  interval?: 5 | 15
}

function to24Hour(hour: number, minute: number, period: 'AM' | 'PM'): string {
  let h = hour
  if (period === 'AM' && hour === 12) h = 0
  if (period === 'PM' && hour !== 12) h = hour + 12
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function from24Hour(value: string): { hour: number; minute: number; period: 'AM' | 'PM' } {
  if (!value) return { hour: 12, minute: 0, period: 'AM' }
  const [h, m] = value.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  const hour = h % 12 || 12
  return { hour, minute: m, period }
}

/**
 * Hour + minute selects on top, AM/PM as a sliding segmented toggle underneath (issue #24 --
 * three selects side by side was the thing overflowing when two TimePickers sat next to each
 * other in a Start Time / End Time row on mobile). Applies on every breakpoint, not just
 * mobile, per request: it reads better as a toggle than a third dropdown regardless of screen
 * size.
 */
export default function TimePicker({ value, onChange, interval = 5 }: TimePickerProps) {
  const minutes = Array.from({ length: 60 / interval }, (_, i) => i * interval)
  const { hour, minute, period } = from24Hour(value)

  const update = (newHour: number, newMinute: number, newPeriod: 'AM' | 'PM') => {
    onChange(to24Hour(newHour, newMinute, newPeriod))
  }

  return (
    <div className="w-full min-w-0 space-y-1">
      <div className="flex gap-1 min-w-0">
        <select
          value={hour}
          onChange={e => update(Number(e.target.value), minute, period)}
          className={inputCls}
        >
          {hours.map(h => (
            <option key={h} value={h}>{h}</option>
          ))}
        </select>

        <select
          value={minute}
          onChange={e => update(hour, Number(e.target.value), period)}
          className={inputCls}
        >
          {minutes.map(m => (
            <option key={m} value={m}>{String(m).padStart(2, '0')}</option>
          ))}
        </select>
      </div>

      {/* Symmetric 2px gaps on both edges and in the middle: with a 2px inset on each side and
          a 2px gap between the two halves, each half is (container - 3*2px) / 2 wide, i.e.
          50% - 3px; translating by its own width (100%) plus the 2px middle gap lands the AM
          half's left edge exactly where the PM half belongs. */}
      <div className="relative flex w-full h-8 rounded-lg border border-[#1e5080] bg-[#0f2a4a] p-0.5">
        <div
          aria-hidden
          className={`absolute inset-y-0.5 left-0.5 w-[calc(50%-3px)] rounded-md bg-[#4285f4] transition-transform duration-200 ease-out ${
            period === 'PM' ? 'translate-x-[calc(100%+2px)]' : 'translate-x-0'
          }`}
        />
        <button
          type="button"
          onClick={() => update(hour, minute, 'AM')}
          aria-pressed={period === 'AM'}
          className={`relative z-10 flex-1 text-xs font-semibold rounded-md transition-colors ${
            period === 'AM' ? 'text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
          }`}
        >
          AM
        </button>
        <button
          type="button"
          onClick={() => update(hour, minute, 'PM')}
          aria-pressed={period === 'PM'}
          className={`relative z-10 flex-1 text-xs font-semibold rounded-md transition-colors ${
            period === 'PM' ? 'text-white' : 'text-[#93b8d8] hover:text-[#f0f6ff]'
          }`}
        >
          PM
        </button>
      </div>
    </div>
  )
}
