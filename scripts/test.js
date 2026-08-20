'use strict';

/**
 * test.js — harness for providers/yanhh3d.js (Node 18+).
 *
 *   node scripts/test.js               # full run: resolve streams per case
 *   node scripts/test.js --match-only  # Sprint 2: only tmdbId -> slug (no streams)
 *
 * Prints a per-case table (label | #streams | ms | qualities | ok/fail) and a
 * summary (resolved X/N, p50, p95).
 *
 * NOTE (Sprint 1): getStreams is a stub returning [] -> expected 0/N. Replace the
 * placeholder tmdbId values below with REAL TMDB ids before Sprint 2 (5 series
 * that exist on the site + a couple that do NOT, to prove we return [] not a
 * wrong match). Known-present series slugs for reference:
 *   the-gioi-hoan-my-thuyet-minh-tieng-viet (Perfect World)
 *   dau-pha-thuong-khung-phan-5-thuyet-minh-new (Battle Through the Heavens)
 *   nghich-thien-ta-than-3d, gia-thien, tru-tien-thuyet-minh
 */

const { getStreams } = require('../providers/yanhh3d.js');

// mediaType is "tv" for all (series-only scope). s/e = season/episode.
// tmdbId: <<< ĐIỀN real TMDB ids >>> — placeholders for now.
const CASES = [
  { label: 'perfect-world-S1E100', tmdbId: 'TMDB_TV_1', type: 'tv', s: 1, e: 100 },
  { label: 'btth-S1E1', tmdbId: 'TMDB_TV_2', type: 'tv', s: 1, e: 1 },
  { label: 'nghich-thien-ta-than-S1E10', tmdbId: 'TMDB_TV_3', type: 'tv', s: 1, e: 10 },
  { label: 'gia-thien-S1E50', tmdbId: 'TMDB_TV_4', type: 'tv', s: 1, e: 50 },
  { label: 'tru-tien-S1E5', tmdbId: 'TMDB_TV_5', type: 'tv', s: 1, e: 5 },
  { label: 'btth-later-season-S5E3', tmdbId: 'TMDB_TV_6', type: 'tv', s: 5, e: 3 },
  { label: 'perfect-world-latest', tmdbId: 'TMDB_TV_7', type: 'tv', s: 1, e: 283 },
  { label: 'not-on-site-A', tmdbId: 'TMDB_TV_NONE_1', type: 'tv', s: 1, e: 1 },
  { label: 'not-on-site-B', tmdbId: 'TMDB_TV_NONE_2', type: 'tv', s: 1, e: 1 },
  { label: 'movie-must-return-empty', tmdbId: 'TMDB_MOVIE_1', type: 'movie' },
];

const MATCH_ONLY = process.argv.includes('--match-only');

function pctl(sorted, p) {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function pad(s, n) {
  s = String(s);
  return s.length >= n ? s : s + ' '.repeat(n - s.length);
}

async function run() {
  console.log(
    (MATCH_ONLY ? '[match-only] ' : '') + 'running ' + CASES.length + ' cases against providers/yanhh3d.js\n'
  );
  console.log(pad('label', 26), pad('#str', 5), pad('ms', 7), pad('qualities', 24), 'ok');
  console.log('-'.repeat(74));

  const times = [];
  let resolved = 0;

  for (const c of CASES) {
    const t0 = Date.now();
    let streams = [];
    let err = null;
    try {
      streams = await getStreams(c.tmdbId, c.type, c.s, c.e);
      if (!Array.isArray(streams)) throw new Error('getStreams did not return an array');
    } catch (e) {
      err = e && e.message ? e.message : String(e);
    }
    const ms = Date.now() - t0;
    times.push(ms);

    const n = streams.length;
    const ok = err ? 'ERR' : n > 0 ? 'yes' : '-';
    if (n > 0) resolved++;
    const quals = streams.map((s) => s.quality || '?').join(',').slice(0, 24);
    console.log(pad(c.label, 26), pad(n, 5), pad(ms, 7), pad(quals || (err ? err.slice(0, 24) : ''), 24), ok);
  }

  const sorted = times.slice().sort((a, b) => a - b);
  console.log('-'.repeat(74));
  console.log(
    'resolved ' + resolved + '/' + CASES.length +
      ', p50=' + pctl(sorted, 50) + 'ms' +
      ', p95=' + pctl(sorted, 95) + 'ms' +
      ', max=' + (sorted[sorted.length - 1] || 0) + 'ms'
  );
  if (CASES.some((c) => String(c.tmdbId).startsWith('TMDB_'))) {
    console.log('\nNOTE: placeholder tmdbId in use — replace with real ids before Sprint 2.');
  }
}

run();
