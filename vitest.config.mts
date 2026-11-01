import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const root = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  resolve: {
    // The same `@/` alias tsconfig.json gives the app.
    alias: [{ find: /^@\//, replacement: root }],
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each file builds its own in-process Postgres (tests/helpers/db.ts), which
    // takes a few seconds to apply the schema and a fair amount of memory: more
    // than two at once has crashed workers on a laptop and would on a CI runner.
    testTimeout: 30_000,
    hookTimeout: 60_000,
    maxWorkers: 2,
    // The SGAuth SDK imports `next/server` without an extension, which Next's
    // bundler resolves and plain Node ESM does not; let Vite resolve it too.
    server: { deps: { inline: [/@nusgaops\/sgauth/] } },
  },
})
