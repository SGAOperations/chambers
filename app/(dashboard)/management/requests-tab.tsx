'use client'

import { useEffect, useState } from 'react'
import FulfillModal from './fulfill-modal'

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
  bodies: { name: string } | null
  users: { full_name: string } | null
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
  const [updating, setUpdating] = useState<string | null>(null)
  const [confirmingDenial, setConfirmingDenial] = useState<string | null>(null)
  const [fulfillingRequest, setFulfillingRequest] = useState<{
  id: string
  type: string
  purpose: string
  body_id: string
} | null>(null)

  const fetchRequests = async () => {
    const [reqRes, revRes] = await Promise.all([
      fetch('/api/management/requests'),
      fetch('/api/management/revisions'),
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

  const updateStatus = async (id: string, status: RequestStatus) => {
    setUpdating(id)
    await fetch('/api/management/requests', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status }),
    })
    await fetchRequests()
    onCountChange()
    setUpdating(null)
  }

  if (loading) return <div className="text-[#93b8d8] text-sm">Loading...</div>

  if (requests.length === 0 && revisions.length === 0) return <div className="text-[#6a96bb] text-sm">No requests found.</div>

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
          {revisions.length > 0 && <h3 className="text-xs font-semibold uppercase tracking-widest text-[#6a96bb]">Room Requests</h3>}
          {requests.map(r => (
        <div key={r.id} className="border border-[#1e5080] rounded-xl p-5 bg-[#184073] shadow-sm space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold text-[#f0f6ff]">{r.bodies?.name || 'Unknown Body'}</span>
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
                  onClick={() => {
                    updateStatus(r.id, 'Denied')
                    setConfirmingDenial(null)
                  }}
                  disabled={updating === r.id}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
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
                  onClick={() => setFulfillingRequest({ id: r.id, type: r.type, purpose: r.purpose, body_id: r.body_id })}
                  disabled={updating === r.id}
                  className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  Fulfill
                </button>
                <button
                  onClick={() => setConfirmingDenial(r.id)}
                  disabled={updating === r.id}
                  className="px-3 py-1 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
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
    </div>
  )
}