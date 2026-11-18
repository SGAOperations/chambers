import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  BOOKING_STATUSES,
  DEFAULT_STATUS,
  PENDING_CANCELLATION,
  STATUS_DEFINITIONS,
  calendarStateOf,
  hasAlternateRoom,
  hasAlternateTime,
  holdsRoom,
  isCancellable,
  isCancelled,
  isDisplayed,
  isGone,
  isNussoSettled,
  isReminded,
  isRevisable,
  isVirtual,
  resolveOccurrenceStatus,
  statusBarClasses,
  statusCardClasses,
  statusCellHex,
  statusPillClasses,
  statusTextClasses,
  type BookingStatus,
} from '@/lib/booking-status'

/**
 * The rules in lib/booking-status.ts, pinned status by status (issue #280).
 *
 * Each rule is written out as the exact set of statuses it accepts, rather than
 * tested with a few examples, so moving a status into or out of a rule -- which
 * is what the meeting/room split (#279) will do -- shows up here as a deliberate
 * edit and nowhere else.
 */

/** The statuses for which `rule` is true, in BOOKING_STATUSES order. */
function accepted(rule: (s: string) => boolean): BookingStatus[] {
  return BOOKING_STATUSES.filter(s => rule(s))
}

const UNKNOWN = 'Some Status Added Later'

describe('BOOKING_STATUSES', () => {
  it('matches every status CHECK constraint in the baseline schema, in order', () => {
    const sql = readFileSync(
      fileURLToPath(new URL('../db/neon/0001_baseline.sql', import.meta.url)),
      'utf8'
    )
    const tables = ['one_time_room_bookings', 'weekly_room_bookings', 'weekly_room_occurrences', 'tabling_sessions']
    for (const table of tables) {
      const match = sql.match(new RegExp(`constraint ${table}_status_check CHECK \\(\\(status = ANY \\(ARRAY\\[([^\\]]+)\\]`))
      expect(match, table).not.toBeNull()
      const values = [...match![1].matchAll(/'([^']+)'::text/g)].map(m => m[1])
      expect(values, table).toEqual([...BOOKING_STATUSES])
    }
  })

  it('names its default and pending statuses from the list', () => {
    expect(BOOKING_STATUSES).toContain(DEFAULT_STATUS)
    expect(BOOKING_STATUSES).toContain(PENDING_CANCELLATION)
  })
})

describe('resolveOccurrenceStatus', () => {
  it("prefers the occurrence's own status", () => {
    expect(resolveOccurrenceStatus('Virtual', 'Reserved')).toBe('Virtual')
  })

  it('inherits the series when the occurrence is null or undefined', () => {
    expect(resolveOccurrenceStatus(null, 'Reserved')).toBe('Reserved')
    expect(resolveOccurrenceStatus(undefined, 'Tentative')).toBe('Tentative')
  })

  it('is null when neither has one', () => {
    expect(resolveOccurrenceStatus(null, null)).toBeNull()
  })
})

describe('rules', () => {
  it('holdsRoom: the booking as made or as moved, not Virtual', () => {
    expect(accepted(holdsRoom)).toEqual(['Reserved', 'Alternate Room', 'Alternate Time', 'Alternate Room and Time'])
    expect(holdsRoom(null)).toBe(false)
    expect(holdsRoom(UNKNOWN)).toBe(false)
  })

  it('calendarStateOf: confirmed, tentative, leave or off for every status', () => {
    expect(Object.fromEntries(BOOKING_STATUSES.map(s => [s, calendarStateOf(s)]))).toEqual({
      'Reserved': 'confirmed',
      'Alternate Room': 'confirmed',
      'Alternate Time': 'confirmed',
      'Alternate Room and Time': 'confirmed',
      'Waitlisted': 'off',
      'Unavailable': 'off',
      'Pending Cancellation': 'leave',
      'Cancelled': 'off',
      'Virtual': 'confirmed',
      'Missed': 'off',
      'Repurposed': 'off',
      'Tentative': 'tentative',
    })
    expect(calendarStateOf(null)).toBe('off')
    expect(calendarStateOf(undefined)).toBe('off')
    expect(calendarStateOf(UNKNOWN)).toBe('off')
  })

  it('isReminded: the meeting-is-on statuses plus Cancelled, nothing unknown', () => {
    expect(accepted(isReminded)).toEqual([
      'Reserved', 'Alternate Room', 'Alternate Time', 'Alternate Room and Time', 'Cancelled', 'Virtual',
    ])
    expect(isReminded(null)).toBe(false)
    expect(isReminded(UNKNOWN)).toBe(false)
  })

  it('isDisplayed: the same statuses the reminder is written for', () => {
    expect(accepted(isDisplayed)).toEqual(accepted(isReminded))
    expect(isDisplayed(UNKNOWN)).toBe(false)
  })

  it('hasAlternateRoom and hasAlternateTime', () => {
    expect(accepted(hasAlternateRoom)).toEqual(['Alternate Room', 'Alternate Room and Time'])
    expect(accepted(hasAlternateTime)).toEqual(['Alternate Time', 'Alternate Room and Time'])
  })

  it('isVirtual and isCancelled', () => {
    expect(accepted(isVirtual)).toEqual(['Virtual'])
    expect(accepted(isCancelled)).toEqual(['Cancelled'])
    expect(isVirtual(null)).toBe(false)
    expect(isCancelled(undefined)).toBe(false)
  })

  it('isCancellable: everything but an open request, Cancelled and Virtual, including unknowns', () => {
    expect(accepted(s => !isCancellable(s))).toEqual(['Pending Cancellation', 'Cancelled', 'Virtual'])
    expect(isCancellable(UNKNOWN)).toBe(true)
    expect(isCancellable(null)).toBe(true)
  })

  it('isRevisable: everything but Cancelled, Missed and Repurposed, including unknowns', () => {
    expect(accepted(s => !isRevisable(s))).toEqual(['Cancelled', 'Missed', 'Repurposed'])
    expect(isRevisable(UNKNOWN)).toBe(true)
    expect(isRevisable(null)).toBe(true)
  })

  it('isNussoSettled: what a NUSSO release lands on', () => {
    expect(accepted(isNussoSettled)).toEqual(['Cancelled', 'Virtual'])
    expect(isNussoSettled(null)).toBe(false)
  })

  it('isGone: not a booking the Call for Programs offers to renew', () => {
    expect(accepted(isGone)).toEqual(['Unavailable', 'Cancelled'])
    expect(isGone(null)).toBe(false)
  })
})

describe('colours and glossary', () => {
  const maps = { statusCardClasses, statusBarClasses, statusTextClasses, statusPillClasses, statusCellHex, STATUS_DEFINITIONS }

  it.each(Object.entries(maps))('%s covers exactly the status list', (_name, map) => {
    expect(Object.keys(map)).toEqual([...BOOKING_STATUSES])
  })

  it('says no reminder is posted exactly where none is', () => {
    for (const s of BOOKING_STATUSES) {
      const { action } = STATUS_DEFINITIONS[s]
      if (/no meeting reminder/i.test(action)) expect(isReminded(s), s).toBe(false)
    }
  })

  it('describes Pending Cancellation as settling to what a release lands on', () => {
    const { action } = STATUS_DEFINITIONS[PENDING_CANCELLATION]
    for (const s of accepted(isNussoSettled)) expect(action).toContain(s)
  })
})
