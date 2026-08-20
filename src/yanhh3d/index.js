'use strict';

/**
 * yanhh3d — Nuvio local scraper. Entry point.
 *
 * Sprint 1: stub. Real orchestration (search -> episode -> extract) lands in
 * Sprint 2-4. This proves the build/load pipeline: it is written with
 * async/await in src/, and build.js (esbuild target es2015) lowers it to a
 * Promise state machine so providers/yanhh3d.js contains no async/await
 * keywords (constraint R1 for the Hermes runtime).
 *
 * Contract (R2/R8): all logic lives inside getStreams; it never throws and
 * always resolves to an array.
 */

const { DOMAINS, USER_AGENT } = require('./constants');

/**
 * @param {string|number} tmdbId
 * @param {"movie"|"tv"} mediaType
 * @param {number=} seasonNum
 * @param {number=} episodeNum
 * @returns {Promise<Array>}
 */
async function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  try {
    // Scope: series only. Movies are excluded (see docs/SITE_NOTES.md §Phạm vi).
    if (mediaType !== 'tv') {
      return [];
    }

    // Sprint 2-4 will implement: findSlug -> resolveEpisode -> extractStreams.
    // Reference constants so tree-shaking keeps them and the wiring is visible.
    void DOMAINS;
    void USER_AGENT;
    void tmdbId;
    void seasonNum;
    void episodeNum;

    return [];
  } catch (e) {
    // R8: never throw. Errors -> log + empty list.
    console.log('[yanhh3d] getStreams error:', e && e.message ? e.message : e);
    return [];
  }
}

module.exports = { getStreams };
