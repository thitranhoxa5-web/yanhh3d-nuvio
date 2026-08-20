'use strict';

// In-memory TTL cache. Module-level Map persists for the lifetime of the
// plugin instance (per getStreams session in Nuvio). No timers -> lazy expiry
// on read, so it is side-effect free at import time (R2).

const store = new Map();

function get(key) {
  const e = store.get(key);
  if (!e) return undefined;
  if (Date.now() > e.exp) {
    store.delete(key);
    return undefined;
  }
  return e.val;
}

function set(key, val, ttlMs) {
  store.set(key, { val: val, exp: Date.now() + (ttlMs || 0) });
  return val;
}

// Cache the result of an async producer under key with ttl.
async function wrap(key, ttlMs, producer) {
  const hit = get(key);
  if (hit !== undefined) return hit;
  const val = await producer();
  // Do not cache null/undefined (a failed lookup) — retry next time.
  if (val !== undefined && val !== null) set(key, val, ttlMs);
  return val;
}

module.exports = { get, set, wrap };
