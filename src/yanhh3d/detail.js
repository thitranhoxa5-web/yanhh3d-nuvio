'use strict';

// Episode resolution. Series use the /sever2/<slug>/tap-<N> path (clean 1:1
// numbering; the default server groups episodes into irregular clusters — see
// docs/SITE_NOTES.md §4). We fetch the episode page directly and, on miss,
// consult the parsed list to detect numbering offsets.

const C = require('./constants');
const cache = require('../utils/cache');
const { getText, siteHeaders, SITE } = require('../utils/http');

function episodeUrl(slug, ep) {
  return SITE + '/sever2/' + slug + '/tap-' + ep;
}

function is404(html) {
  return /404 Not Found/i.test((html || '').slice(0, 300));
}

// Parse the sever2 episode numbers present on a watch page.
function parseEpisodeList(html) {
  const nums = {};
  const re = /\/sever2\/[^"']*\/tap-(\d+)"/g;
  let m;
  while ((m = re.exec(html))) nums[parseInt(m[1], 10)] = true;
  return Object.keys(nums)
    .map(Number)
    .sort((a, b) => a - b);
}

// Returns { html, epLabel, ep } for the requested episode, or null.
async function resolveEpisode(slug, seasonNum, episodeNum) {
  const ep = episodeNum || 1; // series scope; movie would be tap-1 (excluded upstream)
  const label = 'S' + pad2(seasonNum || 1) + 'E' + pad2(ep);

  // Try the direct URL first (fast path).
  let html = await safeGet(episodeUrl(slug, ep));
  if (html && !is404(html)) {
    return { html: html, epLabel: label, ep: ep };
  }

  // Miss: load the episode list (from tap-1) to check bounds / offsets.
  const listHtml = await safeGet(episodeUrl(slug, 1));
  if (!listHtml || is404(listHtml)) return null;
  let eps = cache.get('episodes:' + slug);
  if (eps === undefined) {
    eps = parseEpisodeList(listHtml);
    cache.set('episodes:' + slug, eps, C.TTL.episodes);
  }

  if (eps.indexOf(ep) !== -1) {
    // Number exists in list but direct fetch failed transiently — retry once.
    html = await safeGet(episodeUrl(slug, ep));
    if (html && !is404(html)) return { html: html, epLabel: label, ep: ep };
  }

  // Absolute-numbering / out-of-range: if requested ep exceeds this slug's max,
  // it likely belongs to another season slug. Log and give up (no wrong stream).
  if (eps.length && ep > eps[eps.length - 1]) {
    console.log('[yanhh3d] ep ' + ep + ' > max ' + eps[eps.length - 1] + ' for ' + slug + ' (season split?)');
  }
  return null;
}

function pad2(n) {
  n = Number(n) || 0;
  return n < 10 ? '0' + n : '' + n;
}

async function safeGet(url) {
  try {
    return await getText(url, { headers: siteHeaders() }, 8000);
  } catch (e) {
    return null;
  }
}

module.exports = { resolveEpisode, episodeUrl, parseEpisodeList };
