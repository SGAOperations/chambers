'use client'

interface WeeklyOccurrence {
  id: string
  occurrence_date: string
  room_name: string | null
  start_time: string | null
  end_time: string | null
  status: string | null
  reservation_code: string | null
  senate_type: string | null
}

interface WeeklyBooking {
  id: string
  body_id: string
  purpose: string
  bodies: { name: string } | null
  users: { admin_role: string | null } | null
  weekly_room_bookings: {
    id: string
    room_name: string
    start_date: string
    end_date: string
    start_time: string
    end_time: string
    status: string
    reservation_code: string | null
    weekly_room_occurrences: WeeklyOccurrence[]
  }[] | null
}

interface WeeklyBookingGridProps {
  bookings: WeeklyBooking[]
  onBookingClick: (booking: WeeklyBooking) => void
}


function getMondayKey(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00')
  const day = d.getDay()
  const diff = day === 0 ? -6 : 1 - day
  d.setDate(d.getDate() + diff)
  return d.toISOString().slice(0, 10)
}

const statusCellHex: Record<string, string> = {
  'Reserved': '#4ade80',
  'Alternate Room': '#4285f4',
  'Alternate Time': '#4285f4',
  'Waitlisted': '#f87171',
  'Unavailable': '#f87171',
  'Pending Cancellation': '#fb923c',
  'Cancelled': '#c084fc',
  'Virtual': '#22d3ee',
  'Missed': '#a78bfa',
  'Repurposed': '#ffffff',
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

export default function WeeklyBookingGrid({ bookings, onBookingClick }: WeeklyBookingGridProps) {
  const active = bookings
    .filter(b => b.weekly_room_bookings?.[0]?.status !== 'Cancelled')
    .sort((a, b) => {
      const wa = a.weekly_room_bookings?.[0]
      const wb = b.weekly_room_bookings?.[0]
      if (!wa || !wb) return 0
      const dayA = (new Date(wa.start_date + 'T00:00:00').getDay() + 6) % 7
      const dayB = (new Date(wb.start_date + 'T00:00:00').getDay() + 6) % 7
      if (dayA !== dayB) return dayA - dayB
      return wa.start_time.localeCompare(wb.start_time)
    })

  if (active.length === 0) return null

  const weekSet = new Set<string>()
  active.forEach(b => {
    b.weekly_room_bookings?.[0]?.weekly_room_occurrences?.forEach(o => {
      weekSet.add(getMondayKey(o.occurrence_date))
    })
  })
  const todayMonday = getMondayKey(new Date().toISOString().slice(0, 10))
  const weeks = Array.from(weekSet).sort().filter(wk => wk >= todayMonday)

  if (weeks.length === 0) return null

  return (
    <div className="border border-[#1e5080] rounded-xl p-4 bg-[#0f2a4a]">
      <p className="text-xs font-semibold text-[#93b8d8] mb-3 uppercase tracking-wide">Occurrence Overview</p>
      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-1 text-xs">
          <thead>
            <tr>
              <th className="text-left text-[#6a96bb] font-medium pr-4 pb-1 whitespace-nowrap">Booking</th>
              {weeks.map(wk => (
                <th key={wk} className="text-[#6a96bb] font-medium pb-1 min-w-[28px]">
                  {new Date(wk + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {active.map(b => {
              const w = b.weekly_room_bookings![0]
              const occMap = new Map<string, WeeklyOccurrence>()
              w.weekly_room_occurrences?.forEach(o => occMap.set(getMondayKey(o.occurrence_date), o))
              return (
                <tr key={b.id}>
                  <td className="pr-4 text-[#93b8d8] whitespace-nowrap py-0.5">
                    {b.bodies?.name} — {formatTime(w.start_time)}
                  </td>
                  {weeks.map(wk => {
                    const occ = occMap.get(wk)
                    if (!occ) return <td key={wk} />
                    const hex = statusCellHex[occ.status ?? w.status] ?? '#1e3a5f'
                    return (
                      <td key={wk} className="py-0.5">
                        <button
                          onClick={() => onBookingClick(b)}
                          title={`${occ.occurrence_date}: ${occ.status ?? w.status}`}
                          style={{ backgroundColor: hex }}
                          className="w-10 h-5 rounded hover:opacity-70 transition-opacity block"
                        />
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
