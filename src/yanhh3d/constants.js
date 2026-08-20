'use strict';

// Domain list — probed live 2026-08-20. First entry is primary; the rest are
// live mirrors used for fallback (Sprint 6). CDN hosts (fbcdn/dailymotion) are
// independent of these.
const DOMAINS = ['https://yanhh3d.pw', 'https://yanhh3d.ee', 'https://yanhh3d.work'];

// Fixed mobile Chrome UA. Referer/Origin default to the primary site domain.
const USER_AGENT =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

// Hard time budget for the whole getStreams call (R5).
const TOTAL_BUDGET_MS = 12000;

module.exports = { DOMAINS, USER_AGENT, TOTAL_BUDGET_MS };
