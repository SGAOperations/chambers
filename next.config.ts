import type { NextConfig } from "next";
import path from "node:path";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const withPWA = require('next-pwa')({
  dest: 'public',
  disable: process.env.NODE_ENV === 'development',
  register: true,
  skipWaiting: true,
});

// Chambers never opens a Supabase Realtime channel, but @supabase/supabase-js
// pulls @supabase/realtime-js (a Phoenix websocket client, ~200 KB decoded) into
// the bundle on every route regardless. Alias it to a tiny stub for both bundlers.
// See lib/stubs/realtime-js.js.
const realtimeStub = path.resolve(__dirname, 'lib/stubs/realtime-js.js');

const nextConfig: NextConfig = {
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
