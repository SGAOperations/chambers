'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'

interface BookingOption {
  id: string
  label: string
}

interface AuditChange {
  label: string
  from: string
  to: string
}

interface AuditLogEntry {
  id: string
  new_status: string
  created_at: string
  /** Null on entries from before issue #120, which recorded a status and nothing else. */
  target: 'booking' | 'series' | 'occurrence' | 'session' | null
  target_date: string | null
  action: 'created' | 'updated' | 'added' | 'removed' | 'cancelled' | 'dismissed' | null
  changes: AuditChange[] | null
  users: { full_name: string; admin_role: string | null } | null
}

/**
 * Entries written by one save share a created_at (they go in as one insert), so
 * that plus the admin is what makes them one action on screen.
 */
interface AuditGroup {
  key: string
  created_at: string
  users: AuditLogEntry['users']
  entries: AuditLogEntry[]
}

function groupEntries(logs: AuditLogEntry[]): AuditGroup[] {
  const groups: AuditGroup[] = []
  for (const e of logs) {
    const key = `${e.created_at}|${e.users?.full_name ?? ''}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.entries.push(e)
    else groups.push({ key, created_at: e.created_at, users: e.users, entries: [e] })
  }
  return groups
}

/** What an entry is about, in words. */
function targetLabel(e: AuditLogEntry): string {
  switch (e.target) {
    case 'series': return 'Whole series'
    case 'occurrence': return e.target_date ? `Week of ${formatDate(e.target_date)}` : 'One week'
    case 'session': return e.target_date ? `Session on ${formatDate(e.target_date)}` : 'One session'
    default: return 'Booking'
  }
}

const ACTION_LABELS: Record<NonNullable<AuditLogEntry['action']>, string> = {
  created: 'Created',
  updated: 'Changed',
  added: 'Added',
  removed: 'Removed',
  cancelled: 'Cancelled',
  dismissed: 'Cancellation dismissed',
}

function formatDate(date: string) {
  return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric'
  })
}

function formatTimestamp(ts: string) {
  return new Date(ts).toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  })
}

const statusColors: Record<string, string> = {
  'Reserved': 'bg-[#0f3d20] text-[#4ade80]',
  'Alternate Room': 'bg-[#0e2f4f] text-[#4285f4]',
  'Alternate Time': 'bg-[#0e2f4f] text-[#4285f4]',
  'Alternate Room and Time': 'bg-[#0e2f4f] text-[#4285f4]',
  'Waitlisted': 'bg-[#3d0f0f] text-[#f87171]',
  'Unavailable': 'bg-[#3d0f0f] text-[#f87171]',
  'Pending Cancellation': 'bg-[#3d2200] text-[#fb923c]',
  'Cancelled': 'bg-[#2a1042] text-[#c084fc]',
  'Virtual': 'bg-[#062f3b] text-[#22d3ee]',
  'Missed': 'bg-[#1a1a2e] text-[#a78bfa]',
  'Repurposed': 'bg-[#1a1a1a] text-white',
  'Tentative': 'bg-[#2d2800] text-[#fef08a]',
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
  if (role === 'Information Manager') {
    return (
      <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#fbbf24] text-[#451a03]">
        Info Manager
      </span>
    )
  }
  return null
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"

export default function AuditTab() {
  const [bookings, setBookings] = useState<BookingOption[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [logs, setLogs] = useState<AuditLogEntry[]>([])
  const [loadingLogs, setLoadingLogs] = useState(false)

  useEffect(() => {
    const fetchBookings = async () => {
      const res = await fetch('/api/administrator/bookings')
      const data = await res.json()

      const options: BookingOption[] = []

      for (const b of data.oneTime || []) {
        const detail = b.one_time_room_bookings?.[0]
        const date = detail?.booking_date ? formatDate(detail.booking_date) : '—'
        options.push({ id: b.id, label: `${b.bodies?.name ?? 'Unknown'} · One-Time · ${date}` })
      }

      for (const b of data.weekly || []) {
        const detail = b.weekly_room_bookings?.[0]
        const range = detail
          ? `${formatDate(detail.start_date)} – ${formatDate(detail.end_date)}`
          : '—'
        options.push({ id: b.id, label: `${b.bodies?.name ?? 'Unknown'} · Weekly · ${range}` })
      }

      for (const b of data.tabling || []) {
        const firstSession = b.tabling_bookings?.[0]?.tabling_sessions?.[0]
        const date = firstSession?.session_date ? formatDate(firstSession.session_date) : '—'
        options.push({ id: b.id, label: `${b.bodies?.name ?? 'Unknown'} · Tabling · ${date}` })
      }

      setBookings(options)
    }
    fetchBookings()
  }, [])

  useEffect(() => {
    if (!selectedId) {
      setLogs([])
      return
    }
    const fetchLogs = async () => {
      setLoadingLogs(true)
      const res = await fetch(`/api/administrator/audit-logs?booking_id=${selectedId}`)
      const data = await res.json()
      setLogs(data.logs || [])
      setLoadingLogs(false)
    }
    fetchLogs()
  }, [selectedId])

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[#93b8d8] mb-1">Select Booking</label>
        <select
          value={selectedId ?? ''}
          onChange={e => setSelectedId(e.target.value || null)}
          className={inputCls}
        >
          <option value="">— Select a booking —</option>
          {bookings.map(b => (
            <option key={b.id} value={b.id}>{b.label}</option>
          ))}
        </select>
      </div>

      {!selectedId && (
        <p className="text-[#6a96bb] text-sm">Select a booking to view its audit log.</p>
      )}

      {selectedId && loadingLogs && (
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <div key={i} className="border border-[#1e5080] rounded-xl px-5 py-4 bg-[#184073] flex items-center justify-between animate-pulse">
              <div className="space-y-1.5">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="h-3 w-24" />
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-5 w-20 rounded-full" />
                <Skeleton className="h-5 w-16 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      )}

      {selectedId && !loadingLogs && logs.length === 0 && (
        <p className="text-[#6a96bb] text-sm">No audit log entries for this booking.</p>
      )}

      {selectedId && !loadingLogs && logs.length > 0 && (
        <div className="space-y-3">
          {groupEntries(logs).map(group => (
            <div
              key={group.key}
              className="border border-[#1e5080] rounded-xl bg-[#184073] overflow-hidden"
            >
              <div className="px-5 py-3 flex items-center justify-between gap-3 flex-wrap border-b border-[#1e5080]">
                <div className="space-y-0.5">
                  <p className="text-sm font-semibold text-[#f0f6ff]">{group.users?.full_name ?? 'Unknown'}</p>
                  <p className="text-xs text-[#93b8d8]">{formatTimestamp(group.created_at)}</p>
                </div>
                <AdminRoleBadge role={group.users?.admin_role} />
              </div>

              <ul className="divide-y divide-[#1e5080]">
                {group.entries.map(entry => (
                  <li key={entry.id} className="px-5 py-3 space-y-1.5">
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <p className="text-sm text-[#f0f6ff]">
                        <span className="font-medium">{targetLabel(entry)}</span>
                        <span className="text-[#93b8d8]">
                          {' · '}
                          {entry.action ? ACTION_LABELS[entry.action] : 'Status set'}
                        </span>
                      </p>
                      <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[entry.new_status] ?? 'bg-[#0f2a4a] text-[#93b8d8]'}`}>
                        {entry.new_status}
                      </span>
                    </div>

                    {entry.changes && entry.changes.length > 0 && (
                      <dl className="text-xs grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
                        {entry.changes.map((c, i) => (
                          <div key={i} className="contents">
                            <dt className="text-[#93b8d8]">{c.label}</dt>
                            <dd className="text-[#f0f6ff] min-w-0 break-words">
                              <span className="text-[#6a96bb] line-through">{c.from}</span>
                              <span className="text-[#6a96bb]"> → </span>
                              {c.to}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    {entry.action === 'updated' && entry.changes?.length === 0 && (
                      <p className="text-xs text-[#6a96bb]">Saved with no changes.</p>
                    )}

                    {/*
                      Entries from before issue #120 recorded one status for the
                      booking as a whole, often taken from its first session, so
                      they are marked rather than presented as if they were as
                      specific as the entries around them.
                    */}
                    {!entry.target && (
                      <p className="text-xs text-[#6a96bb]">
                        Recorded before per-session detail: this is one status for the booking as a whole.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
