'use strict';

// Vietnamese-aware text utilities for fuzzy title matching.

// lowercase -> NFD -> strip combining diacritics -> đ->d -> drop non-alnum -> collapse spaces
function normalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // combining marks (Vietnamese tones)
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Remove season/part hints so "Đấu La Đại Lục 2" ~ "Đấu La Đại Lục".
// Returns { base, season } where season is a number if a hint was found.
function stripSeasonHints(s) {
  let str = ' ' + normalize(s) + ' ';
  let season = null;
  const pats = [
    /\bphan\s+(\d{1,2})\b/,     // "phần 2"
    /\bseason\s+(\d{1,2})\b/,   // "season 2"
    /\bpart\s+(\d{1,2})\b/,     // "part 2"
    /\bss\s*(\d{1,2})\b/,       // "ss2"
    /\bs\s*(\d{1,2})\b/,        // "s2"
    /\b(\d{1,2})nd\s+season\b/, // "2nd season"
    /\b(\d{1,2})(st|rd|th)\s+season\b/,
  ];
  for (const p of pats) {
    const m = str.match(p);
    if (m) {
      if (season == null) season = parseInt(m[1], 10);
      str = str.replace(p, ' ');
    }
  }
  // A bare trailing number ("... 2") is often a season too — capture but keep soft.
  const tail = str.match(/\s(\d{1,2})\s*$/);
  if (season == null && tail) season = parseInt(tail[1], 10);
  return { base: str.replace(/\s+/g, ' ').trim(), season: season };
}

function bigrams(s) {
  const set = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    set.set(g, (set.get(g) || 0) + 1);
  }
  return set;
}

// Sørensen–Dice coefficient over character bigrams. 0..1. Fast, no allocation blowup.
function similarity(a, b) {
  a = normalize(a).replace(/\s/g, '');
  b = normalize(b).replace(/\s/g, '');
  if (!a.length || !b.length) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  A.forEach((c) => (total += c));
  B.forEach((c) => (total += c));
  A.forEach((c, g) => {
    if (B.has(g)) inter += Math.min(c, B.get(g));
  });
  return (2 * inter) / total;
}

module.exports = { normalize, stripSeasonHints, similarity };
