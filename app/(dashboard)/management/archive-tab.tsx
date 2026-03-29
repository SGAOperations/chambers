'use client'

import { useEffect, useState } from 'react'

interface OneTimeBooking {
  id: string
  body_id: string
  purpose: string
  bodies: { name: string } | null
  creator_role: string | null
  one_time_room_bookings: {
    id: string
    room_name: string
    booking_date: string
    start_time: string
    end_time: string
    status: string
    reservation_code: string | null
  }[] | null
}

interface WeeklyBooking {
  id: string
  body_id: string
  purpose: string
  bodies: { name: string } | null
  creator_role: string | null
  weekly_room_bookings: {
    id: string
    room_name: string
    start_date: string
    end_date: string
    start_time: string
    end_time: string
    status: string
    reservation_code: string | null
    weekly_room_occurrences: {
      id: string
      occurrence_date: string
      room_name: string | null
      start_time: string | null
      end_time: string | null
      status: string | null
      reservation_code: string | null
      senate_type: string | null
    }[]
  }[] | null
}

interface TablingBooking {
  id: string
  body_id: string
  purpose: string
  bodies: { name: string } | null
  creator_role: string | null
  tabling_bookings: {
    id: string
    reservation_code: string | null
    tabling_sessions: {
      location: string
      session_date: string
      start_time: string
      end_time: string
      status: string
      reservation_code: string | null
    }[]
  }[] | null
}

interface SemesterGroup {
  semester: { id: string; name: string; is_active: boolean; created_at: string }
  oneTime: OneTimeBooking[]
  weekly: WeeklyBooking[]
  tabling: TablingBooking[]
}

function formatTime(time: string) {
  const [h, m] = time.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

const statusColors: Record<string, string> = {
  'Reserved': 'bg-[#0f3d20] text-[#4ade80]',
  'Alternate Room': 'bg-[#0e2f4f] text-[#4285f4]',
  'Alternate Time': 'bg-[#0e2f4f] text-[#4285f4]',
  'Waitlisted': 'bg-[#3d0f0f] text-[#f87171]',
  'Unavailable': 'bg-[#3d0f0f] text-[#f87171]',
  'Pending Cancellation': 'bg-[#3d2200] text-[#fb923c]',
  'Cancelled': 'bg-[#2a1042] text-[#c084fc]',
  'Virtual': 'bg-[#062f3b] text-[#22d3ee]',
  'Missed': 'bg-[#1a1a2e] text-[#a78bfa]',
  'Repurposed': 'bg-[#1a1a1a] text-white',
}

function AdminRoleBadge({ role }: { role: string | null | undefined }) {
  if (role === 'Executive Vice President') {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#c084fc] text-[#3b0764]">
        Executive VP
      </span>
    )
  }
  if (role === 'Comptroller') {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#f87171] text-[#450a0a]">
        Comptroller
      </span>
    )
  }
  if (role === 'Vice President of Operational Affairs') {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#22d3ee] text-[#0c4a6e]">
        Vice President
      </span>
    )
  }
  return null
}

interface CsvRow {
  semester: string
  type: string
  body: string
  purpose: string
  roomOrLocation: string
  date: string
  endDate: string
  startTime: string
  endTime: string
  status: string
  reservationCode: string
}

function buildCsvRows(group: SemesterGroup): CsvRow[] {
  const rows: CsvRow[] = []
  const semName = group.semester.name

  for (const b of group.oneTime) {
    for (const d of b.one_time_room_bookings || []) {
      rows.push({
        semester: semName,
        type: 'One-Time Room',
        body: b.bodies?.name || '',
        purpose: b.purpose,
        roomOrLocation: d.room_name || '',
        date: d.booking_date,
        endDate: '',
        startTime: d.start_time,
        endTime: d.end_time,
        status: d.status,
        reservationCode: d.reservation_code || '',
      })
    }
  }

  for (const b of group.weekly) {
    const w = b.weekly_room_bookings?.[0]
    if (w) {
      rows.push({
        semester: semName,
        type: 'Weekly Room',
        body: b.bodies?.name || '',
        purpose: b.purpose,
        roomOrLocation: w.room_name || '',
        date: w.start_date,
        endDate: w.end_date,
        startTime: w.start_time,
        endTime: w.end_time,
        status: w.status,
        reservationCode: w.reservation_code || '',
      })
    }
  }

  for (const b of group.tabling) {
    const t = b.tabling_bookings?.[0]
    if (t) {
      for (const s of t.tabling_sessions || []) {
        rows.push({
          semester: semName,
          type: 'Tabling',
          body: b.bodies?.name || '',
          purpose: b.purpose,
          roomOrLocation: s.location,
          date: s.session_date,
          endDate: '',
          startTime: s.start_time,
          endTime: s.end_time,
          status: s.status,
          reservationCode: s.reservation_code || '',
        })
      }
    }
  }

  return rows
}

function exportCSV(rows: CsvRow[], filename: string) {
  const header = ['Semester', 'Type', 'Body', 'Purpose', 'Room/Location', 'Date', 'End Date', 'Start Time', 'End Time', 'Status', 'Reservation Code']
  const dataRows = rows.map(r => [
    r.semester, r.type, r.body, r.purpose, r.roomOrLocation,
    r.date, r.endDate, r.startTime, r.endTime, r.status, r.reservationCode,
  ])
  const csv = [header, ...dataRows]
    .map(row => row.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(','))
    .join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  a.download = filename
  a.click()
}

export default function ArchiveTab() {
  const [groups, setGroups] = useState<SemesterGroup[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/management/archive')
      .then(r => r.json())
      .then(data => {
        setGroups(data.groups || [])
        setLoading(false)
      })
  }, [])

  if (loading) return <div className="text-[#93b8d8] text-sm">Loading...</div>

  const allRows = groups.flatMap(buildCsvRows)

  return (
    <div className="space-y-6">
      {/* Global export */}
      <div className="flex justify-end">
        <button
          onClick={() => exportCSV(allRows, 'all-bookings.csv')}
          disabled={allRows.length === 0}
          className="px-4 py-2 bg-[#1e5080] hover:bg-[#2a6aaa] text-[#f0f6ff] text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          Export All as CSV
        </button>
      </div>

      {groups.length === 0 && (
        <p className="text-[#6a96bb] text-sm">No archived bookings found.</p>
      )}

      {groups.map(group => {
        const groupRows = buildCsvRows(group)
        const totalBookings = group.oneTime.length + group.weekly.length + group.tabling.length
        if (totalBookings === 0) return null

        return (
          <div key={group.semester.id} className="space-y-3">
            {/* Semester header */}
            <div className="flex items-center justify-between border-b border-[#1e5080] pb-2">
              <div className="flex items-center gap-2.5">
                <h3 className="text-base font-semibold text-[#f0f6ff]">{group.semester.name}</h3>
                {group.semester.is_active && (
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#0f3d20] text-[#4ade80]">Active</span>
                )}
              </div>
              <button
                onClick={() => exportCSV(groupRows, `${group.semester.name.replace(/\s+/g, '-').toLowerCase()}.csv`)}
                className="text-xs text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition-colors"
              >
                Export as CSV
              </button>
            </div>

            {/* One-Time Rooms */}
            {group.oneTime.filter(b => b.one_time_room_bookings?.length).map(b => {
              const firstSession = b.one_time_room_bookings![0]
              return (
                <div key={b.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-[#f0f6ff]">{b.bodies?.name}</p>
                      <p className="text-sm text-[#93b8d8]">{b.purpose}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="hidden md:inline"><AdminRoleBadge role={b.creator_role} /></span>
                      <span className={`hidden md:inline text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[firstSession.status] || 'bg-[#184073] text-[#93b8d8]'}`}>
                        {firstSession.status}
                      </span>
                      <span className="text-xs text-[#6a96bb] font-medium">One-Time Room</span>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[#93b8d8] space-y-1">
                    {b.one_time_room_bookings!.map((d, i) => (
                      <div key={i} className={b.one_time_room_bookings!.length > 1 ? 'border-t border-[#1e5080] pt-1 first:border-0 first:pt-0' : ''}>
                        {d.room_name && <p><span className="font-medium text-[#f0f6ff]">Room:</span> {d.room_name}</p>}
                        <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(d.booking_date)}</p>
                        <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(d.start_time)} – {formatTime(d.end_time)}</p>
                        {d.reservation_code && <p><span className="font-medium text-[#f0f6ff]">Code:</span> {d.reservation_code}</p>}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}

            {/* Weekly Rooms */}
            {group.weekly.filter(b => b.weekly_room_bookings?.length).map(b => {
              const w = b.weekly_room_bookings![0]
              return (
                <div key={b.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-[#f0f6ff]">{b.bodies?.name}</p>
                      <p className="text-sm text-[#93b8d8]">{b.purpose}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="hidden md:inline"><AdminRoleBadge role={b.creator_role} /></span>
                      <span className={`hidden md:inline text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[w.status] || 'bg-[#184073] text-[#93b8d8]'}`}>
                        {w.status}
                      </span>
                      <span className="text-xs text-[#6a96bb] font-medium">Weekly Room</span>
                    </div>
                  </div>
                  <div className="mt-3 text-sm text-[#93b8d8] space-y-0.5">
                    <p><span className="font-medium text-[#f0f6ff]">Room:</span> {w.room_name}</p>
                    <p><span className="font-medium text-[#f0f6ff]">Dates:</span> {formatDate(w.start_date)} – {formatDate(w.end_date)}</p>
                    <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(w.start_time)} – {formatTime(w.end_time)}</p>
                    {w.reservation_code && <p><span className="font-medium text-[#f0f6ff]">Code:</span> {w.reservation_code}</p>}
                  </div>
                </div>
              )
            })}

            {/* Tabling */}
            {group.tabling.filter(b => b.tabling_bookings?.length).map(b => {
              const t = b.tabling_bookings![0]
              return (
                <div key={b.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-semibold text-[#f0f6ff]">{b.bodies?.name}</p>
                    <div className="flex items-center gap-3">
                      <span className="hidden md:inline"><AdminRoleBadge role={b.creator_role} /></span>
                      <span className="text-xs text-[#6a96bb] font-medium">Tabling</span>
                    </div>
                  </div>
                  <p className="text-sm text-[#93b8d8] mb-3">{b.purpose}</p>
                  <div className="space-y-2">
                    {t.tabling_sessions.map((s, i) => (
                      <div key={i} className="flex items-center gap-3 text-sm text-[#93b8d8] bg-[#0f2a4a] rounded-lg px-3 py-2">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColors[s.status] || 'bg-[#184073] text-[#93b8d8]'}`}>
                          {s.status}
                        </span>
                        <span>{s.location}</span>
                        <span>{formatDate(s.session_date)}</span>
                        <span>{formatTime(s.start_time)} – {formatTime(s.end_time)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
