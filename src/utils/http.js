'use strict';

// Minimal HTTP helpers. Full retry/parallel logic lands in Sprint 5; for now:
// fetchWithTimeout (AbortController + guaranteed timer cleanup) and json/text
// wrappers with the site header preset. Only fetch/AbortController used (R3).

const { USER_AGENT, DOMAINS } = require('../yanhh3d/constants');

const SITE = DOMAINS[0];

// Standard headers for site + CDN requests. Referer/Origin = primary domain (R7).
function siteHeaders(extra) {
  return Object.assign(
    {
      'User-Agent': USER_AGENT,
      Referer: SITE + '/',
      Origin: SITE,
      'Accept-Language': 'vi-VN,vi;q=0.9,en;q=0.8',
    },
    extra || {}
  );
}

async function fetchWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms || 8000);
  try {
    return await fetch(url, Object.assign({ signal: ctrl.signal }, opts || {}));
  } finally {
    clearTimeout(timer);
  }
}

async function getText(url, opts, ms) {
  const res = await fetchWithTimeout(url, opts, ms);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.text();
}

async function getJson(url, opts, ms) {
  const res = await fetchWithTimeout(url, opts, ms);
  if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
  return res.json();
}

module.exports = { siteHeaders, fetchWithTimeout, getText, getJson, SITE };
