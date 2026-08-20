/**
 * YanHH3D — Stremio-style add-on on Cloudflare Workers.
 *
 * Exposes catalog / meta / stream for yanhh3d donghua (series), using the
 * site's own Vietnamese titles (no TMDB matching). fbcdn streams are
 * PNG-polyglot (real MPEG-TS hidden behind a small PNG prefix), which ExoPlayer
 * cannot demux directly — so we proxy them:
 *   stream url -> /proxy-playlist.m3u8?url=<fbcdn> which rewrites each segment to
 *   /proxy-segment?url=<seg>, and the segment proxy strips the PNG prefix so the
 *   player receives clean TS. (Same approach the K20 add-on uses.)
 *
 * Deploy: Cloudflare Workers (free). See addon/README.md.
 */

const SITE = 'https://yanhh3d.pw';
const UA =
  'Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36';

const MANIFEST = {
  id: 'community.yanhh3d',
  version: '1.0.0',
  name: 'YanHH3D',
  description: 'Vietsub donghua / phim 3D Trung Quốc từ yanhh3d (phim bộ)',
  logo: 'https://yanhh3d.pw/storage/settings/August2024/YOoAwtlobLbwKhiFwRZv.png',
  types: ['series'],
  resources: ['catalog', 'meta', 'stream'],
  idPrefixes: ['yanhh3d:'],
  catalogs: [
    {
      type: 'series',
      id: 'yanhh3d-series',
      name: 'YanHH3D • Phim Bộ',
      extra: [{ name: 'search' }, { name: 'skip' }],
    },
  ],
  behaviorHints: { adult: false, p2p: false, configurable: false },
};

// ---------- http helpers ----------

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

// Only these hosts may be fetched through the proxy — stops the Worker from
// being abused as an open proxy (which would burn the free quota). Covers every
// CDN yanhh3d actually serves video from; unknown hosts are refused.
const PROXY_HOSTS = [
  'fbcdn.cloud',
  'tiktokcdn.com',
  'defifa.com',
  'dailymotion.com',
  'dmcdn.net',
  'yanhh3d.pw',
  'yanhh3d.ee',
  'yanhh3d.work',
];

function allowedProxyUrl(u) {
  try {
    const h = new URL(u).hostname;
    return PROXY_HOSTS.some((d) => h === d || h.endsWith('.' + d));
  } catch (e) {
    return false;
  }
}

function json(obj, cache) {
  return new Response(JSON.stringify(obj), {
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': cache || 'no-cache' },
      CORS
    ),
  });
}

function siteHeaders(extra) {
  return Object.assign(
    { 'User-Agent': UA, Referer: SITE + '/', 'Accept-Language': 'vi-VN,vi;q=0.9' },
    extra || {}
  );
}

async function getText(url, headers) {
  const r = await fetch(url, { headers: headers || siteHeaders() });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.text();
}

async function getJson(url, headers) {
  const r = await fetch(url, { headers: headers || siteHeaders() });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.json();
}

function unslash(s) {
  return String(s || '').split('\\/').join('/');
}

// ---------- parsers ----------

// A catalog card in browse pages: <div class="flw-item"> ... tick-rate, img alt, film-poster-ahref
function parseCards(html) {
  const out = [];
  const parts = html.split('flw-item');
  for (let i = 1; i < parts.length; i++) {
    const c = parts[i];
    const tick = (c.match(/tick-rate">([^<]*)</) || [])[1] || '';
    if (!isSeries(tick)) continue;
    const href = (c.match(/href="https:\/\/[^"]*\/([a-z0-9-]+)"[^>]*class="film-poster-ahref"/) || [])[1];
    const poster = (c.match(/(?:data-src|src)="([^"]*\/storage\/[^"]*)"/) || [])[1];
    const title = ((c.match(/alt="([^"]*)"/) || [])[1] || '').trim();
    if (!href) continue;
    out.push({ slug: href, title: title, poster: poster, epQuality: tick.trim() });
  }
  return dedupe(out);
}

// Suggest fragment items (search).
function parseSuggest(dataHtml) {
  const html = unslash(dataHtml);
  const re =
    /<a[^>]*title="([^"]*)"[^>]*href="([^"]*)"[\s\S]*?srcset="([^"]*)"[\s\S]*?title-search[^>]*>([^<]*)<[\s\S]*?ep-search[^>]*>([^<]*)</g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2].split('/').filter(Boolean).pop();
    const ep = m[5].trim();
    if (!isSeries(ep)) continue;
    out.push({ slug: slug, title: (m[4] || m[1]).trim(), poster: m[3], epQuality: ep });
  }
  return dedupe(out);
}

// Series vs movie/OVA classifier (date-safe): needs "N/M" or "Tập N", not a movie marker.
function isSeries(ep) {
  const e = String(ep)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd');
  if (/full\s?movie|\bova\b|trailer|tom tat|tong ket|^full\s?hd$|^full$/.test(e)) return false;
  return /\d+\s*\/\s*\d+/.test(ep) || /\btap\b/.test(e);
}

function dedupe(list) {
  const seen = {};
  const out = [];
  for (const it of list) {
    if (it.slug && !seen[it.slug]) {
      seen[it.slug] = 1;
      out.push(it);
    }
  }
  return out;
}

// Episode links on a watch page, in order. Returns [{ep, token}] where token is
// the URL segment after tap- (handles "tap-5" and "tap-88-90"/"tap-464-het-phan").
function parseEpisodes(html, slug) {
  const re = new RegExp('/sever2/' + escapeRe(slug) + '/tap-([a-z0-9-]+)"', 'g');
  const seen = {};
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const token = 'tap-' + m[1];
    if (seen[token]) continue;
    seen[token] = 1;
    const num = parseInt((m[1].match(/^\d+/) || ['0'])[0], 10);
    out.push({ ep: num, token: token });
  }
  out.sort((a, b) => a.ep - b.ep);
  return out;
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function ldJson(html) {
  const blocks = html.match(/<script[^>]*application\/ld\+json[^>]*>([\s\S]*?)<\/script>/g) || [];
  for (const b of blocks) {
    try {
      const o = JSON.parse(b.replace(/<script[^>]*>/, '').replace(/<\/script>/, ''));
      if (o['@type'] && /Movie|TVSeries/i.test(o['@type'])) return o;
    } catch (e) {}
  }
  return null;
}

// ---------- fbcdn extraction (server-side) ----------

function parsePlayerOptions(html) {
  // Each server button is a quality: <a name="LINK5" data-src="...">4K</a>
  const re = /<a[^>]*name="(LINK\d+)"[^>]*data-src="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ name: m[1], url: m[2], label: m[3].replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim() });
  }
  return out;
}

function normQuality(label) {
  const l = (label || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
  if (l.includes('2160') || l.includes('4K')) return '4K';
  if (l.includes('1440') || l.includes('2K')) return '2K';
  if (l.includes('1080')) return '1080p';
  if (l.includes('720')) return '720p';
  if (l.includes('480')) return '480p';
  if (l.includes('HD')) return 'HD';
  return label || 'Auto';
}

const QUALITY_RANK = { '4K': 5, '2K': 4, '1080p': 3, '720p': 2, HD: 1, '480p': 0 };

// Resolve an fbcdn player page to a media-playlist URL. Prefer scheme o1
// (data-stream-url, no token). Returns url or null.
async function resolveFbcdnPlaylist(playerUrl) {
  let html;
  try {
    html = await getText(playerUrl, siteHeaders());
  } catch (e) {
    return null;
  }
  const su = html.match(/data-stream-url="([^"]+)"/);
  if (su) return su[1];
  const obf = html.match(/data-obf="([^"]+)"/);
  if (obf) {
    try {
      const j = JSON.parse(atob(obf[1]));
      if (j && j.pU) return j.pU;
    } catch (e) {}
  }
  // Scheme 3 (older Thuyết Minh pages): jwplayer setup with var x = "<...m3u8>".
  const raw = html.match(/["'](https?:\/\/[^"']+\/stream\/m3u8\/[^"']+\.m3u8)["']/) ||
    html.match(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/);
  if (raw) return raw[1];
  return null;
}

// ---------- route handlers ----------

async function handleCatalog(type, id, extra, origin) {
  if (type !== 'series') return json({ metas: [] });
  const search = extra.search;
  const skip = parseInt(extra.skip || '0', 10) || 0;
  let items = [];
  try {
    if (search) {
      const j = await getJson(
        SITE + '/ajax/search/suggest?keysearch=' + encodeURIComponent(search),
        siteHeaders({ 'X-Requested-With': 'XMLHttpRequest' })
      );
      items = parseSuggest(j.data);
    } else {
      const page = Math.floor(skip / 24) + 1;
      const html = await getText(SITE + '/moi-cap-nhat' + (page > 1 ? '?page=' + page : ''));
      items = parseCards(html);
    }
  } catch (e) {
    return json({ metas: [] });
  }
  const metas = items.map((it) => ({
    id: 'yanhh3d:' + it.slug,
    type: 'series',
    name: it.title,
    poster: it.poster,
    posterShape: 'poster',
  }));
  return json({ metas: metas }, 'public, max-age=600');
}

async function handleMeta(type, fullId, origin) {
  const slug = fullId.replace(/^yanhh3d:/, '');
  let detail = '';
  try {
    detail = await getText(SITE + '/' + slug);
  } catch (e) {
    return json({ meta: {} });
  }
  const ld = ldJson(detail) || {};
  const poster = (detail.match(/\/storage\/movies\/[^"']+/) || [''])[0];
  const posterUrl = poster ? SITE + poster.replace(SITE, '') : undefined;
  const desc = ld.description || (detail.match(/<meta name="description" content="([^"]*)"/) || [])[1] || '';
  const genres = Array.isArray(ld.genre) ? ld.genre : ld.genre ? [ld.genre] : [];
  const year = ld.datePublished ? String(ld.datePublished).slice(0, 4) : undefined;

  // Episodes from the sever2 watch page (tap-1); fall back to default server.
  let eps = [];
  for (const url of [SITE + '/sever2/' + slug + '/tap-1', SITE + '/' + slug]) {
    try {
      const html = await getText(url);
      eps = parseEpisodes(html, slug);
      if (eps.length) break;
    } catch (e) {}
  }
  // No `title`/`name`: Nuvio already renders "TẬP {episode}" from the number —
  // adding our own "Tập N" duplicated it into extra lines. thumbnail avoids
  // black cards.
  const videos = eps.map((e) => ({
    id: 'yanhh3d:' + slug + ':' + e.token,
    season: 1,
    episode: e.ep || 1,
    thumbnail: posterUrl,
  }));

  const meta = {
    id: 'yanhh3d:' + slug,
    type: 'series',
    name: ld.name || slug,
    poster: posterUrl,
    posterShape: 'poster',
    background: posterUrl,
    description: desc,
    genres: genres,
    releaseInfo: year,
    videos: videos,
  };
  return json({ meta: meta }, 'public, max-age=60');
}

// Fetch a watch page and return ONE proxied stream per distinct quality
// (each server button on the page is a different quality: 4K / 1080p / HD...).
async function versionStreams(watchUrl, version, slug, epNum, origin) {
  let html;
  try {
    html = await getText(watchUrl, siteHeaders());
  } catch (e) {
    return [];
  }
  if (/404 Not Found/i.test(html.slice(0, 300))) return [];

  const byQ = {};
  for (const o of parsePlayerOptions(html)) {
    if (!/fbcdn\.cloud/.test(o.url)) continue;
    const q = normQuality(o.label);
    if (!(q in byQ)) byQ[q] = o; // one server per quality is enough
  }

  const entries = Object.keys(byQ).map((q) => ({ q: q, o: byQ[q] }));
  const resolved = await Promise.all(
    entries.map(async (e) => {
      const playlist = await resolveFbcdnPlaylist(e.o.url);
      if (!playlist) return null;
      const proxied =
        origin + '/proxy-playlist.m3u8?url=' + encodeURIComponent(playlist) + '&ref=' + encodeURIComponent(SITE + '/');
      return {
        name: 'YanHH3D ' + e.q,
        title: version + ' • ' + e.q + ' • Tập ' + epNum,
        url: proxied,
        quality: e.q,
        behaviorHints: { notWebReady: false, bingeGroup: 'yanhh3d-' + slug + '-' + version + '-' + e.q },
      };
    })
  );
  return resolved
    .filter(Boolean)
    .sort((a, b) => (QUALITY_RANK[b.quality] || 0) - (QUALITY_RANK[a.quality] || 0));
}

// Thuyết Minh lives on the default server path. Recent episodes are at
// /<slug>/tap-N, but older ones are grouped into clusters (tap-88-90), so on a
// direct miss we look up the cluster token that covers this episode number.
async function thuyetMinhStreams(slug, epNum, epToken, origin) {
  const direct = await versionStreams(SITE + '/' + slug + '/' + epToken, 'Thuyết Minh', slug, epNum, origin);
  if (direct.length) return direct;

  let token = null;
  try {
    const detail = await getText(SITE + '/' + slug, siteHeaders());
    const latest = (detail.match(new RegExp('//[^/"]+/' + escapeRe(slug) + '/tap-([0-9-]+)"')) || [])[1];
    if (latest) {
      const listHtml = await getText(SITE + '/' + slug + '/tap-' + latest, siteHeaders());
      const re = new RegExp('//[^/"]+/' + escapeRe(slug) + '/tap-([0-9-]+)"', 'g');
      let m;
      while ((m = re.exec(listHtml))) {
        const nums = m[1].split('-').map(Number);
        if (epNum >= nums[0] && epNum <= nums[nums.length - 1]) {
          token = m[1];
          break;
        }
      }
    }
  } catch (e) {}
  if (!token) return [];
  return versionStreams(SITE + '/' + slug + '/tap-' + token, 'Thuyết Minh', slug, epNum, origin);
}

async function handleStream(type, fullId, origin) {
  // fullId = yanhh3d:<slug>:tap-<token>
  const rest = fullId.replace(/^yanhh3d:/, '');
  const idx = rest.indexOf(':');
  if (idx < 0) return json({ streams: [] });
  const slug = rest.slice(0, idx);
  const epToken = rest.slice(idx + 1); // e.g. "tap-100"
  const epNum = parseInt((epToken.match(/\d+/) || ['0'])[0], 10);

  // Same episode exists in two versions on two different paths:
  //   /<slug>/tap-N          -> Thuyết Minh (lồng tiếng)
  //   /sever2/<slug>/tap-N   -> Vietsub
  // Resolve both so the user can pick.
  const [vs, tm] = await Promise.all([
    versionStreams(SITE + '/sever2/' + slug + '/' + epToken, 'Vietsub', slug, epNum, origin),
    thuyetMinhStreams(slug, epNum, epToken, origin),
  ]);

  return json({ streams: tm.concat(vs) });
}

// ---------- proxy (strip PNG-polyglot) ----------

async function proxyPlaylist(playlistUrl, ref, origin) {
  if (!allowedProxyUrl(playlistUrl)) return new Response('forbidden', { status: 403, headers: CORS });
  const text = await getText(playlistUrl, { 'User-Agent': UA, Referer: ref || SITE + '/' });
  const base = playlistUrl;
  const out = text
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t || t[0] === '#') return line;
      // Absolutize + route each segment through the segment proxy.
      let abs;
      try {
        abs = new URL(t, base).href;
      } catch (e) {
        abs = t;
      }
      return origin + '/proxy-segment.ts?url=' + encodeURIComponent(abs) + '&ref=' + encodeURIComponent(ref || SITE + '/');
    })
    .join('\n');
  return new Response(out, {
    headers: Object.assign(
      { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' },
      CORS
    ),
  });
}

// Offset of the real MPEG-TS start (0x47 with 188-byte periodicity), or -1.
function findTsOffset(b) {
  if (b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47) return 0;
  const limit = Math.min(b.length - 188 * 4, 4096);
  for (let o = 0; o < limit; o++) {
    if (b[o] === 0x47 && b[o + 188] === 0x47 && b[o + 376] === 0x47 && b[o + 564] === 0x47) return o;
  }
  return -1;
}

// Strip the PNG-polyglot prefix and serve clean TS. We buffer the segment so we
// can send Content-Length + Accept-Ranges (and honour Range requests) — players
// need the segment size up front to pipeline; a size-less chunked response is
// what makes playback stutter. (Matches how the K20 add-on serves segments.)
async function proxySegment(segUrl, ref, rangeHeader) {
  if (!allowedProxyUrl(segUrl)) return new Response('forbidden', { status: 403, headers: CORS });
  const r = await fetch(segUrl, {
    headers: { 'User-Agent': UA, Referer: ref || SITE + '/' },
    cf: { cacheEverything: true, cacheTtl: 86400 },
  });
  if (!r.ok) return new Response('', { status: r.status, headers: CORS });

  const buf = new Uint8Array(await r.arrayBuffer());
  const off = findTsOffset(buf);
  const ts = off > 0 ? buf.subarray(off) : buf;
  const total = ts.byteLength;

  const base = {
    'Content-Type': 'video/mp2t',
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };

  const m = rangeHeader && /bytes=(\d+)-(\d*)/.exec(rangeHeader);
  if (m) {
    const start = parseInt(m[1], 10);
    const end = m[2] ? Math.min(parseInt(m[2], 10), total - 1) : total - 1;
    const slice = ts.subarray(start, end + 1);
    return new Response(slice, {
      status: 206,
      headers: Object.assign({}, base, CORS, {
        'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
        'Content-Length': String(slice.byteLength),
      }),
    });
  }

  return new Response(ts, {
    headers: Object.assign({}, base, CORS, { 'Content-Length': String(total) }),
  });
}

// ---------- router ----------

function parseExtra(str) {
  // Stremio extra: "search=abc&skip=24" OR path segment "search=abc.json"
  const extra = {};
  if (!str) return extra;
  for (const kv of decodeURIComponent(str).split('&')) {
    const i = kv.indexOf('=');
    if (i > 0) extra[kv.slice(0, i)] = kv.slice(i + 1);
  }
  return extra;
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const origin = url.origin;
    const path = decodeURIComponent(url.pathname);

    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });

    try {
      if (path === '/' || path === '/manifest.json') return json(MANIFEST, 'public, max-age=3600');
      if (path === '/configure' || path === '/configure/') {
        return new Response(
          '<!doctype html><meta charset=utf-8><title>YanHH3D</title>' +
            '<body style="font-family:sans-serif;max-width:640px;margin:40px auto;padding:0 16px">' +
            '<h2>YanHH3D add-on</h2><p>Manifest URL để add vào Nuvio/Stremio:</p>' +
            '<code>' + origin + '/manifest.json</code></body>',
          { headers: Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS) }
        );
      }

      // Proxy endpoints.
      if (path === '/proxy-playlist.m3u8') {
        return proxyPlaylist(url.searchParams.get('url'), url.searchParams.get('ref'), origin);
      }
      if (path === '/proxy-segment' || path === '/proxy-segment.ts') {
        return proxySegment(url.searchParams.get('url'), url.searchParams.get('ref'), request.headers.get('Range'));
      }

      // Stremio resources: /catalog/<type>/<id>[/<extra>].json  etc.
      const parts = path.replace(/\.json$/, '').split('/').filter(Boolean);
      const res = parts[0];

      if (res === 'catalog') {
        const type = parts[1];
        const id = parts[2];
        const extra = parseExtra(parts[3] || url.search.slice(1));
        return handleCatalog(type, id, extra, origin);
      }
      if (res === 'meta') {
        return handleMeta(parts[1], parts.slice(2).join('/'), origin);
      }
      if (res === 'stream') {
        return handleStream(parts[1], parts.slice(2).join('/'), origin);
      }

      return json({ err: 'not found', path: path }, 'no-cache');
    } catch (e) {
      return json({ err: String(e && e.message ? e.message : e) });
    }
  },
};
