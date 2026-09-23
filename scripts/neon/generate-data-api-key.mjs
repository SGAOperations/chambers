#!/usr/bin/env node
/**
 * Generates a signing key for the Neon Data API (issue #136).
 *
 *   node scripts/neon/generate-data-api-key.mjs ../chambers-secrets/preview.jwk
 *
 * Chambers' server signs its own short-lived `chambers_server` tokens
 * (lib/db/data-api.ts) with an ES256 private key held in DATA_API_PRIVATE_JWK.
 * The matching public key goes in the JWKS file the branch's Data API trusts:
 * public/data-api-jwks.json for preview and rehearsal branches,
 * data-api-jwks-production.json for production.
 *
 * The two halves are generated together and share a `kid`, which is how the
 * Data API picks the right one. There was no script for this -- the original
 * pair was made by hand during the cutover -- so replacing a lost key, or
 * rotating one, meant reconstructing the format from lib/db/data-api.ts.
 *
 * The private half is written to the path you give, never printed: anything
 * printed here would end up in a terminal scrollback, a CI log or a chat
 * transcript. That path must be outside the repository, and this refuses
 * otherwise -- a private key committed to a public repo is a key given away.
 * Whoever holds it can read and write every app table on any branch whose Data
 * API trusts it.
 *
 * The public half is printed, because it is meant to be: paste it into the JWKS
 * file and commit that.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { dirname, resolve, relative, isAbsolute } from 'node:path'
import { randomBytes } from 'node:crypto'
import { generateKeyPair, exportJWK } from 'jose'

const [out, prefixArg] = process.argv.slice(2)

if (!out) {
  console.error('Usage: node scripts/neon/generate-data-api-key.mjs <private-key-out-path> [kid-prefix]')
  console.error('Example: node scripts/neon/generate-data-api-key.mjs ../chambers-secrets/preview.jwk chambers-preview')
  process.exit(1)
}

const repoRoot = resolve(process.cwd())
const outPath = resolve(out)
const rel = relative(repoRoot, outPath)
const insideRepo = rel && !rel.startsWith('..') && !isAbsolute(rel)

if (insideRepo) {
  console.error(`Refusing to write a private key inside the repository (${rel}).`)
  console.error('Choose a path outside it, e.g. ../chambers-secrets/preview.jwk')
  process.exit(1)
}

if (existsSync(outPath)) {
  console.error(`${outPath} already exists. Choose another path rather than overwriting a key in use.`)
  process.exit(1)
}

const kid = `${prefixArg || 'chambers-server'}-${randomBytes(4).toString('hex')}`

const { publicKey, privateKey } = await generateKeyPair('ES256', { extractable: true })
const pub = { ...(await exportJWK(publicKey)), kid, alg: 'ES256', use: 'sig' }
const priv = { ...(await exportJWK(privateKey)), kid, alg: 'ES256' }

mkdirSync(dirname(outPath), { recursive: true })
// One line, which is the shape an environment variable wants.
writeFileSync(outPath, JSON.stringify(priv), { mode: 0o600 })

console.log(`Private key written to ${outPath} (kid ${kid}).`)
console.log('Set it as DATA_API_PRIVATE_JWK, as a single line, for that environment only.\n')
console.log('Public half -- put this in the JWKS file the branch trusts, and commit it:\n')
console.log(JSON.stringify({ keys: [pub] }, null, 2))
console.log(`
Then, in the Neon console for that branch:
  1. Data API -> Settings -> Other Provider, JWKS URL pointing at that file.
  2. The file has to be reachable at that URL before a token signed with this
     key will verify -- so deploy it, or point the provider at the raw file on
     GitHub while testing.
  3. Refresh the schema cache.

Check it end to end before redeploying the app:
  NEON_DATA_API_URL=... DATA_API_PRIVATE_JWK="$(cat ${out})" node scripts/neon/test-data-api.mjs`)
