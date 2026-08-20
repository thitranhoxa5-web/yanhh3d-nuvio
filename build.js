'use strict';

/**
 * build.js — bundle src/yanhh3d/index.js -> providers/yanhh3d.js
 *
 * - format cjs, target es2015: esbuild LOWERS async/await into a Promise state
 *   machine, so the output has no `async`/`await` keywords (constraint R1 for
 *   the Nuvio Hermes runtime).
 * - platform 'neutral': no Node built-ins injected (R3). Runtime globals used by
 *   the plugin (fetch, AbortController, URL, TextDecoder, console) are left as-is.
 * - After bundling, assert R1 (no async/await keyword survives) and fail loudly.
 */

const esbuild = require('esbuild');
const fs = require('fs');
const path = require('path');

const pkg = require('./package.json');
const OUT = path.join(__dirname, 'providers', 'yanhh3d.js');
const DEV = process.argv.includes('--dev') || process.env.NODE_ENV !== 'production';

async function main() {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });

  await esbuild.build({
    entryPoints: [path.join(__dirname, 'src', 'yanhh3d', 'index.js')],
    outfile: OUT,
    bundle: true,
    format: 'cjs',
    target: ['es2015'],
    platform: 'neutral',
    minify: !DEV,
    legalComments: 'none',
    banner: {
      js:
        '/* yanhh3d Nuvio scraper v' +
        pkg.version +
        ' — built ' +
        new Date().toISOString() +
        ' — do not edit by hand (source in src/) */',
    },
  });

  // R1 assertion: the output must not contain raw async/await keywords.
  const code = fs.readFileSync(OUT, 'utf8');
  const violations = [];
  if (/\basync\b/.test(code)) violations.push('async');
  if (/\bawait\b/.test(code)) violations.push('await');
  if (violations.length) {
    console.error(
      '[build] R1 VIOLATION: output contains keyword(s): ' +
        violations.join(', ') +
        ' — Hermes will choke. Check esbuild target.'
    );
    process.exit(1);
  }

  const kb = (Buffer.byteLength(code) / 1024).toFixed(1);
  console.log('[build] OK -> providers/yanhh3d.js (' + kb + ' KB, ' + (DEV ? 'dev' : 'min') + ', es2015, no async/await)');
}

main().catch((e) => {
  console.error('[build] failed:', e);
  process.exit(1);
});
