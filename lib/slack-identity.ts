import { db } from '@/lib/db/data-api'
import { pool } from '@/lib/db/pool'
import { sgauthEnabled } from '@/lib/sgauth'

/**
 * Who a Slack user is in Chambers, and which Slack account a Chambers user has
 * (issue #268). Every Slack route and every Slack DM finds people through here.
 *
 * With SGAUTH_ENABLED off this reads slack_connections, which the slash
 * command's /slack/connect flow writes, exactly as before. With it on, the link
 * lives in SGAuth (SGAOperations/auth#313): a person links Slack once, for every
 * SGA tool, and Chambers asks SGAuth's product API with SGAUTH_PRODUCT_API_KEY,
 * then maps the SGAuth user to the Chambers row by users.sgauth_user_id. The
 * flag is the rollback, as in lib/sgauth.ts: slack_connections is left as it is.
 *
 * Slack requests carry no SGAuth cookie, which is why this is a server-to-server
 * call with the product key rather than the session lookup the pages use.
 */

export type SlackUserResolution =
  | { status: 'linked'; chambersUserId: string }
  /** No link: the caller should send them a link to make one. */
  | { status: 'unlinked' }
  /** Linked in SGAuth, but they have never signed in to Chambers, so there is no row yet. */
  | { status: 'no_chambers_account' }
  /** SGAuth could not be asked. Say so; do not offer a new link. */
  | { status: 'error' }

/** Slack answers a command within 3 s; leave room for the rest of the route. */
const SGAUTH_TIMEOUT_MS = 2_000

/**
 * Positive answers only, for a minute per instance: one person running two
 * commands back to back asks SGAuth once. An unlink in SGAuth takes up to a
 * minute to reach a warm instance, the same staleness as the SDK's session cache.
 */
const CACHE_TTL_MS = 60_000
const forwardCache = new Map<string, { chambersUserId: string; at: number }>()

type SgauthIdentity = { userId: string; slackTeamId: string; slackUserId: string }

function sgauthBase(): string | null {
  const url = process.env.SGAUTH_URL
  return url ? url.replace(/\/+$/, '') : null
}

/** One call to an SGAuth product route. Null on any failure, which is logged without the key or the body. */
async function callSgauth<T>(path: string, body: unknown): Promise<T | null> {
  const base = sgauthBase()
  const key = process.env.SGAUTH_PRODUCT_API_KEY
  if (!base || !key) {
    console.error('slack-identity: SGAUTH_URL or SGAUTH_PRODUCT_API_KEY is not set')
    return null
  }
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SGAUTH_TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) {
      console.error('slack-identity: SGAuth refused', { path, status: res.status })
      return null
    }
    return (await res.json()) as T
  } catch (e) {
    console.error('slack-identity: SGAuth unreachable', {
      path,
      error: e instanceof Error ? e.name : 'unknown',
    })
    return null
  }
}

/** The workspace for lookups that start from Chambers users, where no Slack payload names one. */
function configuredTeamId(): string | null {
  return process.env.SLACK_TEAM_ID || null
}

async function sgauthLookup(
  slackTeamId: string,
  query: { slackUserIds?: string[]; userIds?: string[] }
): Promise<SgauthIdentity[] | null> {
  const data = await callSgauth<{ identities?: SgauthIdentity[] }>(
    '/api/products/slack/lookup',
    { slackTeamId, slackUserIds: query.slackUserIds ?? [], userIds: query.userIds ?? [] }
  )
  return data?.identities ?? null
}

/** Chambers user ids by SGAuth user id, for rows already linked to SGAuth. */
async function chambersIdsBySgauthId(sgauthIds: string[]): Promise<Map<string, string>> {
  if (!sgauthIds.length) return new Map()
  const { rows } = await pool.query<{ id: string; sgauth_user_id: string }>(
    'select id, sgauth_user_id from public.users where sgauth_user_id = any($1::uuid[])',
    [sgauthIds]
  )
  return new Map(rows.map(r => [r.sgauth_user_id, r.id]))
}

/**
 * The Chambers user behind a Slack user, from a request Slack signed.
 * `slackTeamId` comes from that payload; SLACK_TEAM_ID is the fallback.
 */
export async function resolveSlackUser(
  slackUserId: string,
  slackTeamId?: string | null
): Promise<SlackUserResolution> {
  if (!sgauthEnabled()) {
    const { data } = await db
      .from('slack_connections')
      .select('chambers_user_id')
      .eq('slack_user_id', slackUserId)
      .maybeSingle()
    const row = data as { chambers_user_id: string } | null
    return row ? { status: 'linked', chambersUserId: row.chambers_user_id } : { status: 'unlinked' }
  }

  const team = slackTeamId || configuredTeamId()
  if (!team) {
    console.error('slack-identity: no Slack team id in the payload and SLACK_TEAM_ID is not set')
    return { status: 'error' }
  }

  const cacheKey = `${team}:${slackUserId}`
  const cached = forwardCache.get(cacheKey)
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return { status: 'linked', chambersUserId: cached.chambersUserId }
  }

  const identities = await sgauthLookup(team, { slackUserIds: [slackUserId] })
  if (!identities) return { status: 'error' }
  const identity = identities.find(i => i.slackUserId === slackUserId)
  if (!identity) return { status: 'unlinked' }

  const chambersUserId = (await chambersIdsBySgauthId([identity.userId])).get(identity.userId)
  if (!chambersUserId) return { status: 'no_chambers_account' }

  forwardCache.set(cacheKey, { chambersUserId, at: Date.now() })
  return { status: 'linked', chambersUserId }
}

/**
 * Slack user ids for Chambers users, keyed by Chambers user id. Users with no
 * link are absent. An SGAuth failure is logged and answers an empty map, so a
 * caller that DMs people degrades to its fallback channel rather than failing.
 */
export async function slackIdsForChambersUsers(userIds: string[]): Promise<Map<string, string>> {
  if (!userIds.length) return new Map()

  if (!sgauthEnabled()) {
    const { data } = await db
      .from('slack_connections')
      .select('slack_user_id, chambers_user_id')
      .in('chambers_user_id', userIds)
    return new Map(
      ((data ?? []) as { slack_user_id: string; chambers_user_id: string }[]).map(l => [
        l.chambers_user_id,
        l.slack_user_id,
      ])
    )
  }

  const team = configuredTeamId()
  if (!team) {
    console.error('slack-identity: SLACK_TEAM_ID is not set; no Slack ids can be found')
    return new Map()
  }

  const { rows } = await pool.query<{ id: string; sgauth_user_id: string }>(
    'select id, sgauth_user_id from public.users where id = any($1::uuid[]) and sgauth_user_id is not null',
    [userIds]
  )
  if (!rows.length) return new Map()
  const chambersBySgauth = new Map(rows.map(r => [r.sgauth_user_id, r.id]))

  const result = new Map<string, string>()
  // SGAuth takes at most 100 ids a call.
  const sgauthIds = [...chambersBySgauth.keys()]
  for (let i = 0; i < sgauthIds.length; i += 100) {
    const identities = await sgauthLookup(team, { userIds: sgauthIds.slice(i, i + 100) })
    for (const identity of identities ?? []) {
      const chambersId = chambersBySgauth.get(identity.userId)
      if (chambersId) result.set(chambersId, identity.slackUserId)
    }
  }
  return result
}

/**
 * A link for an unlinked Slack user to connect their account, valid 15 minutes,
 * to be sent to them alone in a DM. Null when it cannot be made.
 *
 * Flag on: SGAuth issues it, and the person confirms on SGAuth signed in, which
 * links Slack for every SGA tool. Flag off: Chambers' own slack_connect_tokens
 * flow, unchanged.
 */
export async function slackConnectUrl(
  slackUserId: string,
  slackTeamId: string | null | undefined,
  issueLegacyToken: () => Promise<string>
): Promise<string | null> {
  if (!sgauthEnabled()) {
    const token = await issueLegacyToken()
    return `https://chambers.northeasternsga.com/slack/connect?token=${token}`
  }
  const team = slackTeamId || configuredTeamId()
  if (!team) return null
  const data = await callSgauth<{ url?: string }>('/api/products/slack/link-tokens', {
    slackTeamId: team,
    slackUserId,
  })
  return data?.url ?? null
}

/** Where someone manages their Slack link, for messages that point them there. */
export function slackAccountHref(): string {
  if (sgauthEnabled() && sgauthBase()) return `${sgauthBase()}/account#slack`
  return 'https://chambers.northeasternsga.com/slack/connect'
}
