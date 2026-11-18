import { describe, expect, it } from 'vitest'
import { BOOKING_STATUSES, MEETING_STATUSES, OPS_STATUSES, splitStatus } from '@/lib/booking-status'
import { createTestDb, migration, STATUS_SPLIT_MIGRATION, type TestDb } from './helpers/db'

/**
 * db/neon/0023_status_split.sql (issue #281): the meeting/ops split's columns,
 * the trigger that derives them from `status` until the writers set them, and
 * the backfill.
 */

type Pg = TestDb['pg']

interface Split { meeting_status: string | null; is_virtual: boolean | null; ops_status: string | null }

async function newBooking(pg: Pg, type = 'One-Time Room'): Promise<string> {
  const { rows: [body] } = await pg.query<{ id: string }>(
    `insert into public.bodies (name, division) values ('B ' || gen_random_uuid(), 'Senate') returning id`
  )
  const { rows: [b] } = await pg.query<{ id: string }>(
    `insert into public.bookings (body_id, type, purpose) values ($1, $2, 'Meeting') returning id`,
    [body.id, type]
  )
  return b.id
}

async function oneTime(pg: Pg, bookingId: string, status: string | null, date = '2026-12-01'): Promise<string> {
  const { rows: [r] } = await pg.query<{ id: string }>(
    `insert into public.one_time_room_bookings (booking_id, room_name, booking_date, start_time, end_time, status)
     values ($1, 'Curry 318', $2, '18:00', '19:00', $3) returning id`,
    [bookingId, date, status]
  )
  return r.id
}

async function weekly(pg: Pg, bookingId: string, status: string | null): Promise<string> {
  const { rows: [r] } = await pg.query<{ id: string }>(
    `insert into public.weekly_room_bookings (booking_id, room_name, start_date, end_date, start_time, end_time, status)
     values ($1, 'Curry 318', '2026-09-01', '2026-12-15', '18:00', '19:00', $2) returning id`,
    [bookingId, status]
  )
  return r.id
}

async function occurrence(pg: Pg, weeklyId: string, date: string, status: string | null): Promise<string> {
  const { rows: [r] } = await pg.query<{ id: string }>(
    `insert into public.weekly_room_occurrences (weekly_booking_id, occurrence_date, status)
     values ($1, $2, $3) returning id`,
    [weeklyId, date, status]
  )
  return r.id
}

async function tablingSession(pg: Pg, bookingId: string, status: string, date = '2026-12-01'): Promise<string> {
  const { rows: [tb] } = await pg.query<{ id: string }>(
    `insert into public.tabling_bookings (booking_id) values ($1) returning id`, [bookingId]
  )
  const { rows: [r] } = await pg.query<{ id: string }>(
    `insert into public.tabling_sessions (tabling_booking_id, location, session_date, start_time, end_time, status)
     values ($1, 'Curry Lobby', $2, '10:00', '12:00', $3) returning id`,
    [tb.id, date, status]
  )
  return r.id
}

async function request(pg: Pg, fields: {
  booking_id: string
  scope: 'occurrence' | 'series'
  cancellation_type: 'Cancellation' | 'Virtual'
  occurrence_id?: string
  occurrence_date?: string
  status?: string
  created_at?: string
}) {
  await pg.query(
    `insert into public.cancellation_requests (booking_id, scope, cancellation_type, occurrence_id, occurrence_date, status, created_at)
     values ($1, $2, $3, $4, $5, coalesce($6, 'Pending'), coalesce($7::timestamptz, now()))`,
    [fields.booking_id, fields.scope, fields.cancellation_type, fields.occurrence_id ?? null,
      fields.occurrence_date ?? null, fields.status ?? null, fields.created_at ?? null]
  )
}

async function splitOf(pg: Pg, table: string, id: string): Promise<Split> {
  const { rows: [r] } = await pg.query<Split>(
    `select meeting_status, is_virtual, ops_status from public.${table} where id = $1`, [id]
  )
  return r
}

const asRow = (s: ReturnType<typeof splitStatus>): Split =>
  ({ meeting_status: s.meetingStatus, is_virtual: s.isVirtual, ops_status: s.opsStatus })

describe('status_split_of', () => {
  it('agrees with splitStatus() on every status, with and without a Virtual request', async () => {
    const { pg } = await createTestDb()
    for (const status of [...BOOKING_STATUSES, null]) {
      for (const type of [null, 'Cancellation', 'Virtual']) {
        const { rows: [r] } = await pg.query<Split>(
          'select * from public.status_split_of($1, $2)', [status, type]
        )
        expect(r, `${status} / ${type}`).toEqual(asRow(splitStatus(status, type)))
      }
    }
  })

  it('maps every old status as the epic says', () => {
    const table = Object.fromEntries(BOOKING_STATUSES.map(s => [s, splitStatus(s)]))
    expect(table).toEqual({
      'Reserved': { meetingStatus: 'Scheduled', isVirtual: false, opsStatus: 'Reserved' },
      'Alternate Room': { meetingStatus: 'Alternate Room', isVirtual: false, opsStatus: 'Reserved' },
      'Alternate Time': { meetingStatus: 'Alternate Time', isVirtual: false, opsStatus: 'Reserved' },
      'Alternate Room and Time': { meetingStatus: 'Alternate Room and Time', isVirtual: false, opsStatus: 'Reserved' },
      'Waitlisted': { meetingStatus: 'Scheduled', isVirtual: false, opsStatus: 'Waitlisted' },
      'Unavailable': { meetingStatus: null, isVirtual: false, opsStatus: 'Unavailable' },
      'Pending Cancellation': { meetingStatus: 'Cancelled', isVirtual: false, opsStatus: 'Pending Cancellation' },
      'Cancelled': { meetingStatus: 'Cancelled', isVirtual: false, opsStatus: 'Cancelled' },
      'Virtual': { meetingStatus: 'Scheduled', isVirtual: true, opsStatus: 'Cancelled' },
      'Missed': { meetingStatus: null, isVirtual: false, opsStatus: 'Missed' },
      'Repurposed': { meetingStatus: null, isVirtual: false, opsStatus: 'Repurposed' },
      'Tentative': { meetingStatus: 'Tentative', isVirtual: false, opsStatus: 'Tentative' },
    })
    expect(splitStatus('Pending Cancellation', 'Virtual'))
      .toEqual({ meetingStatus: 'Scheduled', isVirtual: true, opsStatus: 'Pending Cancellation' })
  })
})

describe('CHECK constraints', () => {
  it('match MEETING_STATUSES and OPS_STATUSES on all four tables', async () => {
    const { pg } = await createTestDb()
    const { rows } = await pg.query<{ conname: string; def: string }>(
      `select conname, pg_get_constraintdef(oid) as def from pg_constraint
        where conname like '%\\_meeting\\_status\\_check' or conname like '%\\_ops\\_status\\_check'`
    )
    const tables = ['one_time_room_bookings', 'weekly_room_bookings', 'weekly_room_occurrences', 'tabling_sessions']
    for (const t of tables) {
      for (const [col, list] of [['meeting_status', MEETING_STATUSES], ['ops_status', OPS_STATUSES]] as const) {
        const def = rows.find(r => r.conname === `${t}_${col}_check`)?.def
        expect(def, `${t}.${col}`).toBeDefined()
        expect([...def!.matchAll(/'([^']+)'::text/g)].map(m => m[1]), `${t}.${col}`).toEqual([...list])
      }
    }
  })
})

describe('backfill', () => {
  it('derives every row that existed before the migration, and leaves status alone', async () => {
    const { pg } = await createTestDb([], { statusSplit: false })
    const booking = await newBooking(pg)
    const ids: Record<string, string> = {}
    for (const [i, s] of BOOKING_STATUSES.entries()) {
      ids[s] = await oneTime(pg, booking, s, `2026-12-${String(i + 1).padStart(2, '0')}`)
    }
    const series = await weekly(pg, await newBooking(pg, 'Weekly Room'), 'Virtual')
    const inherits = await occurrence(pg, series, '2026-10-06', null)
    const overrides = await occurrence(pg, series, '2026-10-13', 'Missed')

    await pg.exec(migration(STATUS_SPLIT_MIGRATION))

    for (const s of BOOKING_STATUSES) {
      expect(await splitOf(pg, 'one_time_room_bookings', ids[s]), s).toEqual(asRow(splitStatus(s)))
    }
    const { rows } = await pg.query<{ status: string }>(
      'select status from public.one_time_room_bookings order by booking_date'
    )
    expect(rows.map(r => r.status)).toEqual([...BOOKING_STATUSES])

    expect(await splitOf(pg, 'weekly_room_bookings', series))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: true, ops_status: 'Cancelled' })
    // A week with no status of its own keeps inheriting, separately per column.
    expect(await splitOf(pg, 'weekly_room_occurrences', inherits))
      .toEqual({ meeting_status: null, is_virtual: null, ops_status: null })
    expect(await splitOf(pg, 'weekly_room_occurrences', overrides))
      .toEqual({ meeting_status: null, is_virtual: false, ops_status: 'Missed' })
  })

  it('reads a Pending Cancellation from the request behind it', async () => {
    const { pg } = await createTestDb([], { statusSplit: false })
    const booking = await newBooking(pg)
    const goingVirtual = await oneTime(pg, booking, 'Pending Cancellation', '2026-12-01')
    const cancelling = await oneTime(pg, booking, 'Pending Cancellation', '2026-12-08')
    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Virtual', occurrence_date: '2026-12-01' })
    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Cancellation', occurrence_date: '2026-12-08' })

    await pg.exec(migration(STATUS_SPLIT_MIGRATION))

    expect(await splitOf(pg, 'one_time_room_bookings', goingVirtual))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: true, ops_status: 'Pending Cancellation' })
    expect(await splitOf(pg, 'one_time_room_bookings', cancelling))
      .toEqual({ meeting_status: 'Cancelled', is_virtual: false, ops_status: 'Pending Cancellation' })
  })

  it('is safe to run twice', async () => {
    const { pg } = await createTestDb()
    const id = await oneTime(pg, await newBooking(pg), 'Waitlisted')
    await pg.exec(migration(STATUS_SPLIT_MIGRATION))
    expect(await splitOf(pg, 'one_time_room_bookings', id))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: false, ops_status: 'Waitlisted' })
  })
})

describe('trigger', () => {
  it('derives the columns on insert, ignoring what the insert sent', async () => {
    const { pg } = await createTestDb()
    const booking = await newBooking(pg)
    const { rows: [r] } = await pg.query<{ id: string }>(
      `insert into public.one_time_room_bookings (booking_id, room_name, booking_date, start_time, end_time, status, meeting_status, ops_status)
       values ($1, 'Curry 318', '2026-12-01', '18:00', '19:00', 'Waitlisted', 'Cancelled', 'Missed') returning id`,
      [booking]
    )
    expect(await splitOf(pg, 'one_time_room_bookings', r.id))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: false, ops_status: 'Waitlisted' })
  })

  it('follows every write to status, and only those', async () => {
    const { pg } = await createTestDb()
    const id = await oneTime(pg, await newBooking(pg), 'Reserved')

    await pg.query(`update public.one_time_room_bookings set status = 'Virtual' where id = $1`, [id])
    expect(await splitOf(pg, 'one_time_room_bookings', id))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: true, ops_status: 'Cancelled' })

    // An edit that does not touch status leaves the derived columns alone.
    await pg.query(`update public.one_time_room_bookings set room_name = 'Curry 333' where id = $1`, [id])
    expect(await splitOf(pg, 'one_time_room_bookings', id))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: true, ops_status: 'Cancelled' })
  })

  it('covers the series row, its weeks and tabling sessions', async () => {
    const { pg } = await createTestDb()
    const series = await weekly(pg, await newBooking(pg, 'Weekly Room'), 'Reserved')
    const week = await occurrence(pg, series, '2026-10-06', null)
    expect(await splitOf(pg, 'weekly_room_bookings', series))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: false, ops_status: 'Reserved' })
    expect(await splitOf(pg, 'weekly_room_occurrences', week))
      .toEqual({ meeting_status: null, is_virtual: null, ops_status: null })

    await pg.query(`update public.weekly_room_occurrences set status = 'Alternate Room' where id = $1`, [week])
    expect(await splitOf(pg, 'weekly_room_occurrences', week))
      .toEqual({ meeting_status: 'Alternate Room', is_virtual: false, ops_status: 'Reserved' })
    // Clearing the override goes back to inheriting.
    await pg.query(`update public.weekly_room_occurrences set status = null where id = $1`, [week])
    expect(await splitOf(pg, 'weekly_room_occurrences', week))
      .toEqual({ meeting_status: null, is_virtual: null, ops_status: null })

    const session = await tablingSession(pg, await newBooking(pg, 'Tabling'), 'Tentative')
    expect(await splitOf(pg, 'tabling_sessions', session))
      .toEqual({ meeting_status: 'Tentative', is_virtual: false, ops_status: 'Tentative' })
  })
})

describe('matching a Pending Cancellation to its request', () => {
  // The order lib/pending-cancellations.ts collectPending() uses, case by case.

  it('one-time: a request naming the date beats one elsewhere on the booking', async () => {
    const { pg } = await createTestDb()
    const booking = await newBooking(pg)
    const id = await oneTime(pg, booking, 'Reserved', '2026-12-01')
    await request(pg, { booking_id: booking, scope: 'series', cancellation_type: 'Cancellation', created_at: '2026-11-02' })
    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Virtual', occurrence_date: '2026-12-01', created_at: '2026-11-01' })
    await pg.query(`update public.one_time_room_bookings set status = 'Pending Cancellation' where id = $1`, [id])
    expect((await splitOf(pg, 'one_time_room_bookings', id)).is_virtual).toBe(true)
  })

  it('one-time: falls back to any request on the booking', async () => {
    const { pg } = await createTestDb()
    const booking = await newBooking(pg)
    const id = await oneTime(pg, booking, 'Reserved', '2026-12-01')
    await request(pg, { booking_id: booking, scope: 'series', cancellation_type: 'Virtual' })
    await pg.query(`update public.one_time_room_bookings set status = 'Pending Cancellation' where id = $1`, [id])
    expect((await splitOf(pg, 'one_time_room_bookings', id)).is_virtual).toBe(true)
  })

  it('a Pending request beats a newer resolved one', async () => {
    const { pg } = await createTestDb()
    const booking = await newBooking(pg)
    const id = await oneTime(pg, booking, 'Reserved', '2026-12-01')
    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Virtual', occurrence_date: '2026-12-01', created_at: '2026-11-01' })
    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Cancellation', occurrence_date: '2026-12-01', status: 'Dismissed', created_at: '2026-11-05' })
    await pg.query(`update public.one_time_room_bookings set status = 'Pending Cancellation' where id = $1`, [id])
    expect((await splitOf(pg, 'one_time_room_bookings', id)).is_virtual).toBe(true)
  })

  it('a week: its own row, then its date, then a series request; never another week', async () => {
    const { pg } = await createTestDb()
    const booking = await newBooking(pg, 'Weekly Room')
    const series = await weekly(pg, booking, 'Reserved')
    const byId = await occurrence(pg, series, '2026-10-06', null)
    const byDate = await occurrence(pg, series, '2026-10-13', null)
    const bySeries = await occurrence(pg, series, '2026-10-20', null)

    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Virtual', occurrence_id: byId })
    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Virtual', occurrence_date: '2026-10-13' })
    await pg.query(
      `update public.weekly_room_occurrences set status = 'Pending Cancellation' where id = any($1::uuid[])`,
      [[byId, byDate, bySeries]]
    )
    expect((await splitOf(pg, 'weekly_room_occurrences', byId)).is_virtual).toBe(true)
    expect((await splitOf(pg, 'weekly_room_occurrences', byDate)).is_virtual).toBe(true)
    // The two Virtual requests name other weeks, so this one is a cancellation.
    expect(await splitOf(pg, 'weekly_room_occurrences', bySeries))
      .toEqual({ meeting_status: 'Cancelled', is_virtual: false, ops_status: 'Pending Cancellation' })

    await request(pg, { booking_id: booking, scope: 'series', cancellation_type: 'Virtual' })
    await pg.query(`update public.weekly_room_occurrences set status = 'Pending Cancellation' where id = $1`, [bySeries])
    expect((await splitOf(pg, 'weekly_room_occurrences', bySeries)).is_virtual).toBe(true)
  })

  it('a series row reads a series request', async () => {
    const { pg } = await createTestDb()
    const booking = await newBooking(pg, 'Weekly Room')
    const series = await weekly(pg, booking, 'Reserved')
    await request(pg, { booking_id: booking, scope: 'series', cancellation_type: 'Virtual' })
    await pg.query(`update public.weekly_room_bookings set status = 'Pending Cancellation' where id = $1`, [series])
    expect(await splitOf(pg, 'weekly_room_bookings', series))
      .toEqual({ meeting_status: 'Scheduled', is_virtual: true, ops_status: 'Pending Cancellation' })
  })

  it('a tabling session reads its booking through tabling_bookings', async () => {
    const { pg } = await createTestDb()
    const booking = await newBooking(pg, 'Tabling')
    await request(pg, { booking_id: booking, scope: 'occurrence', cancellation_type: 'Virtual', occurrence_date: '2026-12-01' })
    const session = await tablingSession(pg, booking, 'Pending Cancellation', '2026-12-01')
    expect((await splitOf(pg, 'tabling_sessions', session)).is_virtual).toBe(true)
  })
})
