'use strict';

/**
 * yanhh3d — Nuvio local scraper. Entry point.
 *
 * Pipeline: findSlug (TMDB->slug) -> resolveEpisode (sever2 watch page) ->
 * extractStreams (Dailymotion clean HLS, fbcdn fallback) -> Stream[].
 *
 * Constraints: no async/await keyword survives the es2015 build (R1); all logic
 * inside getStreams; never throws, always resolves to an array (R2/R8).
 */

const { findSlug } = require('./search');
const { resolveEpisode } = require('./detail');
const { extractStreams } = require('./extractor');

/**
 * @param {string|number} tmdbId
 * @param {"movie"|"tv"} mediaType
 * @param {number=} seasonNum
 * @param {number=} episodeNum
 * @returns {Promise<Array>}
 */
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    // Scope: series only (docs/SITE_NOTES.md §Phạm vi).
    if (mediaType !== 'tv') return [];

    const slug = await findSlug(tmdbId, seasonNum);
    if (!slug) return [];

    const ep = await resolveEpisode(slug, seasonNum, episodeNum);
    if (!ep) return [];

    const streams = await extractStreams(ep.html, ep.epLabel);
    return Array.isArray(streams) ? streams : [];
  } catch (e) {
    console.log('[yanhh3d] getStreams error:', e && e.message ? e.message : e);
    return [];
  }
}

module.exports = { getStreams, _findSlug: findSlug };
