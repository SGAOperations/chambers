'use client'

import { useEffect, useState } from 'react'

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
}

export default function BodiesTab() {
  const [bodies, setBodies] = useState<Body[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreateForm, setShowCreateForm] = useState(false)
  const [newBody, setNewBody] = useState({ name: '', division: '' })
  const [creating, setCreating] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState({ name: '', division: '', is_active: true })

  const fetchBodies = async () => {
    const res = await fetch('/api/management/bodies')
    const data = await res.json()
    setBodies(data.bodies || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchBodies()
  }, [])

  const createBody = async () => {
    setCreating(true)
    await fetch('/api/management/bodies', {
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
    await fetch('/api/management/bodies', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...editValues }),
    })
    setEditingId(null)
    await fetchBodies()
  }

  const startEdit = (body: Body) => {
    setEditingId(body.id)
    setEditValues({ name: body.name, division: body.division, is_active: body.is_active })
  }

  if (loading) return <div className="text-slate-500 text-sm">Loading...</div>

  const inputCls = "w-full border border-[#e2e8f0] rounded-lg px-3 py-2.5 text-sm text-[#0f172a] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/20 focus:border-[#c8102e] transition"

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
        <div className="border border-[#e2e8f0] rounded-xl p-5 bg-slate-50 space-y-3">
          <h3 className="font-semibold text-[#0f172a]">Create New Body</h3>
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
              className="px-4 py-2 border border-[#e2e8f0] text-slate-700 text-sm rounded-lg hover:bg-white transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Bodies list */}
      {bodies.length === 0 ? (
        <p className="text-slate-400 text-sm">No bodies found.</p>
      ) : (
        <div className="border border-[#e2e8f0] rounded-xl overflow-hidden bg-white">
          {bodies.map((b, i) => (
            <div key={b.id} className={`p-4 ${i !== 0 ? 'border-t border-[#e2e8f0]' : ''}`}>
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
                    <label htmlFor={`active-${b.id}`} className="text-sm text-slate-700">Active</label>
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
                      className="px-3 py-1.5 border border-[#e2e8f0] text-slate-700 text-sm rounded-lg hover:bg-slate-50 transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-[#0f172a]">{b.name}</p>
                    <p className="text-sm text-slate-500">{b.division}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs px-2 py-1 rounded-full font-medium ${b.is_active ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                      {b.is_active ? 'Active' : 'Inactive'}
                    </span>
                    <button
                      onClick={() => startEdit(b)}
                      className="text-sm text-[#0a1628] hover:text-[#c8102e] font-medium transition-colors"
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