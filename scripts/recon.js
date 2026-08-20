#!/usr/bin/env node
/**
 * recon.js — Sprint 0 endpoint recon for yanhh3d.
 *
 * Node 18+ (uses global fetch; no external deps).
 *
 * Commands:
 *   node scripts/recon.js search "<keyword>"
 *   node scripts/recon.js detail "<slug>"
 *   node scripts/recon.js watch  "<slug>" <ep>
 *
 * Purpose: dump raw HTML/JSON + parsed structure so we can map the site
 * without guessing. Every finding here is mirrored in docs/SITE_NOTES.md.
 */

'use strict';

const BASE = process.env.YANHH3D_BASE || 'https://yanhh3d.pw';
const UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

function h(extra) {
  return Object.assign(
    {
      'User-Agent': UA,
      Referer: BASE + '/',
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
    extra || {}
  );
}

function unslash(s) {
  return String(s).split('\\/').join('/');
}

async function get(url, headers) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: headers || h(), redirect: 'follow' });
  const body = await res.text();
  const ms = Date.now() - t0;
  return { status: res.status, type: res.headers.get('content-type') || '', body, ms, res };
}

// ---- parsers ---------------------------------------------------------------

function parseSuggest(json) {
  const html = unslash(json.data || '');
  const re =
    /<a[^>]*title="([^"]*)"[^>]*href="([^"]*)"[\s\S]*?srcset="([^"]*)"[\s\S]*?title-search[^>]*>([^<]*)<[\s\S]*?ep-search[^>]*>([^<]*)</g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({
      slug: m[2].split('/').pop(),
      title: m[4].trim(),
      poster: m[3],
      epQuality: m[5].trim(),
    });
  }
  return out;
}

function parseLdJson(html) {
  const blocks = [
    ...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g),
  ].map((m) => m[1]);
  for (const b of blocks) {
    try {
      const o = JSON.parse(b);
      if (o['@type'] && /Movie|TVSeries/i.test(o['@type'])) return o;
    } catch (_) {}
  }
  return null;
}

// player-option links on a watch page: <a ... name="LINK1" data-src="....m3u8">
function parsePlayerOptions(html) {
  const re = /name="(LINK\d+)"[^>]*data-src="([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push({ name: m[1], playerUrl: m[2] });
  return out;
}

// The player page carries a base64 JSON blob in `data-obf`.
function decodeObf(playerHtml) {
  const m = playerHtml.match(/data-obf="([^"]+)"/);
  if (!m) return null;
  try {
    return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  } catch (_) {
    return null;
  }
}

// ---- commands --------------------------------------------------------------

async function cmdSearch(kw) {
  console.log('# SEARCH:', kw, '\n');

  const ajaxUrl = BASE + '/ajax/search/suggest?keyword=' + encodeURIComponent(kw);
  const a = await get(ajaxUrl, h({ 'X-Requested-With': 'XMLHttpRequest' }));
  console.log('[AJAX suggest]', ajaxUrl);
  console.log('  status', a.status, a.type, a.ms + 'ms');
  let json = null;
  try {
    json = JSON.parse(a.body);
  } catch (_) {}
  if (json) {
    const items = parseSuggest(json);
    console.log('  parsed items:', items.length);
    items.forEach((it) => console.log('   -', JSON.stringify(it)));
  } else {
    console.log('  RAW (first 800):\n', a.body.slice(0, 800));
  }

  const htmlUrl = BASE + '/search?keysearch=' + encodeURIComponent(kw);
  const s = await get(htmlUrl);
  console.log('\n[HTML search]', htmlUrl, '->', s.status, s.body.length + ' bytes', s.ms + 'ms');
}

async function cmdDetail(slug) {
  const url = BASE + '/' + slug;
  console.log('# DETAIL:', url, '\n');
  const d = await get(url);
  console.log('status', d.status, d.type, d.body.length + ' bytes', d.ms + 'ms');

  const ld = parseLdJson(d.body);
  if (ld) {
    console.log('\n[ld+json]');
    console.log('  @type        :', ld['@type']);
    console.log('  name         :', ld.name);
    console.log('  alternateName:', ld.alternateName);
    console.log('  datePublished:', ld.datePublished);
    console.log('  genre        :', JSON.stringify(ld.genre));
  } else {
    console.log('\n[ld+json] none found');
  }

  // "current/total" appears in the page (e.g. 283/286). Latest ep link:
  const eps = [
    ...new Set(
      [...d.body.matchAll(/href="[^"]*\/tap-(\d+)"/g)].map((m) => parseInt(m[1], 10))
    ),
  ].sort((a, b) => a - b);
  console.log('\n[episodes] tap- links on detail page:', eps.length ? eps.join(',') : 'none (list is on watch page)');
}

async function cmdWatch(slug, ep) {
  const url = BASE + '/' + slug + '/tap-' + ep;
  console.log('# WATCH:', url, '\n');
  const w = await get(url);
  console.log('status', w.status, w.type, w.body.length + ' bytes', w.ms + 'ms');

  const allEps = [
    ...new Set([...w.body.matchAll(/href="[^"]*\/tap-(\d+)"/g)].map((m) => +m[1])),
  ].sort((a, b) => a - b);
  console.log('\n[episode list on watch page] count:', allEps.length, 'range:', allEps[0] + '..' + allEps[allEps.length - 1]);

  const opts = parsePlayerOptions(w.body);
  console.log('\n[player options] LINK buttons:', opts.length);
  for (const o of opts) console.log('   -', o.name, o.playerUrl);

  if (!opts.length) {
    console.log('\nNo player options found. First 600 bytes of <body>:');
    const bi = w.body.indexOf('<body');
    console.log(w.body.slice(bi, bi + 600));
    return;
  }

  // Resolve the first option end-to-end.
  const first = opts[0];
  console.log('\n[resolve]', first.name, '->', first.playerUrl);
  const player = await get(first.playerUrl, h());
  console.log('  player page:', player.status, player.type, player.body.length + ' bytes');
  const obf = decodeObf(player.body);
  if (!obf) {
    console.log('  data-obf: NOT FOUND. First 400 bytes:\n', player.body.slice(0, 400));
    return;
  }
  console.log('  data-obf decoded:');
  Object.keys(obf).forEach((k) => console.log('     ', k, '=', String(obf[k]).slice(0, 90)));

  // stream-plain = cleartext HLS media playlist.
  if (obf.pU) {
    const plain = await get(obf.pU, h({ Referer: 'https://scontent-sin2-9-xx.fbcdn.cloud/' }));
    console.log('\n  [stream-plain]', plain.status, plain.type, plain.body.length + ' bytes', plain.ms + 'ms');
    const segs = [...plain.body.matchAll(/^https?:\/\/\S+/gm)].map((m) => m[0]);
    console.log('  playlist head:\n' + plain.body.split('\n').slice(0, 8).map((l) => '    ' + l).join('\n'));
    console.log('  segment count:', segs.length);
    if (segs.length) {
      console.log('  first segment:', segs[0]);
      const seg = await fetch(segs[0], { headers: h() });
      const buf = Buffer.from(await seg.arrayBuffer());
      let tsOff = -1;
      for (let o = 0; o < 2000 && tsOff < 0; o++) {
        let ok = true;
        for (let k = 0; k < 20; k++) if (buf[o + k * 188] !== 0x47) { ok = false; break; }
        if (ok) tsOff = o;
      }
      console.log(
        '  segment:', seg.status, seg.headers.get('content-type'),
        buf.length + ' bytes; MPEG-TS sync starts at byte', tsOff,
        '(PNG-polyglot: ' + (tsOff > 0 ? 'YES, ' + tsOff + '-byte prefix' : 'no') + ')'
      );
    }
  }
}

// ---- main ------------------------------------------------------------------

(async function main() {
  const [cmd, a1, a2] = process.argv.slice(2);
  try {
    if (cmd === 'search' && a1) await cmdSearch(a1);
    else if (cmd === 'detail' && a1) await cmdDetail(a1);
    else if (cmd === 'watch' && a1 && a2) await cmdWatch(a1, a2);
    else {
      console.log('Usage:');
      console.log('  node scripts/recon.js search "<keyword>"');
      console.log('  node scripts/recon.js detail "<slug>"');
      console.log('  node scripts/recon.js watch  "<slug>" <ep>');
      process.exit(1);
    }
  } catch (e) {
    console.error('ERROR:', e && e.stack ? e.stack : e);
    process.exit(1);
  }
})();
