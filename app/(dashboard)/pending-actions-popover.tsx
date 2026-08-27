'use client'

import type { PendingAction, Severity } from '@/lib/pending-actions'

const DOT: Record<Severity, string> = {
  regular: 'bg-[#4285f4]',
  warning: 'bg-[#fbbf24]',
  danger: 'bg-[#c8102e]',
}

const RANK: Record<Severity, number> = { danger: 0, warning: 1, regular: 2 }

/**
 * The hover breakdown of the sidebar "Pending Actions" total (issue #38 #4):
 * every outstanding action, most severe first, each with a severity dot.
 */
export default function PendingActionsPopover({ actions }: { actions: PendingAction[] }) {
  const sorted = [...actions].sort(
    (a, b) => RANK[a.severity] - RANK[b.severity] || a.label.localeCompare(b.label)
  )

  return (
    <div className="w-72 max-h-[60vh] overflow-y-auto rounded-xl border border-white/10 bg-[#0a1628] p-2 shadow-2xl">
      {sorted.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-slate-500">Nothing pending.</p>
      ) : (
        <ul className="space-y-0.5">
          {sorted.map(a => (
            <li key={a.id} className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-white/5">
              <span
                className={`mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full ${DOT[a.severity]} ${
                  a.severity === 'danger' ? 'pa-dot-danger' : ''
                }`}
              />
              <span className="text-xs leading-snug text-slate-300">{a.label}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
