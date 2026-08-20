'use strict';

/**
 * test.js — harness for providers/yanhh3d.js (Node 18+).
 *
 *   node scripts/test.js               # full run: resolve streams per case
 *   node scripts/test.js --match-only  # Sprint 2: tmdbId -> slug (uses _findSlug)
 *
 * Full run prints: label | #streams | ms | qualities | ok, then resolved X/N + p50/p95.
 * Match-only prints: tmdbId | expected | got | score | ok, then matched X/N + wrong count.
 */

const provider = require('../providers/yanhh3d.js');
const { getStreams, _findSlug } = provider;

// Real TMDB ids. `expect`: known site slug (null = must NOT match anything).
const CASES = [
  { label: 'perfect-world', tmdbId: 124003, type: 'tv', s: 1, e: 100, expect: 'the-gioi-hoan-my-thuyet-minh-tieng-viet' },
  { label: 'gia-thien', tmdbId: 224839, type: 'tv', s: 1, e: 50, expect: 'gia-thien' },
  { label: 'soul-land', tmdbId: 76572, type: 'tv', s: 1, e: 5, expect: 'dau-la-dai-luc' },
  { label: 'swallowed-star', tmdbId: 101172, type: 'tv', s: 1, e: 10, expect: 'thon-phe-tinh-khong' },
  { label: 'wan-jie-xian-zong', tmdbId: 89364, type: 'tv', s: 1, e: 1, expect: 'van-gioi-tien-tung-thuyet-minh' },
  { label: 'btth-hard-no-vi', tmdbId: 310041, type: 'tv', s: 1, e: 1, expect: null },
  { label: 'breaking-bad-not-donghua', tmdbId: 1396, type: 'tv', s: 1, e: 1, expect: null },
  { label: 'the-office-not-on-site', tmdbId: 2316, type: 'tv', s: 1, e: 1, expect: null },
  { label: 'game-of-thrones-not-on-site', tmdbId: 1399, type: 'tv', s: 1, e: 1, expect: null },
  { label: 'movie-scope-reject', tmdbId: 634649, type: 'movie', expect: null },
];

const MATCH_ONLY = process.argv.includes('--match-only');

function pctl(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}
function pad(s, n) {
  s = String(s == null ? '' : s);
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

async function runMatch() {
  console.log('[match-only] ' + CASES.length + ' cases\n');
  console.log(pad('label', 22), pad('tmdb', 8), pad('expected', 22), pad('got', 22), 'ok');
  console.log('-'.repeat(86));
  let matched = 0;
  let wrong = 0;
  for (const c of CASES) {
    let got = null;
    try {
      got = c.type === 'tv' ? await _findSlug(c.tmdbId, c.s) : null;
    } catch (e) {
      got = 'ERR:' + (e.message || e);
    }
    const ok = got === c.expect ? 'OK' : c.expect == null && got ? 'WRONG!' : got === c.expect ? 'OK' : 'miss';
    if (got === c.expect) matched++;
    if (c.expect == null && got) wrong++;
    console.log(pad(c.label, 22), pad(c.tmdbId, 8), pad(c.expect, 22), pad(got, 22), ok);
  }
  console.log('-'.repeat(86));
  console.log('matched ' + matched + '/' + CASES.length + ', WRONG matches (should be 0): ' + wrong);
}

async function runFull() {
  console.log('running ' + CASES.length + ' cases against providers/yanhh3d.js\n');
  console.log(pad('label', 26), pad('#str', 5), pad('ms', 7), pad('qualities', 22), 'ok');
  console.log('-'.repeat(74));
  const times = [];
  let resolved = 0;
  for (const c of CASES) {
    const t0 = Date.now();
    let streams = [];
    let err = null;
    try {
      streams = await getStreams(c.tmdbId, c.type, c.s, c.e);
      if (!Array.isArray(streams)) throw new Error('not an array');
    } catch (e) {
      err = e.message || String(e);
    }
    const ms = Date.now() - t0;
    times.push(ms);
    const n = streams.length;
    if (n > 0) resolved++;
    const quals = streams.map((s) => s.quality || '?').join(',');
    console.log(pad(c.label, 26), pad(n, 5), pad(ms, 7), pad(quals || (err || ''), 22), err ? 'ERR' : n > 0 ? 'yes' : '-');
  }
  const sorted = times.slice().sort((a, b) => a - b);
  console.log('-'.repeat(74));
  console.log('resolved ' + resolved + '/' + CASES.length + ', p50=' + pctl(sorted, 50) + 'ms, p95=' + pctl(sorted, 95) + 'ms, max=' + (sorted[sorted.length - 1] || 0) + 'ms');
}

(MATCH_ONLY ? runMatch() : runFull());
