'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'

function BodiesTabSkeleton() {
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Skeleton className="h-9 w-24 rounded-lg animate-pulse" />
      </div>
      <div className="border border-[#1e5080] rounded-xl overflow-hidden bg-[#184073] animate-pulse">
        {[0, 1, 2, 3].map(i => (
          <div key={i} className={`flex items-center justify-between p-4 ${i !== 0 ? 'border-t border-[#1e5080]' : ''}`}>
            <div className="space-y-1.5">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-3.5 w-28" />
            </div>
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

const DIVISIONS = [
  'Office of the President',
  'Academic Affairs',
  'Campus Affairs',
  'DEI',
  'Student Success',
  'Operational Affairs',
  'External Affairs',
  'Student Involvement',
  'Senate',
  'Non-Divisional',
]

interface Body {
  id: string
  name: string
  division: string
  is_active: boolean
  body_open: boolean
}

export default function BodiesTab() {
  const [bodies, setBodies] = useState<Body[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newBody, setNewBody] = useState({ name: '', division: '' })
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState({ name: '', division: '', is_active: true, body_open: false })

  const fetchBodies = async () => {
    const res = await fetch('/api/administrator/bodies')
    const data = await res.json()
    setBodies(data.bodies || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchBodies()
  }, [])

  const createBody = async () => {
    setCreating(true)
    await fetch('/api/administrator/bodies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newBody),
    })
    setNewBody({ name: '', division: '' })
    setShowCreateForm(false)
    await fetchBodies()
    setCreating(false)
  }

  const saveEdit = async (id: string) => {
    await fetch('/api/administrator/bodies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...editValues }),
    })
    setEditingId(null)
    await fetchBodies()
  }

  const startEdit = (body: Body) => {
    setEditingId(body.id)
    setEditValues({ name: body.name, division: body.division, is_active: body.is_active, body_open: body.body_open ?? false })
  }

  if (loading) return <BodiesTabSkeleton />

  const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"

  return (
    <div className="space-y-4">
      {/* Create button */}
      <div className="flex justify-end">
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors"
        >
          + New Body
        </button>
      </div>

      {/* Create form */}
      {showCreateForm && (
        <div className="border border-[#1e5080] rounded-xl p-5 bg-[#0f2a4a] space-y-3">
          <h3 className="font-semibold text-[#f0f6ff]">Create New Body</h3>
          <input
            type="text"
            placeholder="Body Name"
            value={newBody.name}
            onChange={e => setNewBody({ ...newBody, name: e.target.value })}
            className={inputCls}
          />
          <select
            value={newBody.division}
            onChange={e => setNewBody({ ...newBody, division: e.target.value })}
            className={inputCls}
          >
            <option value="">Select Division</option>
            {DIVISIONS.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              onClick={createBody}
              disabled={creating || !newBody.name || !newBody.division}
              className="px-4 py-2 bg-[#0a1628] hover:bg-[#0f2040] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
            <button
              onClick={() => setShowCreateForm(false)}
              className="px-4 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bodies list */}
      {bodies.length === 0 ? (
        <p className="text-[#6a96bb] text-sm">No bodies found.</p>
      ) : (
        <div className="border border-[#1e5080] rounded-xl overflow-hidden bg-[#184073]">
          {bodies.map((b, i) => (
            <div key={b.id} className={`p-4 ${i !== 0 ? 'border-t border-[#1e5080]' : ''}`}>
              {editingId === b.id ? (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={editValues.name}
                    onChange={e => setEditValues({ ...editValues, name: e.target.value })}
                    className={inputCls}
                  />
                  <select
                    value={editValues.division}
                    onChange={e => setEditValues({ ...editValues, division: e.target.value })}
                    className={inputCls}
                  >
                    {DIVISIONS.map(d => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editValues.is_active}
                      onChange={e => setEditValues({ ...editValues, is_active: e.target.checked })}
                      id={`active-${b.id}`}
                    />
                    <label htmlFor={`active-${b.id}`} className="text-sm text-[#f0f6ff]">Active</label>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={editValues.body_open}
                      onChange={e => setEditValues({ ...editValues, body_open: e.target.checked })}
                      id={`open-${b.id}`}
                    />
                    <label htmlFor={`open-${b.id}`} className="text-sm text-[#f0f6ff]">Open for self-signup</label>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveEdit(b.id)}
                      className="px-3 py-1.5 bg-[#0a1628] hover:bg-[#0f2040] text-white text-sm rounded-lg font-medium transition-colors"
                    >
                      Save
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-[#f0f6ff]">{b.name}</p>
                    <p className="text-sm text-[#93b8d8]">{b.division}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${b.is_active ? 'bg-[#0f3d20] text-[#4ade80]' : 'bg-[#3d0f0f] text-[#f87171]'}`}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${b.body_open ? 'bg-[#0f3d20] text-[#4ade80]' : 'bg-[#1e3a5f] text-[#93b8d8]'}`}>
                      {b.body_open ? 'Open' : 'Closed'}
                    </span>
                    <button
                      onClick={() => startEdit(b)}
                      className="text-sm text-[#93b8d8] hover:text-[#c8102e] font-medium transition-colors"
                    >
                      Edit
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}