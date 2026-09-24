'use client'

import { useEffect, useState } from 'react'
import EventsGuard from '../eventsguard'
import { Skeleton } from '@/app/_components/skeleton'
import { usePendingActionsWatch } from '../pending-actions-watch'
import { MAX_FORM_LABEL, MAX_DUE_DAYS } from '@/lib/event-forms'

/**
 * One line of an event's checklist -- see the EventForm comment in
 * /api/events/route.ts. The two standard forms and the event's own extra forms
 * arrive as one list; `kind` is what decides whether a line can be renamed,
 * rescheduled or removed here.
 */
interface EventForm {
  key: string
  kind: 'standard' | 'custom'
  label: string
  checked: boolean
  due_days: number
  due_date: string | null
}

/** A saved form from the catalog an admin curates in Administrator > Advanced. */
interface FormTemplate {
  id: string
  label: string
  due_days: number
}

interface EventBooking {
  /**
   * A booking event uses the booking's id. A weekly occurrence event uses
   * `<bookingId>:<date>`, because every flagged week of one series would
   * otherwise share an id -- and this keys both the checklist state and the
   * pending-actions highlighting.
   */
  id: string
  /** The real booking id, set only on occurrence rows where `id` is synthetic. */
  booking_id?: string
  /** Set when this row is a single flagged week rather than a whole booking. */
  occurrence_date: string | null
  purpose: string
  type: string
  created_at: string
  /** The event's own date -- its earliest session -- which deadlines count back from. */
  event_date: string | null
  bodies: { name: string } | null
  users: { full_name: string } | null
  one_time_room_bookings: {
    room_name: string | null
    booking_date: string
    start_time: string
    end_time: string
  }[] | null
  weekly_room_bookings: {
    room_name: string | null
    start_date: string
    end_date: string
    start_time: string
    end_time: string
  }[] | null
  tabling_bookings: {
    tabling_sessions: {
      location: string
      session_date: string
      start_time: string
      end_time: string
    }[]
  }[] | null
  forms: EventForm[]
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
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

/**
 * A deadline is stored as a lead time, so moving one re-derives its date here
 * rather than refetching the tab. Same arithmetic as subtractDays on the server
 * (whole UTC days); kept local so the page does not pull the pending-actions
 * module, and its Supabase reads, into the browser bundle.
 */
function dueDateFor(eventDate: string | null, days: number): string | null {
  if (!eventDate) return null
  const [y, m, d] = eventDate.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d) - days * 86_400_000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}-${String(t.getUTCDate()).padStart(2, '0')}`
}

/** `event-form:<row>:mgmt | engage | item:<id>` -- the pending action this line is. */
function actionIdFor(rowId: string, key: string) {
  const suffix =
    key === 'event_management_form' ? 'mgmt' : key === 'engage_form' ? 'engage' : key
  return `event-form:${rowId}:${suffix}`
}

/** Custom forms sort after the standard pair, longest lead time first. */
function sortForms(forms: EventForm[]): EventForm[] {
  const standard = forms.filter(f => f.kind === 'standard')
  const custom = forms.filter(f => f.kind === 'custom').sort((a, b) => b.due_days - a.due_days)
  return [...standard, ...custom]
}

const inputCls =
  'bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-2.5 py-1.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition'
const linkBtnCls =
  'text-xs text-[#6a96bb] hover:text-[#93b8d8] underline underline-offset-2 transition cursor-pointer'
const primaryBtnCls =
  'text-xs font-medium px-2.5 py-1.5 rounded-lg bg-[#c8102e] text-white hover:bg-[#a60d26] disabled:opacity-50 disabled:cursor-not-allowed transition cursor-pointer'

/** What one submission of the editor below carries. */
interface FormDraft {
  label: string
  days: number
  /** Set when the draft is a saved form taken as-is, so the server re-reads it. */
  templateId: string | null
}

/**
 * The name/deadline editor, used to add a form and to edit one already added.
 *
 * When adding, the saved forms an admin curates are offered first: picking one
 * fills both fields, and they stay editable, so a saved form can be used as a
 * starting point for a one-off. A draft still matching the saved form is sent as
 * that form rather than as its values, which lets the server re-read it -- a tab
 * left open for a week cannot add a deadline that has since been changed.
 */
function FormEditor({
  templates,
  initialLabel,
  initialDays,
  eventDate,
  saveLabel,
  onSave,
  onCancel,
}: {
  /** The saved forms to offer, or null when editing a form already added. */
  templates: FormTemplate[] | null
  initialLabel: string
  initialDays: number
  eventDate: string | null
  saveLabel: string
  onSave: (draft: FormDraft) => Promise<void>
  onCancel: () => void
}) {
  const [label, setLabel] = useState(initialLabel)
  const [days, setDays] = useState(String(initialDays))
  const [templateId, setTemplateId] = useState('')
  const [saving, setSaving] = useState(false)

  const parsedDays = Number(days)
  const daysValid =
    days.trim() !== '' &&
    Number.isInteger(parsedDays) &&
    parsedDays >= 0 &&
    parsedDays <= MAX_DUE_DAYS
  const valid = daysValid && label.trim().length > 0
  const preview = daysValid ? dueDateFor(eventDate, parsedDays) : null

  const chosen = templates?.find(t => t.id === templateId) ?? null
  // Edited away from the saved form it came from -- send the values instead.
  const unchanged = !!chosen && chosen.label === label.trim() && chosen.due_days === parsedDays

  const pick = (id: string) => {
    setTemplateId(id)
    const t = templates?.find(x => x.id === id)
    if (t) {
      setLabel(t.label)
      setDays(String(t.due_days))
    }
  }

  const submit = async () => {
    if (!valid || saving) return
    setSaving(true)
    await onSave({
      label: label.trim(),
      days: parsedDays,
      templateId: unchanged ? chosen.id : null,
    })
    setSaving(false)
  }

  return (
    <div className="space-y-2 pl-7">
      {!!templates?.length && (
        <select
          value={templateId}
          onChange={e => pick(e.target.value)}
          className={`${inputCls} w-full max-w-xs`}
        >
          <option value="">Saved forms…</option>
          {templates.map(t => (
            <option key={t.id} value={t.id}>
              {t.label} — {t.due_days} days before
            </option>
          ))}
        </select>
      )}
      <input
        type="text"
        value={label}
        maxLength={MAX_FORM_LABEL}
        autoFocus
        placeholder="Form name"
        onChange={e => setLabel(e.target.value)}
        onKeyDown={e => e.key === 'Enter' && submit()}
        className={`${inputCls} w-full max-w-xs`}
      />
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-[#93b8d8]">
          Due
          <input
            type="number"
            min={0}
            max={MAX_DUE_DAYS}
            value={days}
            onChange={e => setDays(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            className={`${inputCls} w-20`}
          />
          days before the event
        </label>
        <button type="button" onClick={submit} disabled={!valid || saving} className={primaryBtnCls}>
          {saving ? 'Saving…' : saveLabel}
        </button>
        <button type="button" onClick={onCancel} className={linkBtnCls}>
          Cancel
        </button>
      </div>
      {preview && <p className="text-xs text-[#6a96bb]">That is {formatDate(preview)}.</p>}
    </div>
  )
}

/**
 * One form on an event: tick it off, and for an extra form rename it, move its
 * deadline or take it off the list.
 *
 * The two standard forms are deliberately not editable here. They are the same
 * form on every event, due on the schedule set once in Administrator > Advanced,
 * and an event that needs something else adds it rather than redefining them.
 */
function ChecklistRow({
  form,
  danger,
  editing,
  onToggle,
  onEdit,
  onCancelEdit,
  onSave,
  onRemove,
  eventDate,
}: {
  form: EventForm
  danger: boolean
  editing: boolean
  onToggle: (checked: boolean) => void
  onEdit: () => void
  onCancelEdit: () => void
  onSave: (draft: FormDraft) => Promise<void>
  onRemove: () => void
  eventDate: string | null
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-3">
        <label className="flex items-start gap-3 cursor-pointer select-none group min-w-0">
          <input
            type="checkbox"
            checked={form.checked}
            onChange={e => onToggle(e.target.checked)}
            className="w-4 h-4 mt-0.5 rounded border border-[#1e5080] bg-[#0f2a4a] accent-[#c8102e] cursor-pointer"
          />
          <span className="flex flex-col min-w-0">
            <span className={`text-sm transition-colors ${form.checked ? 'text-[#4ade80] line-through' : danger ? 'pa-text-danger' : 'text-[#f0f6ff] group-hover:text-white'}`}>
              {form.label}
            </span>
            {!form.checked && form.due_date && (
              <span className="text-xs text-[#6a96bb]">Due {formatDate(form.due_date)}</span>
            )}
          </span>
        </label>

        {form.kind === 'custom' && !editing && (
          <div className="flex items-center gap-2 ml-auto shrink-0">
            <button type="button" onClick={onEdit} className={linkBtnCls}>
              Edit
            </button>
            <button type="button" onClick={onRemove} className={linkBtnCls}>
              Remove
            </button>
          </div>
        )}
      </div>

      {editing && (
        <FormEditor
          templates={null}
          initialLabel={form.label}
          initialDays={form.due_days}
          eventDate={eventDate}
          saveLabel="Save"
          onSave={onSave}
          onCancel={onCancelEdit}
        />
      )}
    </div>
  )
}

function BookingDetails({ booking }: { booking: EventBooking }) {
  if (booking.type === 'One-Time Room' && booking.one_time_room_bookings?.length) {
    const sessions = booking.one_time_room_bookings
    return (
      <div className="text-sm text-[#93b8d8] space-y-1">
        {sessions.map((d, i) => (
          <div key={i} className={sessions.length > 1 ? 'border-t border-[#1e5080] pt-1 first:border-0 first:pt-0' : ''}>
            {d.room_name && <p><span className="font-medium text-[#f0f6ff]">Room:</span> {d.room_name}</p>}
            <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(d.booking_date)}</p>
            <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(d.start_time)} – {formatTime(d.end_time)}</p>
          </div>
        ))}
      </div>
    )
  }

  if (booking.type === 'Weekly Room' && booking.weekly_room_bookings?.length) {
    const sessions = booking.weekly_room_bookings
    return (
      <div className="text-sm text-[#93b8d8] space-y-1">
        {sessions.map((w, i) => (
          <div key={i} className={sessions.length > 1 ? 'border-t border-[#1e5080] pt-1 first:border-0 first:pt-0' : ''}>
            {w.room_name && <p><span className="font-medium text-[#f0f6ff]">Room:</span> {w.room_name}</p>}
            {/* An occurrence event is one week, so a "Dates: Sep 1 – Sep 1" range
                would be noise. The row carries occurrence_date precisely so this
                can say Date instead. */}
            {booking.occurrence_date ? (
              <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(booking.occurrence_date)}</p>
            ) : (
              <p><span className="font-medium text-[#f0f6ff]">Dates:</span> {formatDate(w.start_date)} – {formatDate(w.end_date)}</p>
            )}
            <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(w.start_time)} – {formatTime(w.end_time)}</p>
          </div>
        ))}
      </div>
    )
  }

  if (booking.type === 'Tabling' && booking.tabling_bookings?.[0]?.tabling_sessions?.length) {
    const sessions = booking.tabling_bookings[0].tabling_sessions
    return (
      <div className="text-sm text-[#93b8d8] space-y-1">
        {sessions.map((s, i) => (
          <div key={i} className={sessions.length > 1 ? 'border-t border-[#1e5080] pt-1 first:border-0 first:pt-0' : ''}>
            <p><span className="font-medium text-[#f0f6ff]">Location:</span> {s.location}</p>
            <p><span className="font-medium text-[#f0f6ff]">Date:</span> {formatDate(s.session_date)}</p>
            <p><span className="font-medium text-[#f0f6ff]">Time:</span> {formatTime(s.start_time)} – {formatTime(s.end_time)}</p>
          </div>
        ))}
      </div>
    )
  }

  return null
}

export default function EventsPage() {
  const [bookings, setBookings] = useState<EventBooking[]>([])
  const [templates, setTemplates] = useState<FormTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const { isDanger, isActionDanger, registerOrigin } = usePendingActionsWatch()
  /** `<rowId>::<formKey>` for the line being edited, or `<rowId>::new`. */
  const [editing, setEditing] = useState<string | null>(null)
  /** Per-event message for a save that failed, keyed by row id. */
  const [errors, setErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    const fetchEvents = async () => {
      // The saved forms ride along: they are only needed once someone opens the
      // add-a-form editor, but they are a handful of rows and fetching them here
      // keeps that editor from flashing empty.
      const [res, templatesRes] = await Promise.all([
        fetch('/api/events'),
        fetch('/api/events/form-templates'),
      ])
      if (res.ok) {
        const data = await res.json()
        setBookings(data.bookings || [])
      }
      if (templatesRes.ok) {
        const data = await templatesRes.json()
        setTemplates(data.templates || [])
      }
      setLoading(false)
    }
    fetchEvents()
  }, [])

  const setError = (rowId: string, message: string) =>
    setErrors(prev => ({ ...prev, [rowId]: message }))
  const clearError = (rowId: string) =>
    setErrors(prev => {
      if (!(rowId in prev)) return prev
      const next = { ...prev }
      delete next[rowId]
      return next
    })

  /** Rewrites one event's checklist in place. */
  const patchForms = (rowId: string, fn: (forms: EventForm[]) => EventForm[]) =>
    setBookings(prev => prev.map(b => (b.id === rowId ? { ...b, forms: sortForms(fn(b.forms)) } : b)))

  const patchForm = (rowId: string, key: string, patch: Partial<EventForm>) =>
    patchForms(rowId, forms => forms.map(f => (f.key === key ? { ...f, ...patch } : f)))

  /** The error body's message, or a generic one -- both routes reply `{ error }`. */
  const messageOf = async (res: Response, fallback: string) => {
    try {
      const body = await res.json()
      return typeof body?.error === 'string' ? body.error : fallback
    } catch {
      return fallback
    }
  }

  /** The id an extra form's own record is addressed by. */
  const itemIdOf = (form: EventForm) => form.key.slice('item:'.length)

  // Takes the row rather than an id: the checklist is keyed by the row's id
  // (synthetic for an occurrence event) while the save has to address the real
  // booking plus, for an occurrence, its date.
  const toggleForm = async (row: EventBooking, form: EventForm, checked: boolean) => {
    clearError(row.id)
    // Optimistic update, rolled back below if the save fails.
    patchForm(row.id, form.key, { checked })

    const res =
      form.kind === 'standard'
        ? await fetch('/api/events/checklist', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              booking_id: row.booking_id ?? row.id,
              occurrence_date: row.occurrence_date,
              step: form.key,
              checked,
            }),
          })
        : await fetch('/api/events/forms', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: itemIdOf(form), completed: checked }),
          })

    if (!res.ok) {
      patchForm(row.id, form.key, { checked: !checked })
      setError(row.id, await messageOf(res, 'That change could not be saved.'))
    }
  }

  /**
   * Renames an extra form or moves its deadline.
   *
   * The deadline is a lead time, so the displayed date is re-derived here rather
   * than by refetching the tab.
   */
  const saveForm = async (row: EventBooking, form: EventForm, draft: FormDraft) => {
    clearError(row.id)
    const previous = form

    patchForm(row.id, form.key, {
      label: draft.label,
      due_days: draft.days,
      due_date: dueDateFor(row.event_date, draft.days),
    })
    setEditing(null)

    const res = await fetch('/api/events/forms', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemIdOf(form), label: draft.label, due_days: draft.days }),
    })

    if (!res.ok) {
      patchForm(row.id, form.key, previous)
      setError(row.id, await messageOf(res, 'That change could not be saved.'))
    }
  }

  const addForm = async (row: EventBooking, draft: FormDraft) => {
    clearError(row.id)

    const res = await fetch('/api/events/forms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        booking_id: row.booking_id ?? row.id,
        occurrence_date: row.occurrence_date,
        // A saved form taken as-is is sent as itself, so the server reads its
        // current name and deadline rather than this tab's copy.
        ...(draft.templateId
          ? { template_id: draft.templateId }
          : { label: draft.label, due_days: draft.days }),
      }),
    })

    if (!res.ok) {
      setError(row.id, await messageOf(res, 'That form could not be added.'))
      return
    }

    // Added from the server's row so the line carries the real id, which every
    // later edit, tick and removal is addressed by.
    const { item } = await res.json()
    patchForms(row.id, forms => [
      ...forms,
      {
        key: `item:${item.id}`,
        kind: 'custom',
        label: item.label,
        checked: item.completed,
        due_days: item.due_days,
        due_date: dueDateFor(row.event_date, item.due_days),
      },
    ])
    setEditing(null)
  }

  const removeForm = async (row: EventBooking, form: EventForm) => {
    clearError(row.id)
    const previous = row.forms

    patchForms(row.id, forms => forms.filter(f => f.key !== form.key))
    setEditing(null)

    const res = await fetch('/api/events/forms', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemIdOf(form) }),
    })

    if (!res.ok) {
      patchForms(row.id, () => previous)
      setError(row.id, await messageOf(res, 'That form could not be removed.'))
    }
  }

  return (
    <EventsGuard>
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-[#f0f6ff]">Events</h1>

        {loading ? (
          <div className="space-y-4">
            {[0, 1].map(i => (
              <div key={i} className="border border-[#1e5080] rounded-xl bg-[#184073] shadow-sm overflow-hidden animate-pulse">
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-2">
                      <Skeleton className="h-4 w-40" />
                      <Skeleton className="h-3.5 w-56" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Skeleton className="h-5 w-12 rounded-full" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Skeleton className="h-3.5 w-48" />
                    <Skeleton className="h-3.5 w-40" />
                  </div>
                </div>
                <div className="border-t border-[#1e5080] px-5 py-4 bg-[#0f2a4a]/50 space-y-3">
                  <Skeleton className="h-2.5 w-16" />
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-32" />
                </div>
              </div>
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <p className="text-[#6a96bb] text-sm">No event bookings found.</p>
        ) : (
          <div className="space-y-4">
            {bookings.map(b => (
              <div
                key={b.id}
                ref={registerOrigin(b.id)}
                className={`border border-[#1e5080] rounded-xl bg-[#184073] shadow-sm overflow-hidden ${isDanger(b.id) ? 'pa-row-danger' : ''}`}
              >
                {/* Header */}
                <div className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-[#f0f6ff] pa-row-title">{b.purpose}</p>
                      <p className="text-sm text-[#93b8d8]">{b.bodies?.name}</p>
                      {b.users?.full_name && (
                        <p className="text-xs text-[#6a96bb] mt-0.5">Requested by {b.users.full_name}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#062f3b] text-[#22d3ee]">Event</span>
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-[#0f2a4a] text-[#93b8d8]">{b.type}</span>
                    </div>
                  </div>

                  <BookingDetails booking={b} />
                </div>

                {/* Checklist */}
                <div className="border-t border-[#1e5080] px-5 py-4 bg-[#0f2a4a]/50 space-y-3">
                  <p className="text-xs font-semibold text-[#93b8d8] uppercase tracking-wide">Tracking</p>

                  {b.forms.map(form => (
                    <ChecklistRow
                      key={form.key}
                      form={form}
                      eventDate={b.event_date}
                      danger={isActionDanger(actionIdFor(b.id, form.key))}
                      editing={editing === `${b.id}::${form.key}`}
                      onToggle={checked => toggleForm(b, form, checked)}
                      onEdit={() => setEditing(`${b.id}::${form.key}`)}
                      onCancelEdit={() => setEditing(null)}
                      onSave={draft => saveForm(b, form, draft)}
                      onRemove={() => removeForm(b, form)}
                    />
                  ))}

                  {editing === `${b.id}::new` ? (
                    <FormEditor
                      templates={templates}
                      initialLabel=""
                      // Starts on the Event Management Form's deadline: the
                      // earliest of the two standard ones, and the closest thing
                      // to a house default an extra form has.
                      initialDays={b.forms[0]?.due_days ?? 28}
                      eventDate={b.event_date}
                      saveLabel="Add form"
                      onSave={draft => addForm(b, draft)}
                      onCancel={() => setEditing(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEditing(`${b.id}::new`)}
                      className={linkBtnCls}
                    >
                      + Add a form
                    </button>
                  )}

                  {errors[b.id] && <p className="text-xs text-[#f87171]">{errors[b.id]}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </EventsGuard>
  )
}
