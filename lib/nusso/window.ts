import type { NussoTimeWindow } from './types'

/**
 * Build the time window EMS expects from a date and two clock times.
 *
 * EMS speaks Boston wall-clock strings with second precision and no offset
 * ("2026-09-27 21:00:00"), the same domain SGA Spaces stores in (see
 * lib/boston-time.ts). The UI hands us a date ("YYYY-MM-DD") and start/end as
 * "HH:mm"; this assembles the three strings the client and API need.
 */
export function buildWindow(date: string, startHHmm: string, endHHmm: string): NussoTimeWindow {
  const norm = (t: string) => (t.length === 5 ? `${t}:00` : t) // HH:mm -> HH:mm:ss
  return {
    date: `${date} 00:00:00`,
    start: `${date} ${norm(startHHmm)}`,
    end: `${date} ${norm(endHHmm)}`,
  }
}

/** True when the strings look like a same-day window with start before end. */
export function isValidWindow(date: string, startHHmm: string, endHHmm: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(startHHmm) || !/^\d{2}:\d{2}(:\d{2})?$/.test(endHHmm)) return false
  return startHHmm < endHHmm
}
