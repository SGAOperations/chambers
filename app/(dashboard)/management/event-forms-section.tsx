'use client'

import { useEffect, useState } from 'react'
import { MAX_FORM_LABEL, MAX_DUE_DAYS } from '@/lib/event-forms'

interface FormTemplate {
  id: string
  label: string
  due_days: number
}

const inputCls =
  'w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition'

/** Longest lead time first, the order the Events tab lists forms in. */
function sortTemplates(list: FormTemplate[]) {
  return [...list].sort((a, b) => b.due_days - a.due_days || a.label.localeCompare(b.label))
}

/**
 * The saved event forms an event manager can add in one click (issue #161).
 *
 * Curated here, beside the thresholds that govern the two standard forms,
 * because a deadline the division uses over and over -- pre-contracting six
 * weeks out -- is worth naming once instead of being retyped on every event.
 * Event managers can still type a one-off form straight onto an event; this list
 * only saves them from doing it repeatedly.
 *
 * Editing or deleting a saved form changes what gets added next. Events that
 * already added it keep the name and deadline they copied, so nothing anyone is
 * working to moves underneath them.
 */
export default function EventFormsSection() {
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  /** Row edits, keyed by id, held until saved so a half-typed name is not sent. */
  const [drafts, setDrafts] = useState<Record<string, { label: string; due_days: string }>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null)

  const [newLabel, setNewLabel] = useState('')
  const [newDays, setNewDays] = useState('28')
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    const load = async () => {
      const res = await fetch('/api/events/form-templates')
      if (res.ok) {
        const data = await res.json()
        setTemplates(sortTemplates(data.templates || []))
      }
      setLoading(false)
    }
    load()
  }, [])

  const messageOf = async (res: Response, fallback: string) => {
    try {
      const body = await res.json()
      return typeof body?.error === 'string' ? body.error : fallback
    } catch {
      return fallback
    }
  }

  const draftFor = (t: FormTemplate) =>
    drafts[t.id] ?? { label: t.label, due_days: String(t.due_days) }

  const editRow = (t: FormTemplate, patch: Partial<{ label: string; due_days: string }>) => {
    setMsg(null)
    setDrafts(prev => ({ ...prev, [t.id]: { ...draftFor(t), ...patch } }))
  }

  const validDays = (value: string) => {
    const n = Number(value)
    return value.trim() !== '' && Number.isInteger(n) && n >= 0 && n <= MAX_DUE_DAYS
  }

  const dirty = (t: FormTemplate) => {
    const d = drafts[t.id]
    return !!d && (d.label.trim() !== t.label || Number(d.due_days) !== t.due_days)
  }

  const saveRow = async (t: FormTemplate) => {
    const d = draftFor(t)
    if (!d.label.trim() || !validDays(d.due_days)) return

    setBusyId(t.id)
    const res = await fetch('/api/events/form-templates', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id, label: d.label.trim(), due_days: Number(d.due_days) }),
    })
    setBusyId(null)

    if (!res.ok) {
      setMsg({ ok: false, text: await messageOf(res, 'That saved form could not be updated.') })
      return
    }

    const { template } = await res.json()
    setTemplates(prev => sortTemplates(prev.map(x => (x.id === t.id ? template : x))))
    setDrafts(prev => {
      const next = { ...prev }
      delete next[t.id]
      return next
    })
    setMsg({ ok: true, text: 'Saved.' })
  }

  const deleteRow = async (t: FormTemplate) => {
    setBusyId(t.id)
    const res = await fetch('/api/events/form-templates', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: t.id }),
    })
    setBusyId(null)
    setConfirmingDelete(null)

    if (!res.ok) {
      setMsg({ ok: false, text: await messageOf(res, 'That saved form could not be deleted.') })
      return
    }

    setTemplates(prev => prev.filter(x => x.id !== t.id))
    setMsg({ ok: true, text: 'Deleted. Events that already added it keep their copy.' })
  }

  const addTemplate = async () => {
    if (!newLabel.trim() || !validDays(newDays)) return

    setAdding(true)
    const res = await fetch('/api/events/form-templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label: newLabel.trim(), due_days: Number(newDays) }),
    })
    setAdding(false)

    if (!res.ok) {
      setMsg({ ok: false, text: await messageOf(res, 'That saved form could not be added.') })
      return
    }

    const { template } = await res.json()
    setTemplates(prev => sortTemplates([...prev, template]))
    setNewLabel('')
    setNewDays('28')
    setMsg({ ok: true, text: 'Saved form added.' })
  }

  return (
    <div>
      <h2 className="text-sm font-semibold text-[#f0f6ff] mb-1">Saved Event Forms</h2>
      <p className="text-xs text-[#6a96bb] mb-4">
        Extra tracking forms the Events tab offers when adding one to an event, so a deadline used
        over and over is picked rather than retyped. A deadline is whole days before the event.
        Changing one here only affects events that add it afterwards.
      </p>

      {loading ? (
        <p className="text-[#93b8d8] text-sm">Loading saved forms...</p>
      ) : (
        <div className="space-y-2 mb-4">
          {templates.length === 0 && (
            <p className="text-[#6a96bb] text-sm">No saved forms yet.</p>
          )}
          {templates.map(t => {
            const d = draftFor(t)
            const canSave = dirty(t) && !!d.label.trim() && validDays(d.due_days)
            return (
              <div
                key={t.id}
                className="border border-[#1e5080] rounded-lg px-3 py-2.5 bg-[#0f2a4a] space-y-2"
              >
                <input
                  type="text"
                  value={d.label}
                  maxLength={MAX_FORM_LABEL}
                  onChange={e => editRow(t, { label: e.target.value })}
                  className={inputCls}
                />
                <div className="flex items-center gap-2 flex-wrap">
                  <label className="text-xs text-[#93b8d8]">Due</label>
                  <input
                    type="number"
                    min={0}
                    max={MAX_DUE_DAYS}
                    value={d.due_days}
                    onChange={e => editRow(t, { due_days: e.target.value })}
                    className="w-24 bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
                  />
                  <span className="text-xs text-[#93b8d8]">days before the event</span>

                  <div className="flex items-center gap-3 ml-auto">
                    <button
                      onClick={() => saveRow(t)}
                      disabled={!canSave || busyId === t.id}
                      className="text-xs text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {busyId === t.id ? 'Saving...' : 'Save'}
                    </button>
                    {/* Two steps rather than a modal: deleting a saved form takes
                        nothing away from an event that already added it. */}
                    {confirmingDelete === t.id ? (
                      <>
                        <button
                          onClick={() => deleteRow(t)}
                          disabled={busyId === t.id}
                          className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium transition-colors disabled:opacity-40"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setConfirmingDelete(null)}
                          className="text-xs text-[#6a96bb] hover:text-[#93b8d8] font-medium transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setMsg(null); setConfirmingDelete(t.id) }}
                        className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium transition-colors"
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="space-y-2">
        <input
          type="text"
          value={newLabel}
          maxLength={MAX_FORM_LABEL}
          placeholder="New form name"
          onChange={e => { setMsg(null); setNewLabel(e.target.value) }}
          className={inputCls}
        />
        <div className="flex items-center gap-2 flex-wrap">
          <label className="text-xs text-[#93b8d8]">Due</label>
          <input
            type="number"
            min={0}
            max={MAX_DUE_DAYS}
            value={newDays}
            onChange={e => { setMsg(null); setNewDays(e.target.value) }}
            className="w-24 bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
          />
          <span className="text-xs text-[#93b8d8]">days before the event</span>
        </div>
        <button
          onClick={addTemplate}
          disabled={adding || !newLabel.trim() || !validDays(newDays)}
          className="px-5 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {adding ? 'Adding...' : 'Add saved form'}
        </button>
      </div>

      {msg && (
        <p className={`text-sm mt-3 ${msg.ok ? 'text-green-400' : 'text-[#c8102e]'}`}>{msg.text}</p>
      )}
    </div>
  )
}
