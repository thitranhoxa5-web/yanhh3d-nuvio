'use strict';

/**
 * yanhh3d — Nuvio local scraper. Entry point.
 *
 * Sprint 2: matching layer wired (tmdbId -> slug). Episode resolution and
 * stream extraction land in Sprint 3-4, so getStreams still returns [] once a
 * slug is found. The slug pipeline is exercised via _findSlug (debug export;
 * Nuvio only ever calls getStreams).
 *
 * Constraints: no async/await keyword survives the es2015 build (R1); all logic
 * inside getStreams; never throws, always resolves to an array (R2/R8).
 */

const { findSlug } = require('./search');

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

    // TODO Sprint 3-4: getEpisodes(slug) -> map (season,episode) -> epUrl
    //                  -> extract Dailymotion/fbcdn -> Stream[].
    void episodeNum;
    return [];
  } catch (e) {
    console.log('[yanhh3d] getStreams error:', e && e.message ? e.message : e);
    return [];
  }
}

module.exports = { getStreams, _findSlug: findSlug };
