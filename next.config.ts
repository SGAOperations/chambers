import type { NextConfig } from "next";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
  // The default precache manifest was every build artifact in .next/static --
  // 103 entries, ~1.6 MB on the wire. The service worker installs on first visit,
  // so a user opening Chambers on a machine they had not used before downloaded
  // the entire app (every route's chunk, including the ~150 KB Bookings
  // page) in the background while the page they actually asked for was still
  // fetching its own JS and data, on the same connection pool.
  //
  // Route chunks are excluded from the precache and left to Workbox's runtime
  // caching, which stores each one the first time it is genuinely needed. Offline
  // support for a route you have already opened is unchanged; what goes away is
  // paying for the routes you never open. `buildExcludes` entries are matched
  // against paths relative to .next/, hence the `static/chunks/...` prefixes.
  buildExcludes: [
    // Per-route page/layout bundles.
    /static\/chunks\/app\/.*$/,
    // Lazily-imported chunks -- numeric-only names, no route in the path.
    /static\/chunks\/[0-9]+\.[a-f0-9]+\.js$/,
    // The App Router build manifests, which are re-fetched on navigation anyway.
    /static\/[^/]+\/_(?:build|ssg)Manifest\.js$/,
    // Served under `noModule`, so every browser that can run a service worker
    // ignores the file. Precaching it downloaded ~40 KB that is never executed.
    /static\/chunks\/polyfills-[a-f0-9]+\.js$/,
  ],
  // opsemaillogo.png is only ever referenced from transactional email HTML, which
  // renders in the recipient's mail client -- the app itself never loads it, so
  // there is nothing to serve offline.
  publicExcludes: ['!opsemaillogo.png'],
});

// Chambers never opens a Supabase Realtime channel, but @supabase/supabase-js
// pulls @supabase/realtime-js (a Phoenix websocket client, ~200 KB decoded) into
// the bundle on every route regardless. Alias it to a tiny stub for both bundlers.
// See lib/stubs/realtime-js.js.
const realtimeStub = path.resolve(__dirname, 'lib/stubs/realtime-js.js');

const nextConfig: NextConfig = {
  // /administrator became /bookings when its settings half moved to /management
  // (issue #64). Admins have had the old URL bookmarked for a year, and it is
  // also what any link written before the rename points at, so it keeps
  // resolving.
  //
  // Temporary (307) rather than permanent: a 308 is cached by the browser
  // indefinitely and would be painful to walk back if the route is ever renamed
  // again. Nothing here is indexed, so there is no reason to want the permanent
  // form.
  async redirects() {
    return [{ source: '/administrator', destination: '/bookings', permanent: false }]
  },
  turbopack: {
    resolveAlias: {
      '@supabase/realtime-js': './lib/stubs/realtime-js.js',
    },
  },
  webpack: (config) => {
    config.resolve.alias = {
      ...config.resolve.alias,
      '@supabase/realtime-js': realtimeStub,
    };
    return config;
  },
};

export default withPWA(nextConfig);
