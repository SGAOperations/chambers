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

export default function TimePicker({ value, onChange, interval = 5 }: TimePickerProps) {
  const minutes = Array.from({ length: 60 / interval }, (_, i) => i * interval)
  const { hour, minute, period } = from24Hour(value)

  const update = (newHour: number, newMinute: number, newPeriod: 'AM' | 'PM') => {
    onChange(to24Hour(newHour, newMinute, newPeriod))
  }

  return (
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

    <select
      value={period}
      onChange={e => update(hour, minute, e.target.value as 'AM' | 'PM')}
      className={inputCls}
    >
      <option value="AM">AM</option>
      <option value="PM">PM</option>
    </select>
  </div>
  )
}