/**
 * Build-time stub for `@supabase/realtime-js`.
 *
 * `@supabase/supabase-js` unconditionally `require()`s realtime-js and re-exports
 * everything from it, which pulls a Phoenix websocket client (~200 KB decoded /
 * ~56 KB gzip) into the client bundle on every route -- including the login page.
 * Chambers never opens a realtime channel (no `.channel()` / `.subscribe()`
 * anywhere in app/ or lib/), so this stub is aliased in for `@supabase/realtime-js`
 * in next.config.ts (webpack + turbopack) to keep that code out of the bundle.
 *
 * It only needs to satisfy what SupabaseClient touches during construction and
 * auth-state changes: `new RealtimeClient(url, opts)` and `realtime.setAuth()`.
 * The channel methods are here too so an accidental future call fails loudly at
 * runtime rather than being a build error.
 */

class RealtimeClient {
  constructor(endPoint, options) {
    this.endPoint = endPoint
    this.options = options
    this.channels = []
    this.accessToken = null
  }

  setAuth(token = null) {
    this.accessToken = token
  }

  connect() {}

  disconnect() {}

  channel() {
    throw new Error(
      '[chambers] Supabase Realtime is stubbed out at build time. ' +
        'Remove the @supabase/realtime-js alias in next.config.ts to use channels.'
    )
  }

  getChannels() {
    return []
  }

  removeChannel() {
    return Promise.resolve('ok')
  }

  removeAllChannels() {
    return Promise.resolve([])
  }
}

class RealtimeChannel {}
class RealtimePresence {}
class WebSocketFactory {}

const REALTIME_LISTEN_TYPES = {
  BROADCAST: 'broadcast',
  PRESENCE: 'presence',
  POSTGRES_CHANGES: 'postgres_changes',
  SYSTEM: 'system',
}
const REALTIME_POSTGRES_CHANGES_LISTEN_EVENT = {
  ALL: '*',
  INSERT: 'INSERT',
  UPDATE: 'UPDATE',
  DELETE: 'DELETE',
}
const REALTIME_PRESENCE_LISTEN_EVENTS = { SYNC: 'sync', JOIN: 'join', LEAVE: 'leave' }
const REALTIME_SUBSCRIBE_STATES = {
  SUBSCRIBED: 'SUBSCRIBED',
  TIMED_OUT: 'TIMED_OUT',
  CLOSED: 'CLOSED',
  CHANNEL_ERROR: 'CHANNEL_ERROR',
}
const REALTIME_CHANNEL_STATES = {
  closed: 'closed',
  errored: 'errored',
  joined: 'joined',
  joining: 'joining',
  leaving: 'leaving',
}

module.exports = {
  RealtimeClient,
  RealtimeChannel,
  RealtimePresence,
  WebSocketFactory,
  REALTIME_LISTEN_TYPES,
  REALTIME_POSTGRES_CHANGES_LISTEN_EVENT,
  REALTIME_PRESENCE_LISTEN_EVENTS,
  REALTIME_SUBSCRIBE_STATES,
  REALTIME_CHANNEL_STATES,
}
