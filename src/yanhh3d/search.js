'use strict';

// Matching layer: TMDB id -> yanhh3d slug.
//
// Bridge insight (recon): TMDB's Vietnamese translation (/translations -> vi)
// and its VN alternative_titles match the site's Vietnamese titles almost
// exactly. So we query the site with those VI strings (plus EN/original as
// fallback), score candidates, and only accept >= MATCH_MIN — otherwise null
// (better no result than a wrong movie).

const C = require('./constants');
const { getJson, getText, siteHeaders, SITE } = require('../utils/http');
const cache = require('../utils/cache');
const { normalize, stripSeasonHints, similarity } = require('../utils/text');

// --- TMDB meta -------------------------------------------------------------

// Returns { title, original_title, year, viTitles[] } or null.
async function getMeta(tmdbId) {
  return cache.wrap('meta:' + tmdbId, C.TTL.slug, async () => {
    const key = '?api_key=' + C.TMDB_API_KEY;
    const base = C.TMDB_BASE + '/tv/' + tmdbId;
    let detail, trans, alt;
    try {
      detail = await getJson(base + key, { headers: { 'User-Agent': C.USER_AGENT } }, 6000);
    } catch (e) {
      return null;
    }
    // translations + alt titles are best-effort (don't fail the whole match).
    try {
      trans = await getJson(base + '/translations' + key, { headers: { 'User-Agent': C.USER_AGENT } }, 6000);
    } catch (e) {
      trans = { translations: [] };
    }
    try {
      alt = await getJson(base + '/alternative_titles' + key, { headers: { 'User-Agent': C.USER_AGENT } }, 6000);
    } catch (e) {
      alt = { results: [] };
    }

    const viTrans = (trans.translations || []).find((x) => x.iso_639_1 === 'vi');
    const viTitles = [];
    if (viTrans && viTrans.data && viTrans.data.name) viTitles.push(viTrans.data.name);
    for (const a of alt.results || []) {
      if (a.iso_3166_1 === 'VN' && a.title) viTitles.push(a.title);
    }

    return {
      title: detail.name || detail.original_name || '',
      original_title: detail.original_name || '',
      year: (detail.first_air_date || '').slice(0, 4),
      viTitles: viTitles,
    };
  });
}

// --- Site search -----------------------------------------------------------

// Classify a suggest item's epQuality string as series vs movie/OVA/trailer.
// Series markers seen live: "283/286 [4K]", "Tập 464 Thuyết Minh", "19/19 [...]".
// Movie/non-series: "Full Movie", "OVA1 FullHD", "FullHD", "Tổng Kết 05",
// "Trailer Phần 4 - 21/08" (note: a date like 21/08 must NOT read as N/M).
function isSeriesEp(epQuality) {
  const ep = normalize(epQuality); // diacritics stripped -> "tap", "full movie", ...
  const movieLike = /full\s?movie|\bova\b|trailer|tom tat|tong ket|^full\s?hd$|^full$/.test(ep);
  if (movieLike) return false;
  return /\d+\s*\/\s*\d+/.test(epQuality) || /\btap\b/.test(ep);
}

// Parse the AJAX suggest fragment into candidate items.
function parseSuggest(dataHtml) {
  const html = (dataHtml || '').split('\\/').join('/');
  const re =
    /<a[^>]*title="([^"]*)"[^>]*href="([^"]*)"[\s\S]*?title-search[^>]*>([^<]*)<[\s\S]*?ep-search[^>]*>([^<]*)</g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    const slug = m[2].split('/').filter(Boolean).pop();
    const epQuality = m[4].trim();
    out.push({
      slug: slug,
      title: (m[3] || m[1]).trim(),
      epQuality: epQuality,
      isSeries: isSeriesEp(epQuality),
    });
  }
  return out;
}

async function siteSuggest(kw) {
  try {
    const j = await getJson(
      SITE + '/ajax/search/suggest?keysearch=' + encodeURIComponent(kw),
      { headers: siteHeaders({ 'X-Requested-With': 'XMLHttpRequest' }) },
      7000
    );
    return parseSuggest(j.data);
  } catch (e) {
    return [];
  }
}

// --- Slug resolution -------------------------------------------------------

// Score one candidate against one query title (both raw). Season-aware.
function scoreCandidate(cand, queryTitle, meta, wantSeason) {
  const q = stripSeasonHints(queryTitle);
  const c = stripSeasonHints(cand.title);
  let score = similarity(q.base, c.base);
  if (meta.year && cand.title && String(cand.title).indexOf(meta.year) !== -1) score += C.YEAR_BONUS;
  // Season hint agreement: if we want S2 and candidate says "2", nudge up.
  if (wantSeason != null && c.season != null && c.season === wantSeason) score += C.SEASON_BONUS;
  // If we want S1 (or unknown) prefer a candidate with NO season suffix.
  if ((wantSeason == null || wantSeason === 1) && c.season == null) score += 0.03;
  return score;
}

// Returns { slug, score, title } or null. seasonNum optional.
async function findSlug(tmdbId, seasonNum) {
  const cacheKey = 'slug:' + tmdbId + ':' + (seasonNum || 1);
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  const meta = await getMeta(tmdbId);
  if (!meta) return null;

  // Query order: VI titles first (best signal), then EN/original.
  const queries = [];
  for (const v of meta.viTitles) if (queries.indexOf(v) === -1) queries.push(v);
  for (const t of [meta.title, meta.original_title]) if (t && queries.indexOf(t) === -1) queries.push(t);
  if (!queries.length) return null;

  // Run the first two queries in parallel (usually VI + EN); stop early if a
  // strong match appears, else fall through to the rest.
  const seen = {};
  const candidates = [];
  const runQuery = async (q) => {
    const items = await siteSuggest(q);
    for (const it of items) {
      if (!it.isSeries) continue; // series-only scope
      const sc = scoreCandidate(it, q, meta, seasonNum);
      if (!(it.slug in seen) || sc > seen[it.slug]) {
        seen[it.slug] = sc;
      }
    }
  };

  await Promise.all(queries.slice(0, 2).map(runQuery));
  let best = bestOf(seen);
  if (!best || best.score < C.MATCH_MIN) {
    for (const q of queries.slice(2)) {
      await runQuery(q);
    }
    best = bestOf(seen);
  }

  const result = best && best.score >= C.MATCH_MIN ? best.slug : null;
  cache.set(cacheKey, result, C.TTL.slug);
  return result;
}

function bestOf(seen) {
  let best = null;
  for (const slug in seen) {
    if (!best || seen[slug] > best.score) best = { slug: slug, score: seen[slug] };
  }
  return best;
}

module.exports = { getMeta, findSlug, siteSuggest, parseSuggest, scoreCandidate };
