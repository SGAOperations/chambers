'use client'

import { useEffect, useState } from 'react'
import { createBrowserClient } from '@supabase/ssr'
import { getAuthedUser } from '@/lib/auth'
import { Skeleton } from '@/app/_components/skeleton'

function BookingSettingsTabSkeleton() {
  return (
    <div className="max-w-sm space-y-8">
      <div className="space-y-4">
        <Skeleton className="h-4 w-52 animate-pulse" />
        {[0, 1].map(i => (
          <div key={i} className="space-y-1">
            <Skeleton className="h-3 w-64 animate-pulse" />
            <Skeleton className="h-10 w-full rounded-lg animate-pulse" />
          </div>
        ))}
        <Skeleton className="h-9 w-16 rounded-lg animate-pulse" />
      </div>
      <div className="space-y-4">
        <Skeleton className="h-4 w-44 animate-pulse" />
        <div className="space-y-2">
          {[0, 1, 2].map(i => (
            <Skeleton key={i} className="h-10 w-full rounded-xl animate-pulse" />
          ))}
        </div>
        <Skeleton className="h-10 w-full rounded-lg animate-pulse" />
      </div>
    </div>
  )
}

const inputCls = "w-full bg-[#0f2a4a] border border-[#1e5080] rounded-lg px-3 py-2.5 text-sm text-[#f0f6ff] placeholder:text-[#6a96bb] focus:outline-none focus:ring-2 focus:ring-[#c8102e]/30 focus:border-[#c8102e] transition"
const labelCls = "block text-xs font-medium text-[#93b8d8] mb-1"

interface Semester {
  id: string
  name: string
  is_active: boolean
  created_at: string
}

export default function BookingSettingsTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [minDaysRoom, setMinDaysRoom] = useState(0)
  const [minDaysTabling, setMinDaysTabling] = useState(0)
  const [minHoursSpaces, setMinHoursSpaces] = useState(24)
  const [success, setSuccess] = useState(false)
  const [error, setError] = useState('')

  // Semester state
  const [semesters, setSemesters] = useState<Semester[]>([])
  const [semesterLoading, setSemesterLoading] = useState(true)
  const [newSemesterName, setNewSemesterName] = useState('')
  const [creatingState, setCreatingState] = useState<'idle' | 'saving' | 'error'>('idle')
  const [createError, setCreateError] = useState('')
  const [isVP, setIsVP] = useState(false)

  // Activate modal
  const [showActivateModal, setShowActivateModal] = useState(false)
  const [pendingActivateId, setPendingActivateId] = useState<string | null>(null)
  const [activating, setActivating] = useState(false)
  const [activateError, setActivateError] = useState('')

  // Delete modal
  const [showDeleteModal, setShowDeleteModal] = useState(false)
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState('')
  const [deletePermissionChecked, setDeletePermissionChecked] = useState(false)

  useEffect(() => {
    fetch('/api/administrator/settings')
      .then(r => r.json())
      .then(data => {
        setMinDaysRoom(data.min_days_advance_room ?? 0)
        setMinDaysTabling(data.min_days_advance_tabling ?? 0)
        setMinHoursSpaces(data.min_hours_advance_spaces ?? 24)
        setLoading(false)
      })

    fetchSemesters()

    // Check if current user is VP of Operational Affairs
    const supabase = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    )
    getAuthedUser(supabase).then((user) => {
      if (
        user?.app_metadata?.admin_role === 'Vice President of Operational Affairs' ||
        user?.app_metadata?.admin_role === 'Executive Vice President' ||
        user?.app_metadata?.admin_role === 'Information Manager'
      ) {
        setIsVP(true)
      }
    })
  }, [])

  const fetchSemesters = async () => {
    setSemesterLoading(true)
    const res = await fetch('/api/administrator/semesters')
    if (res.ok) {
      const data = await res.json()
      setSemesters(data.semesters || [])
    }
    setSemesterLoading(false)
  }

  const handleSave = async () => {
    setError('')
    setSuccess(false)
    setSaving(true)

    const res = await fetch('/api/administrator/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        min_days_advance_room: minDaysRoom,
        min_days_advance_tabling: minDaysTabling,
        min_hours_advance_spaces: minHoursSpaces,
      }),
    })

    if (res.ok) {
      setSuccess(true)
    } else {
      const data = await res.json()
      setError(data.error || 'Something went wrong.')
    }
    setSaving(false)
  }

  const handleCreateSemester = async () => {
    if (!newSemesterName.trim()) return
    setCreatingState('saving')
    setCreateError('')

    const res = await fetch('/api/administrator/semesters', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newSemesterName.trim() }),
    })

    if (res.ok) {
      setNewSemesterName('')
      setCreatingState('idle')
      fetchSemesters()
    } else {
      const data = await res.json()
      setCreateError(data.error || 'Something went wrong.')
      setCreatingState('error')
    }
  }

  const handleActivateConfirm = async () => {
    if (!pendingActivateId) return
    setActivating(true)
    setActivateError('')

    const res = await fetch('/api/administrator/semesters', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingActivateId }),
    })

    if (res.ok) {
      setShowActivateModal(false)
      setPendingActivateId(null)
      fetchSemesters()
    } else {
      const data = await res.json()
      setActivateError(data.error || 'Something went wrong.')
    }
    setActivating(false)
  }

  const handleDeleteConfirm = async () => {
    if (!pendingDeleteId) return
    setDeleting(true)
    setDeleteError('')

    const res = await fetch('/api/administrator/semesters', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: pendingDeleteId }),
    })

    if (res.ok) {
      setShowDeleteModal(false)
      setPendingDeleteId(null)
      fetchSemesters()
    } else {
      const data = await res.json()
      setDeleteError(data.error || 'Something went wrong.')
    }
    setDeleting(false)
  }

  if (loading) return <BookingSettingsTabSkeleton />

  return (
    <div className="max-w-sm space-y-8">
      {/* Advance Notice Requirements */}
      <div>
        <h2 className="text-sm font-semibold text-[#f0f6ff] mb-4">Advance Notice Requirements</h2>
        <div className="space-y-4">
          <div>
            <label className={labelCls}>Minimum Days Advance Notice — Room</label>
            <input
              type="number"
              min={0}
              value={minDaysRoom}
              onChange={e => { setSuccess(false); setMinDaysRoom(Math.max(0, parseInt(e.target.value) || 0)) }}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Minimum Days Advance Notice — Tabling</label>
            <input
              type="number"
              min={0}
              value={minDaysTabling}
              onChange={e => { setSuccess(false); setMinDaysTabling(Math.max(0, parseInt(e.target.value) || 0)) }}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>Minimum Hours Advance Notice — SGA Spaces</label>
            <input
              type="number"
              min={0}
              value={minHoursSpaces}
              onChange={e => { setSuccess(false); setMinHoursSpaces(Math.max(0, parseInt(e.target.value) || 0)) }}
              className={inputCls}
            />
          </div>
        </div>

        {error && <p className="text-[#c8102e] text-sm mt-3">{error}</p>}
        {success && <p className="text-green-400 text-sm mt-3">Settings saved.</p>}

        <button
          onClick={handleSave}
          disabled={saving}
          className="mt-4 px-5 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* Semester Management */}
      <div>
        <h2 className="text-sm font-semibold text-[#f0f6ff] mb-4">Semester Management</h2>

        {semesterLoading ? (
          <p className="text-[#93b8d8] text-sm">Loading semesters...</p>
        ) : (
          <div className="space-y-2 mb-4">
            {semesters.length === 0 && (
              <p className="text-[#6a96bb] text-sm">No semesters yet.</p>
            )}
            {semesters.map(sem => (
              <div key={sem.id} className="flex items-center justify-between border border-[#1e5080] rounded-lg px-3 py-2.5 bg-[#0f2a4a]">
                <div className="flex items-center gap-2.5">
                  <span className="text-sm text-[#f0f6ff]">{sem.name}</span>
                  {sem.is_active ? (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#0f3d20] text-[#4ade80]">Active</span>
                  ) : (
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#1e3a5f] text-[#6a96bb]">Inactive</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setPendingActivateId(sem.id); setActivateError(''); setShowActivateModal(true) }}
                    className="text-xs text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition-colors"
                  >
                    Activate
                  </button>
                  {isVP && (
                    <button
                      onClick={() => { setPendingDeleteId(sem.id); setDeleteError(''); setShowDeleteModal(true) }}
                      className="text-xs text-[#c8102e] hover:text-[#a00d24] font-medium transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Create semester form */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. Fall 2025"
            value={newSemesterName}
            onChange={e => { setNewSemesterName(e.target.value); setCreatingState('idle'); setCreateError('') }}
            onKeyDown={e => { if (e.key === 'Enter') handleCreateSemester() }}
            className={inputCls}
          />
          <button
            onClick={handleCreateSemester}
            disabled={creatingState === 'saving' || !newSemesterName.trim()}
            className="px-4 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50 whitespace-nowrap"
          >
            {creatingState === 'saving' ? 'Creating...' : 'Create'}
          </button>
        </div>
        {createError && <p className="text-[#c8102e] text-xs mt-1.5">{createError}</p>}
      </div>

      {/* Activate Modal */}
      {showActivateModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#184073] rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#f0f6ff]">Change Active Semester</h2>
              <button onClick={() => { setShowActivateModal(false); setPendingActivateId(null) }} className="text-[#6a96bb] hover:text-[#f0f6ff] text-lg leading-none transition-colors">✕</button>
            </div>
            <p className="text-sm text-[#f0f6ff] leading-relaxed">
              WARNING: You are about to change the active semester. New bookings will be created under the new semester name and previous bookings will be archived. Only make this change with permission from the Vice President of Operational Affairs.
            </p>
            {activateError && <p className="text-[#c8102e] text-sm">{activateError}</p>}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowActivateModal(false); setPendingActivateId(null) }}
                className="px-4 py-2 text-sm text-[#93b8d8] hover:text-[#f0f6ff] font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleActivateConfirm}
                disabled={activating}
                className="px-5 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-50"
              >
                {activating ? 'Activating...' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-[#2d0810] border border-[#c8102e]/40 rounded-2xl shadow-2xl w-full max-w-md p-8 space-y-5">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-[#ff6b6b]">Delete Semester</h2>
              <button onClick={() => { setShowDeleteModal(false); setPendingDeleteId(null); setDeletePermissionChecked(false) }} className="text-[#ff6b6b]/60 hover:text-[#ff6b6b] text-lg leading-none transition-colors">✕</button>
            </div>
            <p className="text-sm text-[#fca5a5] leading-relaxed">
              WARNING: This will permanently delete this semester and all bookings assigned to it. This is inconsistent with the rules of the POAF and cannot be undone. The Vice President of Operational Affairs MUST be consulted before completing this action.
            </p>
            <label className="flex items-start gap-3 cursor-pointer">
              <div className="relative mt-0.5 shrink-0">
                <input
                  type="checkbox"
                  checked={deletePermissionChecked}
                  onChange={e => setDeletePermissionChecked(e.target.checked)}
                  className="sr-only"
                />
                <div className={`h-4 w-4 rounded border-2 border-[#c8102e] transition-colors flex items-center justify-center ${deletePermissionChecked ? 'bg-[#c8102e]' : 'bg-transparent'}`}>
                  {deletePermissionChecked && (
                    <svg className="h-2.5 w-2.5 text-white" viewBox="0 0 10 8" fill="none">
                      <path d="M1 4l3 3 5-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  )}
                </div>
              </div>
              <span className="text-sm text-[#fca5a5] leading-snug">
                I have received permission from the Vice President of Operational Affairs to complete this action.
              </span>
            </label>
            {deletePermissionChecked && (
              <p className="text-xs text-[#ff6b6b]/70 leading-snug">
                Checking this box without express written permission from the VP may result in consequences up to and including impeachment/forcible removal from office.
              </p>
            )}
            {deleteError && <p className="text-[#ff6b6b] text-sm">{deleteError}</p>}
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => { setShowDeleteModal(false); setPendingDeleteId(null); setDeletePermissionChecked(false) }}
                className="px-4 py-2 text-sm text-[#fca5a5]/70 hover:text-[#fca5a5] font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={deleting || !deletePermissionChecked}
                className="px-5 py-2 bg-[#c8102e] hover:bg-[#a00d24] text-white text-sm rounded-lg font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {deleting ? 'Deleting...' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
