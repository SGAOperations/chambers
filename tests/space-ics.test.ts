import { describe, expect, it } from 'vitest'
import { buildSpaceSeriesCancelIcs, buildSpaceSeriesIcs } from '@/lib/emails/space-ics'
import { intervalFor } from '@/lib/space-series'

/** The value of `name` in each VEVENT of an .ics file, in order. */
function propertyOf(ics: Buffer, name: string): (string | undefined)[] {
  return ics
    .toString()
    .split('BEGIN:VEVENT')
    .slice(1)
    .map(event => event.split('\r\n').find(l => l.startsWith(`${name};`) || l.startsWith(`${name}:`)))
}

describe('buildSpaceSeriesCancelIcs', () => {
  // A Thursday series at 6:15 PM, stored as Boston wall-clock digits in UTC fields.
  const pattern = intervalFor('2026-11-12', '18:15:00', '19:30:00')

  it('carries the DTSTART and DTEND a CANCEL must have', () => {
    const ics = buildSpaceSeriesCancelIcs({ seriesId: 's1', ...toPattern(pattern) }, 7)
    expect(ics.toString()).toContain('METHOD:CANCEL')
    expect(propertyOf(ics, 'DTSTART')).toEqual(['DTSTART;TZID=America/New_York:20261112T181500'])
    expect(propertyOf(ics, 'DTEND')).toEqual(['DTEND;TZID=America/New_York:20261112T193000'])
  })

  it('names the same start as the master event its invite created', () => {
    const invite = buildSpaceSeriesIcs({
      seriesId: 's1',
      title: 'Office hours',
      spaceName: 'Curry 340',
      frequency: 'weekly',
      ...toPattern(pattern),
      count: 4,
      gaps: [],
      occurrences: [],
    }, 1)
    const cancel = buildSpaceSeriesCancelIcs({ seriesId: 's1', ...toPattern(pattern) }, 2)
    expect(propertyOf(cancel, 'UID')).toEqual([propertyOf(invite, 'UID')[0]])
    expect(propertyOf(cancel, 'DTSTART')).toEqual([propertyOf(invite, 'DTSTART')[0]])
  })
})

function toPattern(interval: { start: string; end: string }) {
  return { patternStart: interval.start, patternEnd: interval.end }
}
