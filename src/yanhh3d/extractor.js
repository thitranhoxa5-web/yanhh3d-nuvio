'use strict';

// Stream extraction: episode watch page -> playable direct links.
//
// Server priority (docs/SITE_NOTES.md §Rủi ro số 1):
//   1. Dailymotion (LINK7) — standard HLS, clean MPEG-TS, ExoPlayer-native. PREFERRED.
//   2. fbcdn (LINK4/o1 or o2) — HLS but PNG-polyglot segments (ExoPlayer risk). FALLBACK.
//   3. streamc / abyss — not reversed yet (v1 skips).
//
// Only direct .m3u8/.mp4 are returned; embed page URLs are never emitted (R6).

const { USER_AGENT } = require('./constants');
const { fetchWithTimeout, getText, siteHeaders } = require('../utils/http');
const { qualityFromHeight } = require('./hls');

const DM_REF = 'https://www.dailymotion.com/';

// Player-option buttons on a watch page: <a name="LINK7" data-src="...">
function parsePlayerOptions(html) {
  const re = /name="(LINK\d+)"[^>]*data-src="([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push({ name: m[1], url: m[2] });
  return out;
}

function classify(url) {
  if (/dailymotion\.com/i.test(url)) return 'dailymotion';
  if (/fbcdn\.cloud/i.test(url)) return 'fbcdn';
  if (/streamc\.xyz/i.test(url)) return 'streamc';
  if (/abysscdn\.com/i.test(url)) return 'abyss';
  return 'unknown';
}

// --- Dailymotion (clean HLS) -----------------------------------------------

// Returns { entries: [{url, quality}], referer, kind } from DM metadata. We do
// NOT fetch the playlists here — DM's `sec`-signed CDN URLs are validated per
// client, so fetching server-side both wastes the token and risks a 403. The
// metadata already lists every rendition's URL; ExoPlayer fetches them at play
// time with the headers we attach.
async function resolveDailymotion(embedUrl) {
  const idM = embedUrl.match(/video\/([a-zA-Z0-9]+)/);
  if (!idM) return null;
  let meta;
  try {
    const res = await fetchWithTimeout(
      'https://www.dailymotion.com/player/metadata/video/' + idM[1],
      { headers: { 'User-Agent': USER_AGENT, Referer: DM_REF } },
      6000
    );
    meta = await res.json();
  } catch (e) {
    return null;
  }
  if (!meta || meta.error) return null;
  const q = meta.qualities || {};
  const entries = [];
  // Named renditions first (e.g. "1080","720","480","380","240").
  for (const key of Object.keys(q)) {
    if (key === 'auto') continue;
    const url = q[key] && q[key][0] && q[key][0].url;
    const h = parseInt(key, 10);
    if (url && h) entries.push({ url: url, quality: qualityFromHeight(h), height: h });
  }
  entries.sort((a, b) => b.height - a.height);
  // Fall back to the adaptive master if no named renditions exist.
  if (!entries.length) {
    const auto = q.auto && q.auto[0] && q.auto[0].url;
    if (auto) entries.push({ url: auto, quality: 'Auto', height: 0 });
  }
  if (!entries.length) return null;
  return { entries: entries, referer: DM_REF, kind: 'clean' };
}

// --- fbcdn (polyglot HLS) --------------------------------------------------

async function resolveFbcdn(playerUrl) {
  let html;
  try {
    html = await getText(playerUrl, { headers: siteHeaders() }, 6000);
  } catch (e) {
    return null;
  }
  const single = (url) => ({ entries: [{ url: url, quality: 'Auto', height: 0 }], referer: 'https://yanhh3d.pw/', kind: 'polyglot' });
  // Scheme o1: direct m3u8 in data-stream-url (no token).
  const su = html.match(/data-stream-url="([^"]+)"/);
  if (su) return single(su[1]);
  // Scheme o2: base64 JSON in data-obf, use pU (stream-plain).
  const obf = html.match(/data-obf="([^"]+)"/);
  if (obf) {
    try {
      const j = JSON.parse(decodeBase64(obf[1]));
      if (j && j.pU) return single(j.pU);
    } catch (e) {}
  }
  return null;
}

// Base64 decode without Buffer (R3). Runtime provides atob in RN/Hermes;
// fall back to Buffer only under Node (build/test).
function decodeBase64(s) {
  if (typeof atob === 'function') {
    const bin = atob(s);
    // atob yields Latin-1; JSON here is ASCII so this is safe.
    return bin;
  }
  return Buffer.from(s, 'base64').toString('utf8');
}

// --- Build Stream[] from a resolved source ---------------------------------

// Build Stream[] from a resolved source's entries. No network here (R5): the
// player fetches the URLs at play time with the attached headers.
function expandToStreams(resolved, ctx) {
  const headers = {
    'User-Agent': USER_AGENT,
    Referer: resolved.referer,
    Origin: resolved.referer.replace(/\/$/, ''),
  };
  return resolved.entries.map((e) => makeStream(ctx, e.url, e.quality, headers));
}

function makeStream(ctx, url, quality, headers) {
  const tag = ctx.kind === 'clean' ? 'HLS' : 'HLS*';
  return {
    name: 'YanHH3D ' + quality,
    title: ctx.epLabel + ' • Vietsub • ' + tag + (ctx.server ? ' • ' + ctx.server : ''),
    url: url,
    quality: quality,
    format: /\.mp4($|\?)/i.test(url) ? 'mp4' : 'm3u8',
    provider: 'yanhh3d',
    headers: headers,
  };
}

// --- Orchestration ---------------------------------------------------------

// Given a watch-page HTML, resolve the best playable source(s).
// epLabel e.g. "S01E100". Returns Stream[] (possibly empty).
async function extractStreams(watchHtml, epLabel) {
  const opts = parsePlayerOptions(watchHtml);
  if (!opts.length) return [];

  // Group by host so we can prefer clean sources.
  const byHost = { dailymotion: [], fbcdn: [], other: [] };
  for (const o of opts) {
    const h = classify(o.url);
    if (h === 'dailymotion') byHost.dailymotion.push(o);
    else if (h === 'fbcdn') byHost.fbcdn.push(o);
    else byHost.other.push(o);
  }

  // 1. Dailymotion first (clean).
  for (const o of byHost.dailymotion) {
    const r = await resolveDailymotion(o.url);
    if (r) {
      const streams = expandToStreams(r, { epLabel: epLabel, kind: r.kind, server: 'Dailymotion' });
      if (streams.length) return streams;
    }
  }

  // 2. fbcdn fallback (polyglot — may not play; last resort).
  for (const o of byHost.fbcdn) {
    const r = await resolveFbcdn(o.url);
    if (r) {
      const streams = expandToStreams(r, { epLabel: epLabel, kind: r.kind, server: 'fbcdn' });
      if (streams.length) return streams;
    }
  }

  return [];
}

module.exports = { extractStreams, parsePlayerOptions, resolveDailymotion, resolveFbcdn, classify };
