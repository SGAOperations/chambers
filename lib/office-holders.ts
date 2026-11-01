import { db } from './db/data-api'
import { positionKeysForOffice } from './permissions'
import { sgauthEnabled } from './sgauth'

export type OfficeHolder = { id: string; full_name: string; office: string }

/**
 * Who holds each of `offices` (admin_role or iems_role names, e.g.
 * 'Comptroller'), for the places Chambers finds someone *other* than the
 * caller by office: request alerts, event channels, the landing page.
 *
 * With SGAUTH_ENABLED off, these are the users.admin_role / iems_role columns
 * and active rows, as before. With it on, they are the positions each user's
 * session carried the last time they used Chambers (users.sgauth_position_keys,
 * lib/position-sync.ts), because there is no session to read for anyone else.
 * That record is only as fresh as the person's last visit: someone who left an
 * office and never came back is still listed until they do. Every caller here
 * reaches people through Slack or shows a name, and SGAuth answers no Slack
 * link for a deactivated account, so a stale holder gets no message.
 *
 * Throws when the read itself fails, so callers can tell an empty seat from an
 * outage.
 */
export async function officeHolders(offices: readonly string[]): Promise<OfficeHolder[]> {
  if (!offices.length) return []

  if (sgauthEnabled()) {
    const byKey = new Map<string, string>()
    for (const office of offices) for (const key of positionKeysForOffice(office)) byKey.set(key, office)
    if (!byKey.size) return []
    const { data, error } = await db
      .from('users')
      .select('id, full_name, sgauth_position_keys')
      .overlaps('sgauth_position_keys', [...byKey.keys()])
    if (error) throw new Error(`could not read office holders: ${error.message}`)
    const holders: OfficeHolder[] = []
    for (const u of (data ?? []) as { id: string; full_name: string; sgauth_position_keys: string[] }[]) {
      // One entry per office held, in the order `offices` asked for them.
      const held = new Set(u.sgauth_position_keys.map(k => byKey.get(k)).filter((o): o is string => !!o))
      for (const office of offices) if (held.has(office)) holders.push({ id: u.id, full_name: u.full_name, office })
    }
    return holders
  }

  const { data, error } = await db
    .from('users')
    .select('id, full_name, admin_role, iems_role')
    .or(`admin_role.in.(${offices.map(quote).join(',')}),iems_role.in.(${offices.map(quote).join(',')})`)
    .eq('is_active', true)
  if (error) throw new Error(`could not read office holders: ${error.message}`)
  const holders: OfficeHolder[] = []
  for (const u of (data ?? []) as { id: string; full_name: string; admin_role: string | null; iems_role: string | null }[]) {
    for (const office of offices) {
      if (u.admin_role === office || u.iems_role === office) holders.push({ id: u.id, full_name: u.full_name, office })
    }
  }
  return holders
}

/** A value inside a PostgREST `in.(...)` list, double-quoted so the commas and spaces in office names survive. */
function quote(value: string): string {
  return `"${value.replace(/["\\]/g, '\\$&')}"`
}
