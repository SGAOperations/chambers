'use client'

import { useEffect, useState } from 'react'
import FulfillModal from './fulfill-modal'

type RequestStatus = 'Pending' | 'Fulfilled' | 'Denied'

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
  Pending: 'bg-yellow-100 text-yellow-800',
  Fulfilled: 'bg-green-100 text-green-800',
  Denied: 'bg-red-100 text-red-800',
}

export default function RequestsTab() {
  const [requests, setRequests] = useState<RoomRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [fulfillingRequest, setFulfillingRequest] = useState<{
  id: string
  type: string
  purpose: string
  body_id: string
} | null>(null)

  const fetchRequests = async () => {
    const res = await fetch('/api/management/requests')
    const data = await res.json()
    setRequests(data.requests || [])
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
    setUpdating(null)
  }

  if (loading) return <div className="text-slate-500 text-sm">Loading...</div>

  if (requests.length === 0) return <div className="text-slate-400 text-sm">No requests found.</div>

  return (
    <div className="space-y-4">
      {requests.map(r => (
        <div key={r.id} className="border border-[#e2e8f0] rounded-xl p-5 bg-white shadow-sm space-y-3">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <span className="font-semibold text-[#0f172a]">{r.bodies?.name || 'Unknown Body'}</span>
              <span className="mx-2 text-slate-300">·</span>
              <span className="text-sm text-slate-500">{r.type}</span>
            </div>
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${statusColors[r.status]}`}>
              {r.status}
            </span>
          </div>

          {/* Details */}
          <div className="text-sm text-slate-600 space-y-1">
            <p><span className="font-medium text-slate-700">Requested by:</span> {r.users?.full_name || 'Unknown'}</p>
            <p><span className="font-medium text-slate-700">Purpose:</span> {r.purpose}</p>

            {/* One-Time & Weekly details */}
            {r.room_request_details && r.room_request_details.length > 0 && (
              <div>
                {r.room_request_details[0].room_name && (
                  <p><span className="font-medium text-slate-700">Preferred Room:</span> {r.room_request_details[0].room_name}</p>
                )}
                <p><span className="font-medium text-slate-700">Date:</span> {formatDate(r.room_request_details[0].start_date)}</p>
                <p><span className="font-medium text-slate-700">Time:</span> {formatTime(r.room_request_details[0].start_time)} – {formatTime(r.room_request_details[0].end_time)}</p>
                {r.room_request_details[0].end_date && (
                  <p><span className="font-medium text-slate-700">Until:</span> {formatDate(r.room_request_details[0].end_date)}</p>
                )}
              </div>
            )}

            {/* Tabling sessions */}
            {r.tabling_request_sessions && r.tabling_request_sessions.length > 0 && (
              <div>
                <p className="font-medium text-slate-700">Sessions:</p>
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
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setFulfillingRequest({ id: r.id, type: r.type, purpose: r.purpose, body_id: r.body_id })}
                disabled={updating === r.id}
                className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 disabled:opacity-50"
              >
                Fulfill
              </button>
              <button
                onClick={() => updateStatus(r.id, 'Denied')}
                disabled={updating === r.id}
                className="px-3 py-1.5 text-sm bg-[#c8102e] text-white rounded-lg hover:bg-[#a00d24] disabled:opacity-50 font-medium transition-colors"
              >
                Deny
              </button>
              {fulfillingRequest && (
                <FulfillModal
                    request={fulfillingRequest}
                    onClose={() => setFulfillingRequest(null)}
                    onSuccess={fetchRequests}
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}