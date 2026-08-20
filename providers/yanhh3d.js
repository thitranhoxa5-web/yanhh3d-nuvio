/* yanhh3d Nuvio scraper v1.0.0 — built 2026-08-20T14:49:11.714Z — do not edit by hand (source in src/) */
"use strict";
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __async = (__this, __arguments, generator) => {
  return new Promise((resolve, reject) => {
    var fulfilled = (value) => {
      try {
        step(generator.next(value));
      } catch (e) {
        reject(e);
      }
    };
    var rejected = (value) => {
      try {
        step(generator.throw(value));
      } catch (e) {
        reject(e);
      }
    };
    var step = (x) => x.done ? resolve(x.value) : Promise.resolve(x.value).then(fulfilled, rejected);
    step((generator = generator.apply(__this, __arguments)).next());
  });
};

// src/yanhh3d/constants.js
var require_constants = __commonJS({
  "src/yanhh3d/constants.js"(exports2, module2) {
    "use strict";
    var DOMAINS = ["https://yanhh3d.pw", "https://yanhh3d.ee", "https://yanhh3d.work"];
    var USER_AGENT = "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    var TOTAL_BUDGET_MS = 12e3;
    var TMDB_API_KEY = "439c478a771f35c05022f9feabcca01c";
    var TMDB_BASE = "https://api.themoviedb.org/3";
    var MATCH_MIN = 0.72;
    var YEAR_BONUS = 0.15;
    var SEASON_BONUS = 0.1;
    var TTL = { slug: 6 * 36e5, episodes: 30 * 6e4, link: 3 * 6e4 };
    module2.exports = {
      DOMAINS,
      USER_AGENT,
      TOTAL_BUDGET_MS,
      TMDB_API_KEY,
      TMDB_BASE,
      MATCH_MIN,
      YEAR_BONUS,
      SEASON_BONUS,
      TTL
    };
  }
});

// src/utils/http.js
var require_http = __commonJS({
  "src/utils/http.js"(exports2, module2) {
    "use strict";
    var { USER_AGENT, DOMAINS } = require_constants();
    var SITE = DOMAINS[0];
    function siteHeaders(extra) {
      return Object.assign(
        {
          "User-Agent": USER_AGENT,
          Referer: SITE + "/",
          Origin: SITE,
          "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8"
        },
        extra || {}
      );
    }
    function fetchWithTimeout(url, opts, ms) {
      return __async(this, null, function* () {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), ms || 8e3);
        try {
          return yield fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
        } finally {
          clearTimeout(timer);
        }
      });
    }
    function getText(url, opts, ms) {
      return __async(this, null, function* () {
        const res = yield fetchWithTimeout(url, opts, ms);
        if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
        return res.text();
      });
    }
    function getJson(url, opts, ms) {
      return __async(this, null, function* () {
        const res = yield fetchWithTimeout(url, opts, ms);
        if (!res.ok) throw new Error("HTTP " + res.status + " for " + url);
        return res.json();
      });
    }
    module2.exports = { siteHeaders, fetchWithTimeout, getText, getJson, SITE };
  }
});

// src/utils/cache.js
var require_cache = __commonJS({
  "src/utils/cache.js"(exports2, module2) {
    "use strict";
    var store = /* @__PURE__ */ new Map();
    function get(key) {
      const e = store.get(key);
      if (!e) return void 0;
      if (Date.now() > e.exp) {
        store.delete(key);
        return void 0;
      }
      return e.val;
    }
    function set(key, val, ttlMs) {
      store.set(key, { val, exp: Date.now() + (ttlMs || 0) });
      return val;
    }
    function wrap(key, ttlMs, producer) {
      return __async(this, null, function* () {
        const hit = get(key);
        if (hit !== void 0) return hit;
        const val = yield producer();
        if (val !== void 0 && val !== null) set(key, val, ttlMs);
        return val;
      });
    }
    module2.exports = { get, set, wrap };
  }
});

// src/utils/text.js
var require_text = __commonJS({
  "src/utils/text.js"(exports2, module2) {
    "use strict";
    function normalize(s) {
      if (!s) return "";
      return String(s).toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ").trim();
    }
    function stripSeasonHints(s) {
      let str = " " + normalize(s) + " ";
      let season = null;
      const pats = [
        /\bphan\s+(\d{1,2})\b/,
        // "phần 2"
        /\bseason\s+(\d{1,2})\b/,
        // "season 2"
        /\bpart\s+(\d{1,2})\b/,
        // "part 2"
        /\bss\s*(\d{1,2})\b/,
        // "ss2"
        /\bs\s*(\d{1,2})\b/,
        // "s2"
        /\b(\d{1,2})nd\s+season\b/,
        // "2nd season"
        /\b(\d{1,2})(st|rd|th)\s+season\b/
      ];
      for (const p of pats) {
        const m = str.match(p);
        if (m) {
          if (season == null) season = parseInt(m[1], 10);
          str = str.replace(p, " ");
        }
      }
      const tail = str.match(/\s(\d{1,2})\s*$/);
      if (season == null && tail) season = parseInt(tail[1], 10);
      return { base: str.replace(/\s+/g, " ").trim(), season };
    }
    function bigrams(s) {
      const set = /* @__PURE__ */ new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const g = s.slice(i, i + 2);
        set.set(g, (set.get(g) || 0) + 1);
      }
      return set;
    }
    function similarity(a, b) {
      a = normalize(a).replace(/\s/g, "");
      b = normalize(b).replace(/\s/g, "");
      if (!a.length || !b.length) return 0;
      if (a === b) return 1;
      if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
      const A = bigrams(a);
      const B = bigrams(b);
      let inter = 0;
      let total = 0;
      A.forEach((c) => total += c);
      B.forEach((c) => total += c);
      A.forEach((c, g) => {
        if (B.has(g)) inter += Math.min(c, B.get(g));
      });
      return 2 * inter / total;
    }
    module2.exports = { normalize, stripSeasonHints, similarity };
  }
});

// src/yanhh3d/search.js
var require_search = __commonJS({
  "src/yanhh3d/search.js"(exports2, module2) {
    "use strict";
    var C = require_constants();
    var { getJson, getText, siteHeaders, SITE } = require_http();
    var cache = require_cache();
    var { normalize, stripSeasonHints, similarity } = require_text();
    function getMeta(tmdbId) {
      return __async(this, null, function* () {
        return cache.wrap("meta:" + tmdbId, C.TTL.slug, () => __async(this, null, function* () {
          const key = "?api_key=" + C.TMDB_API_KEY;
          const base = C.TMDB_BASE + "/tv/" + tmdbId;
          let detail, trans, alt;
          try {
            detail = yield getJson(base + key, { headers: { "User-Agent": C.USER_AGENT } }, 6e3);
          } catch (e) {
            return null;
          }
          try {
            trans = yield getJson(base + "/translations" + key, { headers: { "User-Agent": C.USER_AGENT } }, 6e3);
          } catch (e) {
            trans = { translations: [] };
          }
          try {
            alt = yield getJson(base + "/alternative_titles" + key, { headers: { "User-Agent": C.USER_AGENT } }, 6e3);
          } catch (e) {
            alt = { results: [] };
          }
          const viTrans = (trans.translations || []).find((x) => x.iso_639_1 === "vi");
          const viTitles = [];
          if (viTrans && viTrans.data && viTrans.data.name) viTitles.push(viTrans.data.name);
          for (const a of alt.results || []) {
            if (a.iso_3166_1 === "VN" && a.title) viTitles.push(a.title);
          }
          return {
            title: detail.name || detail.original_name || "",
            original_title: detail.original_name || "",
            year: (detail.first_air_date || "").slice(0, 4),
            viTitles
          };
        }));
      });
    }
    function isSeriesEp(epQuality) {
      const ep = normalize(epQuality);
      const movieLike = /full\s?movie|\bova\b|trailer|tom tat|tong ket|^full\s?hd$|^full$/.test(ep);
      if (movieLike) return false;
      return /\d+\s*\/\s*\d+/.test(epQuality) || /\btap\b/.test(ep);
    }
    function parseSuggest(dataHtml) {
      const html = (dataHtml || "").split("\\/").join("/");
      const re = /<a[^>]*title="([^"]*)"[^>]*href="([^"]*)"[\s\S]*?title-search[^>]*>([^<]*)<[\s\S]*?ep-search[^>]*>([^<]*)</g;
      const out = [];
      let m;
      while (m = re.exec(html)) {
        const slug = m[2].split("/").filter(Boolean).pop();
        const epQuality = m[4].trim();
        out.push({
          slug,
          title: (m[3] || m[1]).trim(),
          epQuality,
          isSeries: isSeriesEp(epQuality)
        });
      }
      return out;
    }
    function siteSuggest(kw) {
      return __async(this, null, function* () {
        try {
          const j = yield getJson(
            SITE + "/ajax/search/suggest?keysearch=" + encodeURIComponent(kw),
            { headers: siteHeaders({ "X-Requested-With": "XMLHttpRequest" }) },
            7e3
          );
          return parseSuggest(j.data);
        } catch (e) {
          return [];
        }
      });
    }
    function scoreCandidate(cand, queryTitle, meta, wantSeason) {
      const q = stripSeasonHints(queryTitle);
      const c = stripSeasonHints(cand.title);
      let score = similarity(q.base, c.base);
      if (meta.year && cand.title && String(cand.title).indexOf(meta.year) !== -1) score += C.YEAR_BONUS;
      if (wantSeason != null && c.season != null && c.season === wantSeason) score += C.SEASON_BONUS;
      if ((wantSeason == null || wantSeason === 1) && c.season == null) score += 0.03;
      return score;
    }
    function findSlug2(tmdbId, seasonNum) {
      return __async(this, null, function* () {
        const cacheKey = "slug:" + tmdbId + ":" + (seasonNum || 1);
        const cached = cache.get(cacheKey);
        if (cached !== void 0) return cached;
        const meta = yield getMeta(tmdbId);
        if (!meta) return null;
        const queries = [];
        for (const v of meta.viTitles) if (queries.indexOf(v) === -1) queries.push(v);
        for (const t of [meta.title, meta.original_title]) if (t && queries.indexOf(t) === -1) queries.push(t);
        if (!queries.length) return null;
        const seen = {};
        const candidates = [];
        const runQuery = (q) => __async(this, null, function* () {
          const items = yield siteSuggest(q);
          for (const it of items) {
            if (!it.isSeries) continue;
            const sc = scoreCandidate(it, q, meta, seasonNum);
            if (!(it.slug in seen) || sc > seen[it.slug]) {
              seen[it.slug] = sc;
            }
          }
        });
        yield Promise.all(queries.slice(0, 2).map(runQuery));
        let best = bestOf(seen);
        if (!best || best.score < C.MATCH_MIN) {
          for (const q of queries.slice(2)) {
            yield runQuery(q);
          }
          best = bestOf(seen);
        }
        const result = best && best.score >= C.MATCH_MIN ? best.slug : null;
        cache.set(cacheKey, result, C.TTL.slug);
        return result;
      });
    }
    function bestOf(seen) {
      let best = null;
      for (const slug in seen) {
        if (!best || seen[slug] > best.score) best = { slug, score: seen[slug] };
      }
      return best;
    }
    module2.exports = { getMeta, findSlug: findSlug2, siteSuggest, parseSuggest, scoreCandidate };
  }
});

// src/yanhh3d/index.js
var { findSlug } = require_search();
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    try {
      if (mediaType !== "tv") return [];
      const slug = yield findSlug(tmdbId, seasonNum);
      if (!slug) return [];
      return [];
    } catch (e) {
      console.log("[yanhh3d] getStreams error:", e && e.message ? e.message : e);
      return [];
    }
  });
}
module.exports = { getStreams, _findSlug: findSlug };
