'use strict';

// HLS master-playlist parsing. Given a master, expand into per-quality variants
// with normalized labels. If it is a media playlist (no STREAM-INF), the caller
// keeps a single "Auto" entry.

function isMaster(text) {
  return /#EXT-X-STREAM-INF/i.test(text || '');
}

function qualityFromHeight(h) {
  if (!h) return 'Auto';
  if (h >= 2000) return '2160p';
  if (h >= 1400) return '1080p'; // 1440 rounds to 1080p bucket for labeling
  if (h >= 1000) return '1080p';
  if (h >= 700) return '720p';
  if (h >= 450) return '480p';
  if (h >= 300) return '360p';
  return '240p';
}

// Resolve a possibly-relative variant URI against the master URL.
function absolutize(uri, baseUrl) {
  try {
    return new URL(uri, baseUrl).href;
  } catch (e) {
    return uri;
  }
}

// Returns [{ url, quality, height, bandwidth }] sorted by height desc.
function parseMaster(text, baseUrl) {
  const lines = String(text).split(/\r?\n/);
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!/^#EXT-X-STREAM-INF/i.test(line)) continue;
    const res = line.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bw = line.match(/BANDWIDTH=(\d+)/i);
    // The URI is the next non-comment line.
    let uri = '';
    for (let j = i + 1; j < lines.length; j++) {
      const l = lines[j].trim();
      if (l && l[0] !== '#') {
        uri = l;
        break;
      }
    }
    if (!uri) continue;
    const height = res ? parseInt(res[2], 10) : 0;
    out.push({
      url: absolutize(uri, baseUrl),
      quality: qualityFromHeight(height),
      height: height,
      bandwidth: bw ? parseInt(bw[1], 10) : 0,
    });
  }
  // Sort by height desc, then bandwidth desc.
  out.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
  return out;
}

module.exports = { isMaster, parseMaster, qualityFromHeight };
