'use client'

import { useState } from 'react'

/**
 * Which SGA positions make someone Leadership or a Member of one body (issue
 * #151). Shown on the Bodies tab, under each body.
 *
 * Positions are people's offices in their SGA account. Who holds them is
 * managed there, not here -- this only says what holding one means in Chambers.
 */

export type Position = { key: string; name: string; category: string | null }
export type Seat = { body_id: string; position_key: string; role: 'Leadership' | 'Member' }

const inputCls =
  'w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition'

/** The read-only summary under a body: who its seats are, by position name. */
export function BodyPositionsSummary({ seats, names }: { seats: Seat[]; names: Map<string, string> }) {
  const leadership = seats.filter(s => s.role === 'Leadership').map(s => names.get(s.position_key) ?? s.position_key)
  const member = seats.filter(s => s.role === 'Member').map(s => names.get(s.position_key) ?? s.position_key)
  if (!leadership.length && !member.length) {
    return <p className="text-xs text-[#f59e0b] mt-1">No SGA positions: nobody is Leadership or a Member of this body.</p>
  }
  return (
    <div className="text-xs mt-1 space-y-0.5">
      {leadership.length > 0 && (
        <p className="text-[#fbbf24]">Leadership: <span className="text-[#93b8d8]">{leadership.join(', ')}</span></p>
      )}
      {member.length > 0 && (
        <p className="text-[#93b8d8]">Members: {member.join(', ')}</p>
      )}
    </div>
  )
}

/** The editor for one body's seats. Saves the whole set at once. */
export function BodyPositionsEditor({
  bodyId,
  seats,
  positions,
  onSaved,
  onCancel,
}: {
  bodyId: string
  seats: Seat[]
  positions: Position[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [leadership, setLeadership] = useState<string[]>(seats.filter(s => s.role === 'Leadership').map(s => s.position_key))
  const [member, setMember] = useState<string[]>(seats.filter(s => s.role === 'Member').map(s => s.position_key))
  const [picked, setPicked] = useState('')
  const [role, setRole] = useState<'Leadership' | 'Member'>('Member')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const names = new Map(positions.map(p => [p.key, p.name]))
  const taken = new Set([...leadership, ...member])
  const categories = [...new Set(positions.map(p => p.category ?? 'Other'))]

  const add = () => {
    if (!picked || taken.has(picked)) return
    if (role === 'Leadership') setLeadership([...leadership, picked])
    else setMember([...member, picked])
    setPicked('')
  }

  const save = async () => {
    setSaving(true)
    setError(null)
    const res = await fetch('/api/administrator/bodies/positions', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_id: bodyId, leadership, member }),
    })
    setSaving(false)
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Could not save these positions.')
      return
    }
    onSaved()
  }

  const chips = (keys: string[], remove: (k: string) => void, tone: string) =>
    keys.length === 0 ? (
      <p className="text-xs text-[#6a96bb]">None</p>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        {keys.map(k => (
          <span key={k} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${tone}`}>
            {names.get(k) ?? k}
            <button
              onClick={() => remove(k)}
              aria-label={`Remove ${names.get(k) ?? k}`}
              className="text-[#6a96bb] hover:text-[#f87171] leading-none"
            >
              ×
            </button>
          </span>
        ))}
      </div>
    )

  return (
    <div className="space-y-3 border border-[#1e5080] rounded-lg p-3 mt-2">
      <div>
        <p className="text-xs font-medium text-[#fbbf24] mb-1.5">Leadership</p>
        {chips(leadership, k => setLeadership(leadership.filter(x => x !== k)), 'bg-[#3d2a00] text-[#fbbf24]')}
      </div>
      <div>
        <p className="text-xs font-medium text-[#93b8d8] mb-1.5">Members</p>
        {chips(member, k => setMember(member.filter(x => x !== k)), 'bg-[#1e3a5f] text-[#93b8d8]')}
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <select value={picked} onChange={e => setPicked(e.target.value)} className={inputCls} aria-label="Position">
          <option value="">Add a position…</option>
          {categories.map(c => (
            <optgroup key={c} label={c}>
              {positions
                .filter(p => (p.category ?? 'Other') === c && !taken.has(p.key))
                .map(p => (
                  <option key={p.key} value={p.key}>{p.name}</option>
                ))}
            </optgroup>
          ))}
        </select>
        <select
          value={role}
          onChange={e => setRole(e.target.value as 'Leadership' | 'Member')}
          className={`${inputCls} sm:w-40`}
          aria-label="Role in this body"
        >
          <option value="Member">Member</option>
          <option value="Leadership">Leadership</option>
        </select>
        <button
          onClick={add}
          disabled={!picked}
          className="flex-shrink-0 px-3 py-2 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors disabled:opacity-50"
        >
          Add
        </button>
      </div>

      <p className="text-xs text-[#6a96bb]">
        Anyone holding one of these positions in their SGA account gets that role in this body. Holding Leadership is what lets
        someone book for it. To change who holds a position, update their SGA account.
      </p>

      {error && <p className="text-sm text-[#f87171]">{error}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 bg-[#0a1628] hover:bg-[#0f2040] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save positions'}
        </button>
        <button
          onClick={onCancel}
          className="px-3 py-1.5 border border-[#1e5080] text-[#f0f6ff] text-sm rounded-lg hover:bg-[#1a4d8a] transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

/** Positions on no body and with no office meaning in Chambers: holding them grants nothing here. */
export function UnmappedPositions({ positions, seats, officeKeys }: { positions: Position[]; seats: Seat[]; officeKeys: string[] }) {
  const used = new Set([...seats.map(s => s.position_key), ...officeKeys])
  const unmapped = positions.filter(p => !used.has(p.key))
  if (!unmapped.length) return null
  return (
    <details className="border border-[#1e5080] rounded-xl bg-[#0f2a4a] px-4 py-3">
      <summary className="text-sm text-[#93b8d8] cursor-pointer">
        {unmapped.length} SGA position{unmapped.length === 1 ? '' : 's'} on no body
      </summary>
      <p className="text-xs text-[#6a96bb] mt-2">
        Holding one of these gives no body membership in Chambers. That is expected for offices with no body here.
      </p>
      <ul className="text-xs text-[#93b8d8] mt-2 columns-1 sm:columns-2 gap-6">
        {unmapped.map(p => (
          <li key={p.key}>{p.name}</li>
        ))}
      </ul>
    </details>
  )
}
