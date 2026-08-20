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
  const re = /name="(LINK\d+)"[^>]*data-src="([^"]+)"/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) out.push({ name: m[1], url: m[2] });
  return out;
}

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
  const videos = eps.map((e) => ({
    id: 'yanhh3d:' + slug + ':' + e.token,
    title: 'Tập ' + (e.ep || e.token.replace('tap-', '')),
    season: 1,
    episode: e.ep || 1,
    released: undefined,
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
  return json({ meta: meta }, 'public, max-age=1800');
}

async function handleStream(type, fullId, origin) {
  // fullId = yanhh3d:<slug>:tap-<token>
  const rest = fullId.replace(/^yanhh3d:/, '');
  const idx = rest.indexOf(':');
  if (idx < 0) return json({ streams: [] });
  const slug = rest.slice(0, idx);
  const epToken = rest.slice(idx + 1); // e.g. "tap-100"

  let watch = '';
  for (const url of [SITE + '/sever2/' + slug + '/' + epToken, SITE + '/' + slug + '/' + epToken]) {
    try {
      const html = await getText(url, siteHeaders());
      if (!/404 Not Found/i.test(html.slice(0, 300))) {
        watch = html;
        break;
      }
    } catch (e) {}
  }
  if (!watch) return json({ streams: [] });

  const opts = parsePlayerOptions(watch);
  const streams = [];

  // Prefer fbcdn (available on most episodes) via the strip-prefix proxy.
  for (const o of opts) {
    if (!/fbcdn\.cloud/.test(o.url)) continue;
    const playlist = await resolveFbcdnPlaylist(o.url);
    if (playlist) {
      const proxied =
        origin + '/proxy-playlist.m3u8?url=' + encodeURIComponent(playlist) + '&ref=' + encodeURIComponent(SITE + '/');
      streams.push({
        name: 'YanHH3D',
        title: epToken.replace('tap-', 'Tập ') + ' • Vietsub\n🌐 HLS',
        url: proxied,
        behaviorHints: { notWebReady: false, bingeGroup: 'yanhh3d-' + slug },
      });
      break; // one fbcdn source is enough
    }
  }

  // Dailymotion as an extra clean source (no proxy needed).
  for (const o of opts) {
    if (!/dailymotion\.com/.test(o.url)) continue;
    const idM = o.url.match(/video\/([a-zA-Z0-9]+)/);
    if (!idM) continue;
    try {
      const md = await getJson(
        'https://www.dailymotion.com/player/metadata/video/' + idM[1],
        { 'User-Agent': UA, Referer: 'https://www.dailymotion.com/' }
      );
      const auto = md.qualities && md.qualities.auto && md.qualities.auto[0] && md.qualities.auto[0].url;
      if (auto) {
        streams.push({
          name: 'YanHH3D',
          title: epToken.replace('tap-', 'Tập ') + ' • Vietsub\n▶ Dailymotion',
          url: auto,
          behaviorHints: { notWebReady: false, bingeGroup: 'yanhh3d-' + slug },
        });
      }
    } catch (e) {}
    break;
  }

  return json({ streams: streams });
}

// ---------- proxy (strip PNG-polyglot) ----------

async function proxyPlaylist(playlistUrl, ref, origin) {
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
      return origin + '/proxy-segment?url=' + encodeURIComponent(abs) + '&ref=' + encodeURIComponent(ref || SITE + '/');
    })
    .join('\n');
  return new Response(out, {
    headers: Object.assign(
      { 'Content-Type': 'application/vnd.apple.mpegurl', 'Cache-Control': 'no-cache' },
      CORS
    ),
  });
}

// Find where the real MPEG-TS starts (0x47 with 188-byte periodicity) and strip
// any PNG-polyglot prefix. Returns the sliced buffer.
function stripPrefix(buf) {
  const b = new Uint8Array(buf);
  // Quick path: already clean TS.
  if (b[0] === 0x47 && b[188] === 0x47 && b[376] === 0x47) return b;
  const limit = Math.min(b.length - 188 * 4, 4096);
  for (let o = 0; o < limit; o++) {
    if (b[o] === 0x47 && b[o + 188] === 0x47 && b[o + 376] === 0x47 && b[o + 564] === 0x47) {
      return b.subarray(o);
    }
  }
  return b; // not a polyglot we recognize — pass through
}

async function proxySegment(segUrl, ref) {
  const r = await fetch(segUrl, { headers: { 'User-Agent': UA, Referer: ref || SITE + '/' } });
  if (!r.ok) return new Response('', { status: r.status, headers: CORS });
  const buf = await r.arrayBuffer();
  const ts = stripPrefix(buf);
  return new Response(ts, {
    headers: Object.assign(
      { 'Content-Type': 'video/mp2t', 'Cache-Control': 'public, max-age=3600' },
      CORS
    ),
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
      if (path === '/proxy-segment') {
        return proxySegment(url.searchParams.get('url'), url.searchParams.get('ref'));
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
