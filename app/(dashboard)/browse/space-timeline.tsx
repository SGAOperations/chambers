'use client'

import type { ReactNode } from 'react'

/**
 * The day-at-a-glance grid the Browse/Book page draws for every room, whichever
 * system the room's bookings come from. Rows are grouped by building; each row
 * is one room with its booked blocks shaded along a 7am-11pm track.
 *
 * Minutes throughout are minutes after Boston midnight on the day shown.
 */

export const DAY_START = 7 * 60
export const DAY_END = 23 * 60
const SPAN = DAY_END - DAY_START
const HOURS = Array.from({ length: (DAY_END - DAY_START) / 60 + 1 }, (_, i) => DAY_START / 60 + i)

export interface TimelineBlock {
  key: string
  startMinute: number
  endMinute: number
  /** Shown inside the block when there is room, and always in its tooltip. */
  title: string | null
}

export interface TimelineRow {
  key: string
  name: string
  detail: string
  blocks: TimelineBlock[]
  /** A room-specific warning, e.g. "permanent setup". */
  alert?: string | null
  /** Drawn at the end of the row, e.g. a Book button. */
  action?: ReactNode
}

export interface TimelineGroup {
  key: string
  heading: string
  /** Which system the group's rooms are booked through. */
  source: string
  rows: TimelineRow[]
}

export function formatMinute(minute: number): string {
  const h = Math.floor(minute / 60) % 24
  const m = minute % 60
  const suffix = h < 12 ? 'am' : 'pm'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return m ? `${h12}:${String(m).padStart(2, '0')}${suffix}` : `${h12}${suffix}`
}

function hourLabel(hour: number): string {
  const h12 = hour % 12 === 0 ? 12 : hour % 12
  return `${h12}${hour < 12 ? 'a' : 'p'}`
}

/** Percent along the track for a minute of the day, held to its edges. */
function pct(minute: number): number {
  return (Math.min(Math.max(minute, DAY_START), DAY_END) - DAY_START) / SPAN * 100
}

export default function SpaceTimeline({
  groups,
  nowMinute,
  window,
}: {
  groups: TimelineGroup[]
  /** Draws the current-time line; null on any day but today. */
  nowMinute: number | null
  /** The window being booked, highlighted on every row in Book mode. */
  window?: { startMinute: number; endMinute: number } | null
}) {
  return (
    <div className="space-y-5">
      {groups.map(group => (
        <section key={group.key}>
          <h2 className="text-sm font-semibold text-[#93b8d8] mb-2 sticky top-0 z-20 bg-gradient-to-r from-[#0a1628] to-transparent py-1 flex items-center gap-2">
            {group.heading}
            <span className="text-[10px] font-medium uppercase tracking-wide text-[#6a96bb] border border-[#1e5080] rounded px-1.5 py-px">
              {group.source}
            </span>
          </h2>
          <div className="overflow-x-auto rounded-lg border border-[#1e5080] bg-[#0f2a4a]">
            <div className="min-w-[640px]">
              <div className="flex border-b border-[#1e5080] text-[10px] text-[#6a96bb]">
                <div className="w-32 flex-shrink-0" />
                <div className="relative flex-1 h-5 mr-3">
                  {HOURS.slice(1, -1).map(h => (
                    <span key={h} className="absolute top-1 -translate-x-1/2" style={{ left: `${pct(h * 60)}%` }}>
                      {hourLabel(h)}
                    </span>
                  ))}
                </div>
                {group.rows.some(r => r.action) && <div className="w-20 flex-shrink-0 sticky right-0 bg-[#0f2a4a]" />}
              </div>
              {group.rows.map(row => (
                <div key={row.key} className="flex items-center border-b border-[#1e5080]/50 last:border-b-0">
                  <div className="w-32 flex-shrink-0 px-3 py-2 min-w-0">
                    <p className="text-sm text-[#f0f6ff] font-medium leading-tight truncate" title={row.name}>{row.name}</p>
                    <p className="text-[11px] text-[#6a96bb] leading-tight truncate">{row.detail}</p>
                    {row.alert && (
                      <p className="text-[11px] text-amber-300/90 leading-tight truncate" title={row.alert}>⚠ {row.alert}</p>
                    )}
                  </div>
                  <div className="relative flex-1 h-8 mr-3 rounded bg-[#0a1628]">
                    {HOURS.slice(1, -1).map(h => (
                      <span key={h} className="absolute inset-y-0 w-px bg-[#1e5080]/40" style={{ left: `${pct(h * 60)}%` }} />
                    ))}
                    {window && window.endMinute > window.startMinute && (
                      <span
                        className="absolute inset-y-0 bg-emerald-400/15 border-x border-emerald-400/70"
                        style={{ left: `${pct(window.startMinute)}%`, width: `${pct(window.endMinute) - pct(window.startMinute)}%` }}
                      />
                    )}
                    {row.blocks
                      .filter(b => b.endMinute > DAY_START && b.startMinute < DAY_END)
                      .map(b => {
                        const label = `${formatMinute(b.startMinute)}–${formatMinute(b.endMinute)} · ${b.title ?? 'Private booking'}`
                        return (
                          <div
                            key={b.key}
                            title={label}
                            aria-label={label}
                            className="absolute inset-y-1 rounded-sm bg-[#c8102e]/80 border border-[#c8102e] overflow-hidden"
                            style={{ left: `${pct(b.startMinute)}%`, width: `${pct(b.endMinute) - pct(b.startMinute)}%` }}
                          >
                            {b.title && <span className="block truncate px-1 text-[10px] leading-[22px] text-white">{b.title}</span>}
                          </div>
                        )
                      })}
                    {nowMinute !== null && nowMinute >= DAY_START && nowMinute <= DAY_END && (
                      <span className="absolute -inset-y-0.5 w-0.5 bg-amber-300 z-10" style={{ left: `${pct(nowMinute)}%` }} />
                    )}
                  </div>
                  {/*
                    Pinned to the right edge: in a narrow window the track scrolls
                    sideways, and the button is the one thing on the row that has
                    to stay reachable.
                  */}
                  {row.action !== undefined && (
                    <div className="w-20 flex-shrink-0 pr-3 flex justify-end self-stretch items-center sticky right-0 z-10 bg-[#0f2a4a]">{row.action}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </section>
      ))}
    </div>
  )
}
