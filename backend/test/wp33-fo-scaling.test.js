'use strict';
// WP-33 / PERF-003 benchmark B6: the FO stage of the direct S1000D engine (one xsltproc run over the whole publication, as
// engine/build.js runs it) must grow about linearly with the number of figure-bearing data modules.
//
// Before WP-33 it was super-quadratic: on the audit host 3 modules took 0.27 s, 50 took 14.65 s and 100 took 154 s; on this
// repository's host the same stylesheet took 7.8 s for 50, 61 s for 100 and 535 s for 200 of the modules below (after:
// 0.46, 0.90 and 2.8 s; docs/audit/IMPLEMENTATION-LOG.md, WP-33). The causes were
// whole-book scans per figure in the List of Illustrations, a preceding:: count per repeated id and a "//dmodule//figure[title]"
// that libxml2 evaluates with a quadratic merge.
//
// Every module is a clone of the e2e description module (same ids in every module, so the duplicate-id path is taken for every
// figure) with two titled figures, one untitled figure, a table and cross-references. Timings are printed so a run leaves a record.
// The limits are generous on purpose (a shared 8-core machine, timings vary up to 2x): they catch a return of the quadratic shape,
// not a few per cent.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { tmp } = require('./helpers');
const h = require('./helpers-fo-scale');

const WORK = tmp('agastya-wp33-scale-');
const SIZES = [50, 100, 200, 500];
const PARAMS = { 'frontmatter.style': 's1000d', 'layout.profile': 'xignal' };

async function timeFo(n) {
  const dir = path.join(WORK, `n${n}`);
  const pm = h.writePublication(dir, n, { figs: 2 });
  // best of two for the small sizes (start-up and file cache noise is a large part of them); one run for 500
  const runs = n <= 100 ? 2 : 1;
  let best = Infinity;
  for (let i = 0; i < runs; i++) best = Math.min(best, (await h.runFo({ input: pm, foOut: path.join(dir, 'out.fo'), params: PARAMS })).ms);
  return best / 1000;
}

test('B6: the FO stage grows about linearly with figure-bearing modules (50 / 100 / 200 / 500)', { timeout: 30 * 60 * 1000 }, async () => {
  const t = {};
  for (const n of SIZES) {
    t[n] = await timeFo(n);
    console.log(`FO stage, ${n} modules (${2 * n} titled figures): ${t[n].toFixed(2)} s`);
  }
  const exp = (a, b) => Math.log(t[b] / t[a]) / Math.log(b / a);
  console.log(`growth exponent 100->500: ${exp(100, 500).toFixed(2)}, 50->100 ratio ${(t[100] / t[50]).toFixed(2)}`);

  // Absolute ceilings, about 5x what this fix measures here (100 modules: about 2 s; before: 154 s on the audit host).
  assert.ok(t[100] < 15, `100 modules took ${t[100].toFixed(1)} s (limit 15 s; the WP-33 target is 10 s)`);
  assert.ok(t[500] < 90, `500 modules took ${t[500].toFixed(1)} s (limit 90 s)`);
  // Shape: doubling the book must not multiply the time by more than 3 (before: 6.5x to 10.5x per doubling), and from 100 to 500
  // modules the time must grow slower than n^2 (measured here about n^1.3; before: above n^3).
  assert.ok(t[100] / t[50] < 3, `50 -> 100 modules multiplied the time by ${(t[100] / t[50]).toFixed(2)} (limit 3)`);
  assert.ok(t[200] / t[100] < 3, `100 -> 200 modules multiplied the time by ${(t[200] / t[100]).toFixed(2)} (limit 3)`);
  assert.ok(exp(100, 500) < 2, `growth from 100 to 500 modules is n^${exp(100, 500).toFixed(2)} (limit n^2: this fix measures about n^1.3, before it was above n^3)`);
});
