'use client'

import { useEffect, useState } from 'react'
import FulfillModal from './fulfill-modal'
import DenyModal from './deny-modal'
import { Skeleton } from '@/app/_components/skeleton'
import ScopeLabel from '@/app/_components/scope-label'
import type { BookingScope, Division } from '@/lib/booking-scope'

function RequestsTabSkeleton() {
  const card = (wide: boolean) => (
    <div className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] animate-pulse">
      <div className="flex items-center justify-between mb-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className={`h-5 rounded-full ${wide ? 'w-28' : 'w-16'}`} />
      </div>
      <div className="space-y-2">
        <Skeleton className="h-3.5 w-48" />
        <Skeleton className="h-3.5 w-56" />
        <Skeleton className="h-3.5 w-44" />
        {wide && <Skeleton className="h-3.5 w-52" />}
        <Skeleton className="h-3.5 w-36" />
      </div>
    </div>
  )
  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <Skeleton className="h-3 w-36 animate-pulse" />
        {[0, 1].map(i => <div key={i}>{card(true)}</div>)}
      </div>
      <div className="space-y-3">
        <Skeleton className="h-3 w-28 animate-pulse" />
        {[0, 1].map(i => <div key={i}>{card(false)}</div>)}
      </div>
    </div>
  )
}

type RequestStatus = 'Pending' | 'Fulfilled' | 'Denied'

interface RevisionRequest {
  id: string
  change_type: 'Time' | 'Room' | 'Both'
  new_start_time: string | null
  new_end_time: string | null
  new_room: string | null
  more_info: string
  created_at: string
  bookings: {
    id: string
    type: string
    purpose: string
    bodies: { name: string } | null
  } | null
  users: { full_name: string } | null
}

interface RoomRequest {
  id: string
  body_id: string
  type: 'One-Time Room' | 'Weekly Room' | 'Tabling'
  purpose: string
  status: RequestStatus
  notes: string | null
  created_at: string
  scope: BookingScope
  division: Division | null
  bodies: { name: string } | null
  users: { full_name: string } | null
  room_request_bodies: { body_id: string; bodies: { name: string } | null }[] | null
  room_request_details: {
    room_name: string | null
    start_date: string
    start_time: string
    end_time: string
    end_date: string | null
  }[] | null
  tabling_request_sessions: {
    session_date: string
    start_time: string
    end_time: string
  }[] | null
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

const statusColors: Record<RequestStatus, string> = {
  Pending: 'bg-[#3d2200] text-[#fb923c]',
  Fulfilled: 'bg-[#0f3d20] text-[#4ade80]',
  Denied: 'bg-[#3d0f0f] text-[#f87171]',
}

interface RequestsTabProps {
    onCountChange: () => void
}

export default function RequestsTab({ onCountChange }: RequestsTabProps) {
  const [requests, setRequests] = useState<RoomRequest[]>([])
  const [revisions, setRevisions] = useState<RevisionRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmingDenial, setConfirmingDenial] = useState<string | null>(null)
  const [denyingRequest, setDenyingRequest] = useState<string | null>(null)
  const [fulfillingRequest, setFulfillingRequest] = useState<{
  id: string
  type: string
  purpose: string
  body_id: string
  bodyName: string
  scope: BookingScope
  division: Division | null
  linkedBodies: { id: string; name: string }[]
} | null>(null)
  const [typeFilter, setTypeFilter] = useState<'all' | BookingScope>('all')

  const fetchRequests = async () => {
    const [reqRes, revRes] = await Promise.all([
      fetch('/api/administrator/requests'),
      fetch('/api/administrator/revisions'),
    ])
    const reqData = await reqRes.json()
    const revData = await revRes.json()
    setRequests(reqData.requests || [])
    setRevisions(revData.revisions || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchRequests()
  }, [])

  if (loading) return <RequestsTabSkeleton />

  if (requests.length === 0 && revisions.length === 0) return <div className="text-[#6a96bb] text-sm">No requests found.</div>

  const filteredRequests = requests.filter(r => typeFilter === 'all' || r.scope === typeFilter)

  const TYPE_FILTERS: { value: 'all' | BookingScope; label: string }[] = [
    { value: 'all', label: 'All' },
    { value: 'single', label: 'Single Body' },
    { value: 'divisional', label: 'Divisional' },
    { value: 'multi', label: 'Multi-Body' },
  ]

  return (
    <div className="space-y-6">
      {revisions.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-[#6a96bb]">Revision Requests</h3>
          {revisions.map(rv => (
            <div key={rv.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="font-semibold text-[#f0f6ff]">{rv.bookings?.bodies?.name || 'Unknown Body'}</span>
                  <span className="mx-2 text-[#1e5080]">·</span>
                  <span className="text-sm text-[#93b8d8]">{rv.bookings?.type === 'One-Time Room' ? 'One-Time/Multiple Room' : rv.bookings?.type}</span>
                </div>
                <span className="text-xs font-semibold px-2.5 py-1 rounded-full bg-[#0e2f4f] text-[#4285f4]">
                  Revision Request
                </span>
              </div>
              <div className="text-sm text-[#93b8d8] space-y-1">
                <p><span className="font-medium text-[#f0f6ff]">Requested by:</span> {rv.users?.full_name || 'Unknown'}</p>
                <p><span className="font-medium text-[#f0f6ff]">Purpose:</span> {rv.bookings?.purpose}</p>
                <p><span className="font-medium text-[#f0f6ff]">Requested change:</span> {rv.change_type === 'Both' ? 'Time and Room' : rv.change_type}</p>
                {(rv.change_type === 'Time' || rv.change_type === 'Both') && (rv.new_start_time || rv.new_end_time) && (
                  <p>
                    <span className="font-medium text-[#f0f6ff]">Requested time:</span>{' '}
                    {rv.new_start_time ? formatTime(rv.new_start_time) : '—'} – {rv.new_end_time ? formatTime(rv.new_end_time) : '—'}
                  </p>
                )}
                {(rv.change_type === 'Room' || rv.change_type === 'Both') && rv.new_room && (
                  <p><span className="font-medium text-[#f0f6ff]">Requested room:</span> {rv.new_room}</p>
                )}
                <p><span className="font-medium text-[#f0f6ff]">More info:</span> {rv.more_info}</p>
                <p><span className="font-medium text-[#f0f6ff]">Submitted:</span> {new Date(rv.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {requests.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            {revisions.length > 0 && (
              <h3 className="text-xs font-semibold uppercase tracking-widest text-[#6a96bb]">Room Requests</h3>
            )}
            <div className="flex gap-1 flex-wrap ml-auto">
              {TYPE_FILTERS.map(f => (
                <button
                  key={f.value}
                  onClick={() => setTypeFilter(f.value)}
                  className={`px-2.5 py-1 text-xs rounded-md font-medium transition-colors ${
                    typeFilter === f.value
                      ? 'bg-[#c8102e] text-white'
                      : 'bg-[#0f2a4a] border border-[#1e5080] text-[#93b8d8] hover:text-[#f0f6ff] hover:border-[#93b8d8]'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          {filteredRequests.length === 0 ? (
            <p className="text-sm text-[#6a96bb]">No requests match this filter.</p>
          ) : filteredRequests.map(r => (
        <div key={r.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <ScopeLabel
                row={r}
                linkedBodies={(r.room_request_bodies ?? []).map(x => ({ id: x.body_id, name: x.bodies?.name ?? '' }))}
                className="font-semibold text-[#f0f6ff]"
              />
              <span className="mx-2 text-[#1e5080]">·</span>
              <span className="text-sm text-[#93b8d8]">{r.type === 'One-Time Room' ? 'One-Time/Multiple Room' : r.type}</span>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[r.status]}`}>
              {r.status}
            </span>
          </div>

          {/* Details */}
          <div className="text-sm text-[#93b8d8] space-y-1">
            <p><span className="font-medium text-[#f0f6ff]">Requested by:</span> {r.users?.full_name || 'Unknown'}</p>
            <p><span className="font-medium text-[#f0f6ff]">Purpose:</span> {r.purpose}</p>

            {/* One-Time & Weekly details */}
            {r.room_request_details && r.room_request_details.length > 0 && (
              <div>
                <p className="font-medium text-[#f0f6ff]">Sessions:</p>
                <ul className="ml-4 space-y-0.5">
                  {r.room_request_details.map((d, i) => (
                    <li key={i}>
                      {d.room_name && <span>{d.room_name} · </span>}
                      {formatDate(d.start_date)} · {formatTime(d.start_time)} – {formatTime(d.end_time)}
                      {d.end_date && <span> → {formatDate(d.end_date)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Tabling sessions */}
            {r.tabling_request_sessions && r.tabling_request_sessions.length > 0 && (
              <div>
                <p className="font-medium text-[#f0f6ff]">Sessions:</p>
                <ul className="ml-4 space-y-0.5">
                  {r.tabling_request_sessions.map((s, i) => (
                    <li key={i}>{formatDate(s.session_date)} · {formatTime(s.start_time)} – {formatTime(s.end_time)}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          {/* Actions */}
          {r.status === 'Pending' && (
            confirmingDenial === r.id ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-[#93b8d8]">Are you sure?</span>
                <button
                  onClick={() => setDenyingRequest(r.id)}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Yes, Deny
                </button>
                <button
                  onClick={() => setConfirmingDenial(null)}
                  className="px-3 py-1 text-sm border border-[#1e5080] text-[#f0f6ff] rounded-lg hover:bg-[#1a4d8a]"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => setFulfillingRequest({
                    id: r.id,
                    type: r.type,
                    purpose: r.purpose,
                    body_id: r.body_id,
                    bodyName: r.bodies?.name ?? 'Unknown',
                    scope: r.scope,
                    division: r.division,
                    linkedBodies: (r.room_request_bodies ?? []).map(x => ({ id: x.body_id, name: x.bodies?.name ?? '' })),
                  })}
                  className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
                >
                  Fulfill
                </button>
                <button
                  onClick={() => setConfirmingDenial(r.id)}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
                >
                  Deny
                </button>
              </div>
            )
          )}
        </div>
      ))}
        </div>
      )}
      {fulfillingRequest && (
        <FulfillModal
          request={fulfillingRequest}
          onClose={() => setFulfillingRequest(null)}
          onSuccess={fetchRequests}
        />
      )}
      {denyingRequest && (
        <DenyModal
          requestId={denyingRequest}
          onClose={() => { setDenyingRequest(null); setConfirmingDenial(null) }}
          onDenied={() => { setDenyingRequest(null); setConfirmingDenial(null); fetchRequests(); onCountChange() }}
        />
      )}
    </div>
  )
}