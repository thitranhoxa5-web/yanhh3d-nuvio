/* yanhh3d Nuvio scraper v1.0.0 — built 2026-08-20T14:38:27.290Z — do not edit by hand (source in src/) */
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
    var DOMAINS2 = ["https://yanhh3d.pw", "https://yanhh3d.ee", "https://yanhh3d.work"];
    var USER_AGENT2 = "Mozilla/5.0 (Linux; Android 13; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
    var TOTAL_BUDGET_MS = 12e3;
    module2.exports = { DOMAINS: DOMAINS2, USER_AGENT: USER_AGENT2, TOTAL_BUDGET_MS };
  }
});

// src/yanhh3d/index.js
var { DOMAINS, USER_AGENT } = require_constants();
function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  return __async(this, null, function* () {
    try {
      if (mediaType !== "tv") {
        return [];
      }
      return [];
    } catch (e) {
      console.log("[yanhh3d] getStreams error:", e && e.message ? e.message : e);
      return [];
    }
  });
}
module.exports = { getStreams };
