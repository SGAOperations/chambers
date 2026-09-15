import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Where SGA Spaces confirmation and cancellation emails go (issue #109).
 *
 * Leadership may send them to their personal email, to one of the shared SGA
 * inboxes of a body they lead (bodies.sga_emails), or to both. Everyone else --
 * and anyone whose chosen inbox is no longer theirs to use -- gets their
 * personal email, which is what every SGA Spaces email did before this.
 *
 * What someone may choose is always recomputed from their current Leadership
 * memberships, both when Settings saves it and again when an email is sent.
 * Checking only on save would let someone who stepped down keep receiving a
 * body's invites in its shared inbox indefinitely.
 */

export const SPACES_EMAIL_DESTINATIONS = ['personal', 'sga', 'both'] as const

export type SpacesEmailDestination = (typeof SPACES_EMAIL_DESTINATIONS)[number]

export function isSpacesEmailDestination(v: unknown): v is SpacesEmailDestination {
  return typeof v === 'string' && (SPACES_EMAIL_DESTINATIONS as readonly string[]).includes(v)
}

/**
 * The shape an SGA inbox must have to be stored on a body. Restricted to the
 * university domain because these are only ever SGA's own shared inboxes, and a
 * typo'd or outside address here would quietly send invites somewhere else.
 */
const SGA_EMAIL_PATTERN = /^[A-Za-z0-9._%+-]+@northeastern\.edu$/i

export function isSgaEmail(v: unknown): v is string {
  return typeof v === 'string' && SGA_EMAIL_PATTERN.test(v)
}

/** One inbox a person may choose, with the bodies that make it available to them. */
export interface SgaEmailOption {
  email: string
  bodies: string[]
}

interface LeadershipRow {
  user_id: string
  bodies:
    | { name: string; is_active: boolean | null; sga_emails: string[] | null }
    | { name: string; is_active: boolean | null; sga_emails: string[] | null }[]
    | null
}

/**
 * Every SGA inbox each of `userIds` may currently choose, from their Leadership
 * memberships in active bodies. Users with none are absent from the map.
 *
 * Deduplicated case-insensitively: every Campus Affairs body shares one inbox,
 * and it should be offered once, credited to all of them.
 */
export async function loadSgaEmailOptions(
  adminSupabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, SgaEmailOption[]>> {
  const byUser = new Map<string, SgaEmailOption[]>()
  if (userIds.length === 0) return byUser

  const { data } = await adminSupabase
    .from('board_memberships')
    .select('user_id, bodies(name, is_active, sga_emails)')
    .in('user_id', userIds)
    .eq('role', 'Leadership')

  for (const row of (data ?? []) as LeadershipRow[]) {
    const body = Array.isArray(row.bodies) ? row.bodies[0] : row.bodies
    if (!body || body.is_active === false) continue

    const options = byUser.get(row.user_id) ?? []
    for (const email of body.sga_emails ?? []) {
      const existing = options.find(o => o.email.toLowerCase() === email.toLowerCase())
      if (existing) {
        if (!existing.bodies.includes(body.name)) existing.bodies.push(body.name)
      } else {
        options.push({ email, bodies: [body.name] })
      }
    }
    if (options.length) byUser.set(row.user_id, options)
  }

  for (const options of byUser.values()) {
    options.sort((a, b) => a.email.localeCompare(b.email))
    for (const o of options) o.bodies.sort((a, b) => a.localeCompare(b))
  }

  return byUser
}

/** Whether `email` is one of `options`, compared case-insensitively. */
export function findSgaEmailOption(
  options: SgaEmailOption[] | undefined,
  email: string | null | undefined
): SgaEmailOption | undefined {
  if (!email) return undefined
  return options?.find(o => o.email.toLowerCase() === email.toLowerCase())
}

interface DestinationUser {
  email: string | null
  spaces_email_destination: string | null
  spaces_sga_email: string | null
}

/**
 * The addresses one person's SGA Spaces emails go to. Pure, so the fallback rule
 * reads in one place: a choice that is not currently allowed is the same as
 * having chosen personal.
 */
export function spacesAddressesFor(
  user: DestinationUser,
  options: SgaEmailOption[] | undefined
): string[] {
  const personal = user.email ? [user.email] : []
  const sga = findSgaEmailOption(options, user.spaces_sga_email)?.email

  if (!sga) return personal
  if (user.spaces_email_destination === 'sga') return [sga]
  if (user.spaces_email_destination === 'both') return [...personal, sga]
  return personal
}

/**
 * Resolves each of `userIds` to the addresses their SGA Spaces emails go to.
 * A user with no row or no address maps to an empty list.
 */
export async function resolveSpacesAddresses(
  adminSupabase: SupabaseClient,
  userIds: string[]
): Promise<Map<string, string[]>> {
  const ids = [...new Set(userIds.filter(Boolean))]
  const result = new Map<string, string[]>()
  if (ids.length === 0) return result

  const [{ data: users }, options] = await Promise.all([
    adminSupabase
      .from('users')
      .select('id, email, spaces_email_destination, spaces_sga_email')
      .in('id', ids),
    loadSgaEmailOptions(adminSupabase, ids),
  ])

  for (const u of (users ?? []) as (DestinationUser & { id: string })[]) {
    result.set(u.id, spacesAddressesFor(u, options.get(u.id)))
  }

  return result
}

/**
 * Addressing for a cancellation: the creator in To, attendees in Bcc, and no
 * address in both -- a shared inbox two leaders both chose, or an attendee who
 * is also the creator, gets one copy.
 */
export function cancellationAddressing(
  addresses: Map<string, string[]>,
  creatorId: string,
  attendeeIds: string[] | null | undefined
): { to: string[]; bcc: string[] } {
  const to = dedupeEmails(addresses.get(creatorId) ?? [])
  const inTo = new Set(to.map(e => e.toLowerCase()))
  const bcc = dedupeEmails((attendeeIds ?? []).flatMap(id => addresses.get(id) ?? []))
    .filter(e => !inTo.has(e.toLowerCase()))
  return { to, bcc }
}

/** Removes repeated addresses, case-insensitively, keeping the first spelling seen. */
export function dedupeEmails(emails: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const e of emails) {
    const key = e.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(e)
  }
  return out
}
