import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createTestDb, type TestDb } from './helpers/db'

// lib/seat-removal.ts and lib/position-sync.ts talk to Postgres through
// lib/db/pool.ts; point that at the in-process database for each test.
const holder: { db: TestDb | null } = { db: null }
vi.mock('@/lib/db/pool', () => ({
  pool: {
    query: (text: string, params?: unknown[]) => holder.db!.pool.query(text, params),
    connect: () => holder.db!.pool.connect(),
  },
}))

type Sent = {
  to: string[]
  removedBodies: string[]
  summary: string
  sessions: { date: string }[]
  attachments: { filename: string; content: Buffer; contentType: string }[]
}
const sent: Sent[] = []
vi.mock('@/lib/emails/seat-removed', () => ({
  sendSeatRemovedEmail: async (params: Sent) => {
    sent.push(params)
  },
}))

const { clearPositionSyncMemo, syncPositions } = await import('@/lib/position-sync')
const { notifyRemovedSeats } = await import('@/lib/seat-removal')

const BODIES = [
  { name: 'Senate', division: 'Senate' },
  { name: 'Appeals Board', division: 'Office of the President' },
  { name: 'Student Organization Finance Board', division: 'Student Involvement' },
  { name: 'Student Organization Approvals Board', division: 'Student Involvement' },
]

const TODAY = '2026-11-04'
const pos = (...keys: string[]) => keys.map(key => ({ key, name: key }))

describe('notifyRemovedSeats', () => {
  let db: TestDb
  let semesterId: string

  beforeEach(async () => {
    db = await createTestDb(BODIES)
    holder.db = db
    clearPositionSyncMemo()
    sent.length = 0
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into public.semesters (name, is_active) values ('Fall 2026', true) returning id`
    )
    semesterId = rows[0].id
  })

  async function booking(
    body: string,
    type: 'One-Time Room' | 'Weekly Room',
    fields: { hidden?: boolean; scope?: string; division?: string; purpose?: string; linked?: string[] } = {}
  ): Promise<string> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into public.bookings (body_id, type, purpose, semester_id, hidden, scope, division)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [
        db.bodyIds.get(body), type, fields.purpose ?? 'Weekly Meeting', semesterId,
        fields.hidden ?? false, fields.scope ?? 'single', fields.division ?? null,
      ]
    )
    const id = rows[0].id
    for (const other of fields.linked ?? []) {
      await db.pg.query('insert into public.booking_bodies (booking_id, body_id) values ($1, $2)', [id, db.bodyIds.get(other)])
    }
    return id
  }

  async function weekly(bookingId: string, dates: { date: string; status?: string; senateType?: string }[]): Promise<string> {
    const { rows } = await db.pg.query<{ id: string }>(
      `insert into public.weekly_room_bookings (booking_id, room_name, start_date, end_date, start_time, end_time)
       values ($1, 'Curry 344', $2, $3, '18:00', '19:00') returning id`,
      [bookingId, dates[0].date, dates[dates.length - 1].date]
    )
    for (const d of dates) {
      await db.pg.query(
        `insert into public.weekly_room_occurrences (weekly_booking_id, occurrence_date, status, senate_type) values ($1, $2, $3, $4)`,
        [rows[0].id, d.date, d.status ?? null, d.senateType ?? null]
      )
    }
    return rows[0].id
  }

  async function oneTime(bookingId: string, dates: string[]) {
    for (const date of dates) {
      await db.pg.query(
        `insert into public.one_time_room_bookings (booking_id, room_name, booking_date, start_time, end_time)
         values ($1, 'Snell 001', $2, '12:00', '13:00')`,
        [bookingId, date]
      )
    }
  }

  /** Signs someone in with `before`, then with `after`, and sends what the second sync removed. */
  async function moveFrom(email: string, before: string[], afterKeys: string[], fields: Record<string, unknown> = {}) {
    const id = await db.addUser(email, fields)
    await syncPositions(id, pos(...before))
    clearPositionSyncMemo()
    const seats = await syncPositions(id, pos(...afterKeys))
    await notifyRemovedSeats(seats, { today: TODAY })
    return { id, seats }
  }

  it('reports the seats a sync took away', async () => {
    const { seats } = await moveFrom('ex-director@northeastern.edu', ['director-of-student-organization-finance'], [])
    expect(seats).toEqual([
      expect.objectContaining({ bodyId: db.bodyIds.get('Student Organization Finance Board'), role: 'Leadership' }),
    ])
  })

  it('cancels a weekly series, to that person only, worded as leaving the body', async () => {
    const b = await booking('Student Organization Finance Board', 'Weekly Room')
    const seriesId = await weekly(b, [{ date: '2026-10-28' }, { date: '2026-11-11' }])

    await moveFrom('ex-director@northeastern.edu', ['director-of-student-organization-finance'], [])

    expect(sent).toHaveLength(1)
    expect(sent[0].to).toEqual(['ex-director@northeastern.edu'])
    expect(sent[0].removedBodies).toEqual(['Student Organization Finance Board'])
    expect(sent[0].summary).toBe('Weekly Meeting (Student Organization Finance Board)')
    expect(sent[0].sessions.map(s => s.date)).toEqual(['2026-11-11'])
    expect(sent[0].attachments).toHaveLength(1)
    const ics = sent[0].attachments[0].content.toString()
    expect(ics).toContain('METHOD:CANCEL')
    expect(ics).toContain(`UID:weekly-series-${seriesId}@chambers.northeasternsga.com`)
  })

  it('cancels each upcoming one-time session, and leaves past ones alone', async () => {
    const b = await booking('Appeals Board', 'One-Time Room', { purpose: 'Hearing' })
    await oneTime(b, ['2026-10-01', '2026-11-20', '2026-12-01'])

    await moveFrom('ex-justice@northeastern.edu', ['appeals-board-justice'], [])

    expect(sent).toHaveLength(1)
    expect(sent[0].sessions.map(s => s.date)).toEqual(['2026-11-20', '2026-12-01'])
    expect(sent[0].attachments).toHaveLength(2)
  })

  it('sends nothing for a booking with nothing left ahead of it', async () => {
    const b = await booking('Appeals Board', 'One-Time Room')
    await oneTime(b, ['2026-10-01'])
    const w = await booking('Appeals Board', 'Weekly Room')
    await weekly(w, [{ date: '2026-10-28' }, { date: '2026-11-11', status: 'Cancelled' }])

    await moveFrom('ex-justice@northeastern.edu', ['appeals-board-justice'], [])
    expect(sent).toEqual([])
  })

  it('keeps a multi-body booking another of their bodies still shares', async () => {
    const b = await booking('Student Organization Finance Board', 'Weekly Room', {
      scope: 'multi',
      linked: ['Student Organization Finance Board', 'Appeals Board'],
    })
    await weekly(b, [{ date: '2026-11-11' }])

    await moveFrom('two-hats@northeastern.edu', ['director-of-student-organization-finance', 'parliamentarian'], ['parliamentarian'])
    expect(sent).toEqual([])
  })

  it('keeps a divisional booking while they still lead a body in that division', async () => {
    const b = await booking('Student Organization Finance Board', 'Weekly Room', {
      scope: 'divisional',
      division: 'Student Involvement',
    })
    await weekly(b, [{ date: '2026-11-11' }])

    await moveFrom(
      'director@northeastern.edu',
      ['director-of-student-organization-finance', 'director-of-student-organization-approvals'],
      ['director-of-student-organization-approvals']
    )
    expect(sent).toEqual([])
  })

  it('cancels a hidden booking only for someone who held it as Leadership', async () => {
    const b = await booking('Appeals Board', 'Weekly Room', { hidden: true })
    await weekly(b, [{ date: '2026-11-11' }])

    await moveFrom('ex-justice@northeastern.edu', ['appeals-board-justice'], [])
    expect(sent).toEqual([])

    await moveFrom('ex-parliamentarian@northeastern.edu', ['parliamentarian'], [])
    expect(sent.map(s => s.to)).toEqual([['ex-parliamentarian@northeastern.edu']])
  })

  it('skips Senate weeks the person does not follow', async () => {
    const b = await booking('Senate', 'Weekly Room', { purpose: 'Office Hours' })
    await weekly(b, [{ date: '2026-11-11', senateType: 'Office Hours' }])

    await moveFrom('ex-senator@northeastern.edu', ['senator'], [], {
      senate_type_preferences: JSON.stringify({ 'Office Hours': false }),
    })
    expect(sent).toEqual([])
  })

  async function inbox(body: string, address: string) {
    await db.pg.query('update public.bodies set sga_emails = $2 where id = $1', [db.bodyIds.get(body), [address]])
  }

  it('leaves alone the inbox of the body they left', async () => {
    await inbox('Appeals Board', 'appeals@northeastern.edu')
    const b = await booking('Appeals Board', 'Weekly Room')
    await weekly(b, [{ date: '2026-11-11' }])

    await moveFrom('inbox-only@northeastern.edu', ['parliamentarian'], [], {
      spaces_email_destination: 'sga',
      spaces_sga_email: 'appeals@northeastern.edu',
    })
    expect(sent).toEqual([])
  })

  it('clears an inbox they still hold through a body they still lead', async () => {
    // An EVP-style office inbox, held through Senate Leadership, that a
    // committee they have now left was also sending its invites into.
    await inbox('Senate', 'office@northeastern.edu')
    const b = await booking('Student Organization Finance Board', 'Weekly Room')
    await weekly(b, [{ date: '2026-11-11' }])

    await moveFrom(
      'officer@northeastern.edu',
      ['speaker-of-the-senate', 'director-of-student-organization-finance'],
      ['speaker-of-the-senate'],
      { spaces_email_destination: 'both', spaces_sga_email: 'office@northeastern.edu' }
    )
    expect(sent.map(s => s.to)).toEqual([['officer@northeastern.edu', 'office@northeastern.edu']])
  })

  it('leaves an inbox alone while someone still on the body routes there', async () => {
    await inbox('Senate', 'office@northeastern.edu')
    const b = await booking('Student Organization Finance Board', 'Weekly Room')
    await weekly(b, [{ date: '2026-11-11' }])
    const colleague = await db.addUser('colleague@northeastern.edu', {
      spaces_email_destination: 'sga',
      spaces_sga_email: 'office@northeastern.edu',
    })
    await syncPositions(colleague, pos('vice-president-of-student-involvement'))

    await moveFrom(
      'officer@northeastern.edu',
      ['speaker-of-the-senate', 'director-of-student-organization-finance'],
      ['speaker-of-the-senate'],
      { spaces_email_destination: 'sga', spaces_sga_email: 'office@northeastern.edu' }
    )
    expect(sent).toEqual([])
  })

  it('does nothing when no seat was removed', async () => {
    const b = await booking('Appeals Board', 'Weekly Room')
    await weekly(b, [{ date: '2026-11-11' }])

    await moveFrom('stays@northeastern.edu', ['parliamentarian'], ['parliamentarian'])
    expect(sent).toEqual([])
  })
})
