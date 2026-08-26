'use client'

import { useMemo } from 'react'
import type { BookingScope, Division } from '@/lib/booking-scope'

export interface BookingScopeValue {
  scope: BookingScope
  /** The owning body. Always set, for every scope. */
  body_id: string
  /** Divisional only. */
  division: Division | null
  /** Multi only. Includes body_id. */
  body_ids: string[]
}

export interface ScopeBody {
  id: string
  name: string
  division: Division
}

interface Props {
  value: BookingScopeValue
  onChange: (v: BookingScopeValue) => void
  /** Bodies the caller may originate a booking from (admins: all active; leadership: theirs). */
  ownerBodies: ScopeBody[]
  /** The pool for a multi-body booking. Any leadership may pick any combination. */
  allBodies: ScopeBody[]
  /** Divisions the caller may create a divisional booking for. */
  allowedDivisions: Division[]
  disabled?: boolean
}

const inputCls =
  'w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition'
const labelCls = 'block text-xs font-medium text-[#93b8d8] mb-1'

const SCOPE_OPTIONS: { value: BookingScope; label: string; hint: string }[] = [
  { value: 'single', label: 'Single body', hint: 'Only this body sees the booking.' },
  {
    value: 'divisional',
    label: 'Divisional',
    hint: 'Everyone in the division sees it; their leadership can manage it.',
  },
  {
    value: 'multi',
    label: 'Multiple bodies',
    hint: 'Only the chosen bodies see it; leadership of any of them can manage it.',
  },
]

/**
 * The scope selector shared by all seven booking forms (three admin create, three admin edit, and
 * the leadership request page). Wraps the plain Body <select> those forms used to each declare
 * inline, so single-body -- the default and the overwhelming majority -- still reads as one field.
 *
 * Switching scope clears whatever the new scope does not use, so the emitted value always
 * satisfies the database CHECK constraints (division is present iff divisional).
 */
export default function BookingScopeSelector({
  value,
  onChange,
  ownerBodies,
  allBodies,
  allowedDivisions,
  disabled = false,
}: Props) {
  const ownerBody = useMemo(
    () => ownerBodies.find(b => b.id === value.body_id) ?? null,
    [ownerBodies, value.body_id]
  )

  const canGoDivisional = allowedDivisions.length > 0

  const setScope = (scope: BookingScope) => {
    if (scope === 'divisional') {
      // Default to the owning body's own division when it is one the user may use.
      const preferred =
        ownerBody && allowedDivisions.includes(ownerBody.division)
          ? ownerBody.division
          : allowedDivisions[0] ?? null
      onChange({ ...value, scope, division: preferred, body_ids: [] })
      return
    }
    if (scope === 'multi') {
      onChange({
        ...value,
        scope,
        division: null,
        body_ids: value.body_id ? [value.body_id] : [],
      })
      return
    }
    onChange({ ...value, scope: 'single', division: null, body_ids: [] })
  }

  const setBodyId = (body_id: string) => {
    const next: BookingScopeValue = { ...value, body_id }
    if (value.scope === 'multi') {
      // Keep the owner in the set, and drop the previous owner if it was only there implicitly.
      const others = value.body_ids.filter(id => id !== value.body_id && id !== body_id)
      next.body_ids = body_id ? [body_id, ...others] : others
    }
    if (value.scope === 'divisional') {
      const body = ownerBodies.find(b => b.id === body_id)
      if (body && allowedDivisions.includes(body.division)) next.division = body.division
    }
    onChange(next)
  }

  const toggleBody = (id: string) => {
    if (id === value.body_id) return // the owner is always in the set
    const has = value.body_ids.includes(id)
    onChange({
      ...value,
      body_ids: has ? value.body_ids.filter(b => b !== id) : [...value.body_ids, id],
    })
  }

  const otherBodies = allBodies.filter(b => b.id !== value.body_id)
  const selectedCount = value.body_ids.filter(id => id !== value.body_id).length

  return (
    <div className="space-y-3">
      <div>
        <label className={labelCls}>Visibility *</label>
        <select
          value={value.scope}
          onChange={e => setScope(e.target.value as BookingScope)}
          disabled={disabled}
          className={inputCls}
        >
          {SCOPE_OPTIONS.map(o => (
            <option
              key={o.value}
              value={o.value}
              disabled={o.value === 'divisional' && !canGoDivisional}
            >
              {o.label}
            </option>
          ))}
        </select>
        <p className="mt-1 text-xs text-[#6a96bb]">
          {SCOPE_OPTIONS.find(o => o.value === value.scope)?.hint}
          {value.scope === 'divisional' && !canGoDivisional && (
            <span className="text-[#f87171]"> You do not hold Leadership in any division.</span>
          )}
        </p>
      </div>

      <div>
        <label className={labelCls}>Body *</label>
        <select
          value={value.body_id}
          onChange={e => setBodyId(e.target.value)}
          disabled={disabled}
          className={inputCls}
        >
          <option value="">Select Body</option>
          {ownerBodies.map(b => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {value.scope === 'divisional' && (
        <div>
          <label className={labelCls}>Division *</label>
          <select
            value={value.division ?? ''}
            onChange={e => onChange({ ...value, division: (e.target.value || null) as Division | null })}
            disabled={disabled || !canGoDivisional}
            className={inputCls}
          >
            <option value="">Select Division</option>
            {allowedDivisions.map(d => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
          </select>
        </div>
      )}

      {value.scope === 'multi' && (
        <div>
          <label className={labelCls}>
            Additional bodies * <span className="text-[#6a96bb]">({selectedCount} selected)</span>
          </label>
          {!value.body_id ? (
            <p className="text-xs text-[#6a96bb]">Select a body above first.</p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-[#1e5080] bg-[#0f2a4a] divide-y divide-[#1e5080]/60">
              <label className="flex items-center gap-2 px-3 py-2 text-sm text-[#6a96bb]">
                <input type="checkbox" checked disabled className="accent-[#c8102e]" />
                {ownerBody?.name ?? 'Owning body'}{' '}
                <span className="text-xs">(owner, always included)</span>
              </label>
              {otherBodies.map(b => (
                <label
                  key={b.id}
                  className="flex items-center gap-2 px-3 py-2 text-sm text-[#f0f6ff] hover:bg-[#1a4d8a] cursor-pointer transition-colors"
                >
                  <input
                    type="checkbox"
                    checked={value.body_ids.includes(b.id)}
                    onChange={() => toggleBody(b.id)}
                    disabled={disabled}
                    className="accent-[#c8102e]"
                  />
                  {b.name}
                </label>
              ))}
            </div>
          )}
          {value.body_id && selectedCount === 0 && (
            <p className="mt-1 text-xs text-[#f87171]">
              Select at least one other body, or switch back to Single body.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
