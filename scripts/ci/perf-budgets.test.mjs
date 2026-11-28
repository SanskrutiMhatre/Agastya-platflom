// Phase 3: the performance budget rule (scripts/ci/perf-budgets.mjs) and the committed budgets file.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { check, median, valueAt } from './perf-budgets.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('a value above max fails, between target and max is over target, a missing value is missing, higher-is-better is honoured', () => {
  const budgets = { budgets: [
    { id: 'a', source: 'backend', path: 'x.ms', max: 100, target: 50 },
    { id: 'b', source: 'backend', path: 'x.ms', max: 80, target: 50 },
    { id: 'c', source: 'backend', path: 'x.ms', max: 200, target: 100 },
    { id: 'd', source: 'backend', path: 'x.none', max: 1 },
    { id: 'e', source: 'frontend', path: 'y', max: 1 },
    { id: 'f', source: 'backend', path: 'rate', better: 'higher', max: 10, target: 20 },
  ] };
  const rows = Object.fromEntries(check(budgets, { backend: { x: { ms: 90 }, rate: 15 } }).map((r) => [r.id, r.status]));
  assert.deepEqual(rows, { a: 'over-target', b: 'fail', c: 'ok', d: 'missing', e: 'missing', f: 'over-target' });
});

test('phase 8: repeated runs are judged by their median: one slow run does not fail, two do; a budget one run missed is still measured', () => {
  const budgets = { budgets: [
    { id: 'lat', source: 'backend', path: 'p95', max: 100, target: 50 },
    { id: 'rate', source: 'backend', path: 'rate', better: 'higher', max: 10 },
    { id: 'some', source: 'backend', path: 'only', max: 5 },
  ] };
  const by = (results) => Object.fromEntries(check(budgets, results).map((r) => [r.id, r]));
  const oneSlow = by({ backend: [{ p95: 40, rate: 12, only: 1 }, { p95: 400, rate: 2 }, { p95: 45, rate: 11 }] });
  assert.equal(oneSlow.lat.status, 'ok'); assert.equal(oneSlow.lat.value, 45); assert.deepEqual(oneSlow.lat.runs, [40, 400, 45]);
  assert.equal(oneSlow.rate.status, 'ok', 'higher-is-better: one low run does not fail');
  assert.equal(oneSlow.some.status, 'ok'); assert.equal(oneSlow.some.value, 1);
  assert.equal(by({ backend: [{ p95: 140 }, { p95: 400 }, { p95: 45 }] }).lat.status, 'fail', 'two of three over max fail');
  assert.equal(by({ backend: [{ p95: 60 }, { p95: 80 }] }).lat.value, 70, 'an even count takes the mean of the middle two');
  assert.equal(by({ backend: { p95: 101 } }).lat.status, 'fail', 'one run (not an array) behaves as before');
  assert.equal(median([]), undefined);
});

test('dotted paths reach into arrays and ignore non-numbers', () => {
  assert.equal(valueAt({ a: [{ b: 3 }] }, 'a.0.b'), 3);
  assert.equal(valueAt({ a: { b: '3' } }, 'a.b'), undefined);
});

test('the committed budgets are well formed: unique ids, a known source, a max, and a target no looser than max', () => {
  const b = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'phase3', 'perf-budgets.json'), 'utf8'));
  const ids = new Set();
  for (const x of b.budgets) {
    assert.ok(!ids.has(x.id), `duplicate ${x.id}`); ids.add(x.id);
    assert.ok(['backend', 'frontend'].includes(x.source), `${x.id}: source`);
    assert.equal(typeof x.max, 'number', `${x.id}: max`);
    assert.ok(typeof x.path === 'string' && x.path.length, `${x.id}: path`);
    if (x.target != null) assert.ok(x.better === 'higher' ? x.target >= x.max : x.target <= x.max, `${x.id}: target ${x.target} looser than max ${x.max}`);
  }
  assert.ok(b.budgets.length >= 20);
});
