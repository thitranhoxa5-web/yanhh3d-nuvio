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

// TMDB — used to resolve tmdbId -> {vi title, original, year, aliases}. The vi
// translation matches the site's Vietnamese titles almost exactly (see recon).
// Public dev key from a community Nuvio provider — replace with your own for prod.
const TMDB_API_KEY = '439c478a771f35c05022f9feabcca01c';
const TMDB_BASE = 'https://api.themoviedb.org/3';

// Matching thresholds (Sprint 2). Below MATCH_MIN -> return null (no wrong match).
const MATCH_MIN = 0.72;
const YEAR_BONUS = 0.15;
const SEASON_BONUS = 0.1;

// Cache TTLs.
const TTL = { slug: 6 * 3600e3, episodes: 30 * 60e3, link: 3 * 60e3 };

module.exports = {
  DOMAINS,
  USER_AGENT,
  TOTAL_BUDGET_MS,
  TMDB_API_KEY,
  TMDB_BASE,
  MATCH_MIN,
  YEAR_BONUS,
  SEASON_BONUS,
  TTL,
};
