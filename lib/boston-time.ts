/**
 * "Now", in the domain SGA Spaces actually stores times in.
 *
 * That domain is unusual enough to be worth stating plainly, because nothing
 * names it: a space booking's start_time holds Boston wall-clock digits with a
 * Z on the end. A 6 PM booking is stored as T18:00:00.000Z whatever the offset
 * happens to be that month. The calendar builds slots that way (slotToIso sets
 * UTC hours straight from the slot index), the modal parses them back with
 * getUTCHours, and the confirmation email relies on it too -- see the note in
 * lib/emails/space-booking-confirmed.ts about UTC fields giving the right
 * local-time digits to pair with TZID=America/New_York.
 *
 * It is self-consistent as long as nothing compares those values against a real
 * instant. Two places did. The advance-notice check measured start_time against
 * Date.now(), so during EDT every booking looked four hours earlier than it was
 * and a two-hour requirement rejected anything less than six real hours out
 * (issue #87). remaining-hours derived its Sun-Sat window from real UTC, so
 * between 8 PM and midnight on a Saturday it counted against next week.
 *
 * Pinned to America/New_York rather than the server's clock: Vercel runs in UTC,
 * so reading local fields there would be the same bug with an extra step. The
 * offset is resolved by Intl for the given instant, so EDT and EST are both
 * handled without a table.
 */
export function bostonWallClockNow(at: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(at)

  const value = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find(p => p.type === type)
    return part ? Number(part.value) : 0
  }

  return new Date(Date.UTC(
    value('year'),
    value('month') - 1,
    value('day'),
    // hour12:false yields 24 for midnight in some ICU versions rather than 0,
    // which would roll the date forward a day.
    value('hour') % 24,
    value('minute'),
    value('second'),
  ))
}
