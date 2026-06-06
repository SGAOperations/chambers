'use client'

import { useEffect, useState } from 'react'
import { Skeleton } from '@/app/_components/skeleton'
import { getPrefsForRole, EMAIL_PREF_LABELS, EmailPrefKey } from '@/lib/email-preferences'

interface Membership {
  id: string
  role: string
  bodies: { id: string; name: string; division: string } | null
}

interface PendingRequest {
  id: string
  bodies: { id: string; name: string; division: string } | null
}

interface AvailableBody {
  id: string
  name: string
  division: string
  body_open: boolean
}

export interface Settings {
  full_name: string
  email_preferences: Record<string, boolean>
  admin_role: string | null
  iems_role: string | null
  memberships: Membership[]
  pending_requests: PendingRequest[]
  available_bodies: AvailableBody[]
}

interface SettingsModalProps {
  onClose: () => void
  cachedSettings?: Settings | null
  onSettingsLoaded?: (settings: Settings) => void
}

const inputCls =
  'w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition'

export default function SettingsModal({ onClose, cachedSettings, onSettingsLoaded }: SettingsModalProps) {
  const [settings, setSettings] = useState<Settings | null>(cachedSettings ?? null)
  const [loading, setLoading] = useState(cachedSettings == null)
  const [nameValue, setNameValue] = useState(cachedSettings?.full_name ?? '')
  const [nameSaving, setNameSaving] = useState(false)
  const [nameStatus, setNameStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [selectedBodyId, setSelectedBodyId] = useState('')
  const [addingBody, setAddingBody] = useState(false)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [cancellingId, setCancellingId] = useState<string | null>(null)

  const loadSettings = () => {
    setLoading(true)
    fetch('/api/me/settings')
      .then(r => r.json())
      .then((data: Settings) => {
        setSettings(data)
        setNameValue(data.full_name ?? '')
        setSelectedBodyId('')
        setLoading(false)
        onSettingsLoaded?.(data)
      })
      .catch(() => setLoading(false))
  }

  useEffect(() => { if (cachedSettings == null) loadSettings() }, [])

  const saveName = async () => {
    if (!nameValue.trim()) return
    setNameSaving(true)
    setNameStatus('idle')
    const res = await fetch('/api/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ full_name: nameValue.trim() }),
    })
    setNameSaving(false)
    setNameStatus(res.ok ? 'saved' : 'error')
  }

  const addBody = async () => {
    if (!selectedBodyId) return
    setAddingBody(true)
    await fetch('/api/me/memberships', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body_id: selectedBodyId }),
    })
    setAddingBody(false)
    loadSettings()
  }

  const removeMembership = async (id: string) => {
    setRemovingId(id)
    await fetch('/api/me/memberships', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    })
    setRemovingId(null)
    loadSettings()
  }

  const cancelRequest = async (requestId: string) => {
    setCancellingId(requestId)
    await fetch('/api/me/memberships', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ request_id: requestId }),
    })
    setCancellingId(null)
    loadSettings()
  }

  const toggleEmailPref = async (key: EmailPrefKey, value: boolean) => {
    if (!settings) return
    const updated = { ...settings.email_preferences, [key]: value }
    setSettings(prev => prev ? { ...prev, email_preferences: updated } : prev)
    await fetch('/api/me/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email_preferences: updated }),
    })
  }

  const eligibleKeys = settings ? getPrefsForRole(settings.admin_role, settings.iems_role) : []
  const selectedBody = settings?.available_bodies.find(b => b.id === selectedBodyId)

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-8 space-y-6">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold text-[#f0f6ff]">Settings</h2>
          <button onClick={onClose} className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors">✕</button>
        </div>

        {/* Display Name */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-[#93b8d8]">Display Name</p>
          {loading ? (
            <Skeleton className="h-9 w-full animate-pulse" />
          ) : (
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={nameValue}
                onChange={e => { setNameValue(e.target.value); setNameStatus('idle') }}
                className={inputCls}
                placeholder="Your name"
              />
              <button
                onClick={saveName}
                disabled={nameSaving || !nameValue.trim()}
                className="flex-shrink-0 bg-[#c8102e] hover:bg-[#a00d24] text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
              >
                {nameSaving ? 'Saving…' : 'Save'}
              </button>
              {nameStatus === 'saved' && <span className="text-[#4ade80] text-xs flex-shrink-0">Saved</span>}
              {nameStatus === 'error' && <span className="text-[#f87171] text-xs flex-shrink-0">Failed</span>}
            </div>
          )}
        </div>

        {/* Bodies */}
        <div className="space-y-3">
          <p className="text-xs font-medium text-[#93b8d8]">Your Bodies</p>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-9 w-full animate-pulse" />
              <Skeleton className="h-9 w-3/4 animate-pulse" />
            </div>
          ) : (
            <>
              {settings && (settings.memberships.length > 0 || settings.pending_requests.length > 0) ? (
                <div className="space-y-2">
                  {[...settings.memberships]
                    .sort((a, b) => {
                      if (a.role !== b.role) return a.role === 'Leadership' ? -1 : 1
                      return (a.bodies?.name ?? '').localeCompare(b.bodies?.name ?? '')
                    })
                    .map(m => (
                      <div key={m.id} className="flex items-center justify-between px-3 py-2 bg-[#0f2a4a] border border-[#1e5080] rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="text-sm text-[#f0f6ff]">{m.bodies?.name ?? '—'}</span>
                          <span className={`text-xs font-medium ${m.role === 'Leadership' ? 'text-[#fbbf24]' : 'text-[#93b8d8]'}`}>
                            {m.role}
                          </span>
                        </div>
                        <button
                          onClick={() => removeMembership(m.id)}
                          disabled={removingId === m.id}
                          className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium disabled:opacity-50 transition-colors"
                        >
                          {removingId === m.id ? 'Removing…' : 'Remove'}
                        </button>
                      </div>
                    ))}
                  {settings.pending_requests.map(r => (
                    <div key={r.id} className="flex items-center justify-between px-3 py-2 bg-[#0f2a4a] border border-[#1e5080] rounded-lg">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-[#f0f6ff]">{r.bodies?.name ?? '—'}</span>
                        <span className="text-xs text-[#f59e0b] bg-[#3d2a00] px-2 py-0.5 rounded-full">
                          Pending Approval
                        </span>
                      </div>
                      <button
                        onClick={() => cancelRequest(r.id)}
                        disabled={cancellingId === r.id}
                        className="text-xs text-[#6a96bb] hover:text-[#f87171] font-medium disabled:opacity-50 transition-colors"
                      >
                        {cancellingId === r.id ? 'Cancelling…' : 'Cancel'}
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[#6a96bb] text-sm">No body memberships found.</p>
              )}

              {/* Add body */}
              {settings && settings.available_bodies.length > 0 && (
                <div className="flex items-center gap-2 pt-1">
                  <select
                    value={selectedBodyId}
                    onChange={e => setSelectedBodyId(e.target.value)}
                    className="flex-1 bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2 text-sm text-[#f0f6ff] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
                  >
                    <option value="">Add a body…</option>
                    {settings.available_bodies.map(b => (
                      <option key={b.id} value={b.id}>
                        {b.name}{b.body_open ? '' : ' (Request Required)'}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={addBody}
                    disabled={!selectedBodyId || addingBody}
                    className="flex-shrink-0 bg-[#0f2a4a] hover:bg-[#1a4d8a] border border-[#1e5080] text-[#f0f6ff] px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50"
                  >
                    {addingBody ? '…' : selectedBody?.body_open ? 'Join' : 'Request'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Email Notifications */}
        {!loading && eligibleKeys.length > 0 && (
          <div className="space-y-3">
            <p className="text-xs font-medium text-[#93b8d8]">Email Notifications</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {eligibleKeys.map(key => (
                <label key={key} className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    className="accent-[#c8102e] w-4 h-4 flex-shrink-0"
                    checked={settings?.email_preferences?.[key] ?? true}
                    onChange={e => toggleEmailPref(key, e.target.checked)}
                  />
                  <span className="text-sm text-[#f0f6ff]">{EMAIL_PREF_LABELS[key]}</span>
                </label>
              ))}
            </div>
          </div>
        )}
        {loading && (
          <div className="space-y-2">
            <Skeleton className="h-4 w-40 animate-pulse" />
            <Skeleton className="h-5 w-full animate-pulse" />
            <Skeleton className="h-5 w-full animate-pulse" />
          </div>
        )}
      </div>
    </div>
  )
}
