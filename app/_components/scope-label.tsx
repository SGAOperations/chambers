'use client'

import { useState } from 'react'
import { formatScopeLabel, type ScopedRow } from '@/lib/booking-scope'

interface Props {
  row: Pick<ScopedRow, 'body_id' | 'scope' | 'division'> & { bodies?: { name: string } | null }
  linkedBodies?: { id: string; name: string }[]
  className?: string
}

/**
 * Renders a booking's owning body for single scope, and the scope label for divisional/multi.
 * Multi expands to the full list on click; the hover title always carries it.
 */
export default function ScopeLabel({ row, linkedBodies = [], className = '' }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { short, full } = formatScopeLabel(row, linkedBodies)

  if (row.scope !== 'multi' || full.length < 2) {
    return (
      <span className={className} title={short}>
        {short}
      </span>
    )
  }

  return (
    <span className={className}>
      <button
        type="button"
        onClick={e => {
          e.stopPropagation()
          setExpanded(v => !v)
        }}
        title={full.join(', ')}
        className="text-left underline decoration-dotted underline-offset-2 hover:text-[#c8102e] transition-colors"
      >
        {expanded ? full[0] : short}
      </button>
      {expanded && (
        <span className="block text-xs text-[#6a96bb]">
          with {full.slice(1).join(', ')}
        </span>
      )}
    </span>
  )
}
