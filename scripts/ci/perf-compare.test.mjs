// WP-20 (QA-013): the performance comparison rule. Acceptance of QA-013: "a deliberately slowed stylesheet or an O(n^2) loop in the importer is
// caught by the nightly" - here as data: a run 50 % slower than the median of the last five is a FAIL, 30 % an ALERT, noise is OK.
//   node --test scripts/ci/perf-compare.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { compare, median, metricsOf } from './perf-compare.mjs';

const KEY = 'dms100-assets200-pdf0|HOST|8';
const hist = (n, importMs = 1000, rss = 300) => Array.from({ length: n }, (_, i) => ({ key: KEY, metrics: { importMs: importMs + (i % 2 ? 30 : -30), validationMs: 400, peakRssMB: rss } }));

test('median', () => { assert.equal(median([3, 1, 2]), 2); assert.equal(median([4, 1, 3, 2]), 2.5); });

test('fewer than three comparable runs: no verdict, the baseline is being built', () => {
  const r = compare(hist(2), { key: KEY, metrics: { importMs: 9000 } });
  assert.equal(r.verdict, 'BASELINE');
});

test('runs of another size or machine are not compared', () => {
  const r = compare(hist(5).map((h) => ({ ...h, key: 'other' })), { key: KEY, metrics: { importMs: 9000 } });
  assert.equal(r.verdict, 'BASELINE');
});

test('noise within 25 % is OK', () => {
  const r = compare(hist(5), { key: KEY, metrics: { importMs: 1150, validationMs: 420, peakRssMB: 310 } });
  assert.equal(r.verdict, 'OK');
});

test('a 30 % slower import is an ALERT', () => {
  const r = compare(hist(5), { key: KEY, metrics: { importMs: 1300, validationMs: 400 } });
  assert.equal(r.verdict, 'ALERT');
  assert.equal(r.rows.find((x) => x.metric === 'importMs').status, 'ALERT');
});

test('a deliberately slowed step (+50 %) and a memory growth of +60 % FAIL', () => {
  assert.equal(compare(hist(5), { key: KEY, metrics: { importMs: 1500, validationMs: 400 } }).verdict, 'FAIL');
  assert.equal(compare(hist(5), { key: KEY, metrics: { importMs: 1000, peakRssMB: 480 } }).verdict, 'FAIL');
});

test('only the last five comparable runs count (an old slow era does not hide a new regression)', () => {
  const old = hist(10, 3000); const recent = hist(5, 1000);
  assert.equal(compare([...old, ...recent], { key: KEY, metrics: { importMs: 1500 } }).verdict, 'FAIL');
});

test('steps under 50 ms are not judged', () => {
  const h = Array.from({ length: 5 }, () => ({ key: KEY, metrics: { findingsMs: 10 } }));
  assert.equal(compare(h, { key: KEY, metrics: { findingsMs: 30 } }).verdict, 'OK');
});

test('metricsOf reads the probe output', () => {
  assert.deepEqual(metricsOf({ steps: { importMs: 5, htmlMs: 7 }, peakRssMB: 99, dms: 100 }), { importMs: 5, htmlMs: 7, peakRssMB: 99 });
});
