#!/usr/bin/env node
/**
 * Writes Chambers' Slack links for the one-time import into SGAuth (issue #269;
 * SGAOperations/auth#315), so nobody has to link Slack again when Chambers
 * starts asking SGAuth (#268).
 *
 *   TARGET_DATABASE_URL=<Neon unpooled URL> node scripts/sgauth/export-slack-links.mjs
 *
 * Reads slack_connections joined to users.sgauth_user_id, which
 * scripts/sgauth/link-users.mjs fills in first. Writes
 * `[{ sgauthUserId, slackUserId }]` to .temp/slack-links-<timestamp>.json -- ids
 * only, no addresses -- for SGAuth's `npm run import:slack-links`. Prints counts
 * only, never a Slack id. Reads only; the file stays out of git (.temp/).
 *
 * Stops without writing if one Chambers user has more than one Slack account,
 * or one SGAuth user would get two: SGAuth holds one per person, and choosing
 * between them needs a person.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import pg from 'pg'

const url = process.env.TARGET_DATABASE_URL
if (!url) {
  console.error('Usage: TARGET_DATABASE_URL=... node scripts/sgauth/export-slack-links.mjs')
  process.exit(1)
}

const client = new pg.Client({ connectionString: url })
await client.connect()
console.log(`Source: ${new URL(url).host}`)

try {
  const { rows } = await client.query(
    `select c.chambers_user_id, c.slack_user_id, u.sgauth_user_id
       from public.slack_connections c
       join public.users u on u.id = c.chambers_user_id`
  )

  const perChambersUser = new Map()
  for (const r of rows) {
    perChambersUser.set(r.chambers_user_id, (perChambersUser.get(r.chambers_user_id) ?? 0) + 1)
  }
  const repeated = [...perChambersUser.values()].filter(n => n > 1).length
  if (repeated) {
    console.error(`${repeated} Chambers users have more than one Slack account. Nothing written.`)
    process.exit(1)
  }

  const linked = rows.filter(r => r.sgauth_user_id)
  const sgauthIds = new Set(linked.map(r => r.sgauth_user_id))
  if (sgauthIds.size !== linked.length) {
    console.error('Two Slack accounts map to one SGAuth user. Nothing written.')
    process.exit(1)
  }

  const out = linked.map(r => ({ sgauthUserId: r.sgauth_user_id, slackUserId: r.slack_user_id }))
  mkdirSync('.temp', { recursive: true })
  const path = join('.temp', `slack-links-${new Date().toISOString().replace(/[:.]/g, '')}.json`)
  writeFileSync(path, `${JSON.stringify(out, null, 2)}\n`, { flag: 'wx' })

  console.log(`Slack links:            ${rows.length}`)
  console.log(`Exported:               ${out.length}`)
  console.log(`No SGAuth id (skipped): ${rows.length - out.length}  -- run link-users.mjs first, or they relink themselves`)
  console.log(`Written to ${path}`)
} finally {
  await client.end()
}
