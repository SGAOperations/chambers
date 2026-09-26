'use client'

import { useState, useEffect } from 'react'
import type { ScopeBody, BookingScopeValue } from '@/app/_components/booking-scope-selector'
import type { Division } from '@/lib/booking-scope'

/**
 * Loads the bodies/divisions the caller may book for, from /api/request (the
 * same source the leadership request form and admin booking forms use). Shared
 * by the NUSSO room and tabling modals to feed the BookingScopeSelector.
 */
export function useScopeContext() {
  const [ownerBodies, setOwnerBodies] = useState<ScopeBody[]>([])
  const [allBodies, setAllBodies] = useState<ScopeBody[]>([])
  const [allowedDivisions, setAllowedDivisions] = useState<Division[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const res = await fetch('/api/request')
        if (!res.ok) throw new Error(`request ${res.status}`)
        const data = await res.json()
        if (!active) return
        setOwnerBodies(data.bodies ?? [])
        setAllBodies(data.allBodies ?? [])
        setAllowedDivisions(data.leadershipDivisions ?? [])
      } catch {
        if (active) setError(true)
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => { active = false }
  }, [])

  return { ownerBodies, allBodies, allowedDivisions, loading, error }
}

/** The empty scope selection a modal starts from. */
export const EMPTY_SCOPE: BookingScopeValue = { scope: 'single', body_id: '', division: null, body_ids: [] }

/** Whether a scope selection is complete enough to submit (server re-validates). */
export function isScopeComplete(v: BookingScopeValue): boolean {
  if (!v.body_id) return false
  if (v.scope === 'divisional') return !!v.division
  if (v.scope === 'multi') return v.body_ids.filter(id => id !== v.body_id).length > 0
  return true
}
