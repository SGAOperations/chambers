# Chambers on Neon

Issue #136. The schema, copy script and runbook for moving Chambers' database and login from Supabase to Neon.

| File | What it is |
|---|---|
| `0001_baseline.sql` | Production `public` schema, generated from the live Supabase catalog on 2026-09-17. Foreign keys to `auth.users` are repointed at `public.users`. It has no row-level security policies or Supabase helper functions; RLS is enabled with no policies, so it defaults to deny. |
| `0002_better_auth.sql` | Better Auth on top: three columns on `users`, plus `auth_sessions`, `auth_accounts` and `auth_verifications`. |
| `0003_data_api_server_role.sql` | The `chambers_server` role the server's Data API tokens use: full access to app tables, none to `auth_*`. |
| `after-data-api.sql` | Run on each branch once its Data API is enabled. |
| `../../scripts/neon/copy-data.mjs` | Copies every table in one transaction, imports logins with their bcrypt hashes, and checks row counts. Has a `--dry-run` flag. |

## Rehearsal (on a Neon branch, any time)

1. In Neon, create a branch named `rehearsal` from an empty `main`.
2. Apply every numbered schema file in one transaction, using the **unpooled** connection string. The script refuses to run on a branch that already has tables:
   ```bash
   TARGET_DATABASE_URL="$NEON_UNPOOLED_URL" node scripts/neon/apply-schema.mjs
   ```
3. Copy the data. For the source, use Supabase's direct or session-pooler string, not the transaction pooler:
   ```bash
   SOURCE_DATABASE_URL="$SUPABASE_DIRECT_URL" TARGET_DATABASE_URL="$NEON_UNPOOLED_URL" node scripts/neon/copy-data.mjs --dry-run
   SOURCE_DATABASE_URL="$SUPABASE_DIRECT_URL" TARGET_DATABASE_URL="$NEON_UNPOOLED_URL" node scripts/neon/copy-data.mjs
   ```
4. Set up the Data API on the branch:
   - In the Neon console, go to **Postgres database → Data API** and click enable. Leave **Use Managed Better Auth** and **Grant public schema access** unchecked.
   - Under the Data API **Settings**, choose **Other Provider** and set the JWKS URL to the app's `/data-api-jwks.json`.
   - Run `db/neon/after-data-api.sql`, which lets the Data API switch into `chambers_server`.
   - **Refresh schema cache.** Neon's Data API ignores PostgREST's `notify pgrst`, so this has to be done after **every** schema change, on every branch.
   - Verify with `node scripts/neon/test-data-api.mjs`, with `NEON_DATA_API_URL` and `DATA_API_PRIVATE_JWK` set.
5. Point a Vercel preview at the branch: set `DATABASE_URL` (pooled), `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` (the preview's origin).
6. Check that an existing account signs in with its **current** password. That proves the bcrypt import worked. Also check a password reset, an invite, and deactivating a user.

To start over, delete the branch and repeat. The copy script refuses to write into tables that already have rows.

## Cutover

Target: September 19. About 30 minutes, at a quiet hour.

**Before the window**
1. On the Neon **production** branch, enable the Data API (no Managed Better Auth, no public schema grant). Add an **Other Provider** with the JWKS URL `https://raw.githubusercontent.com/SGAOperations/chambers/feat/issue-136-neon-migration/public/data-api-jwks-production.json`. It holds only the production key; the test key in `data-api-jwks.json` is never trusted by production. After the deploy, switch it to `https://chambers.northeasternsga.com/data-api-jwks-production.json`.
2. Set Vercel **Production** variables: `DATABASE_URL` (prod pooled), `NEON_DATA_API_URL` (prod Data API URL), `DATA_API_PRIVATE_JWK`, `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL=https://chambers.northeasternsga.com`. The generated secrets are in a local file outside the repo.
3. Dry-check the load; it writes nothing:
   ```bash
   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=<prod unpooled> node scripts/neon/cutover.mjs --target-endpoint=<prod ep-...> --check
   ```

**In the window**
1. Load production. Add `--reset-target` only if the branch holds an old copy:
   ```bash
   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=<prod unpooled> node scripts/neon/cutover.mjs --target-endpoint=<prod ep-...>
   ```
2. Neon console, production branch: **Refresh schema cache**. Then run `scripts/neon/test-data-api.mjs` against prod with the production key.
3. Merge to `main`, so Vercel deploys.
4. On the live site, check sign-in, a page of bookings, and one email.
5. Run `scripts/neon/compare-counts.mjs`. Any table marked **MISSING ON NEON** was written to Supabase after the copy; copy those rows by hand. It can't see edits to existing rows, which is why the window should be short and quiet.

**Rollback:** restore the previous Vercel variables and redeploy the last Supabase build. Supabase is untouched throughout; anything written to Neon in the meantime would need copying back.

**After:** keep Supabase for a few weeks, rotate its database password, then retire it and remove `SUPABASE_DB_URL`.
