#!/usr/bin/env node
// Phase 3: compare a benchmark result with the performance budgets (docs/phase3/perf-budgets.json).
//
//   node scripts/ci/perf-budgets.mjs --backend FILE.json [--frontend FILE.json] [--budgets FILE] [--report FILE.md] [--strict]
//   (--backend / --frontend may be given several times, or as a,b,c: repeated runs, judged by their median; phase 8)
//
// Each budget names a value in one of the results (`source`: backend = backend/scripts/bench/phase3-baseline.js, frontend =
// frontend/scripts/perf/phase3-frontend.mjs) by a dotted path, and two limits:
//   max     the regression guard, derived from the measured baseline (with head-room for this host's noise): above it = FAIL
//   target  the goal of the audit (docs/audit/04-PERFORMANCE-AUDIT.md section 8, 12.6) or of Phase 3 (P3-2, 100+ users): above it = OVER TARGET,
//           reported, never failing (the optimisation phase works these down, then lowers `max`)
// A value that is missing from the result (a section not run, a step that failed) is MISSING: it fails under --strict, because a budget that is
// not measured is not met. Policy as scripts/ci/perf.mjs: the nightly reports and exits 0; the release profile (--strict) exits 1 on FAIL or MISSING.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function valueAt(obj, dotted) {
  let v = obj;
  for (const k of dotted.split('.')) { if (v == null) return undefined; v = Array.isArray(v) && /^\d+$/.test(k) ? v[Number(k)] : v[k]; }
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

/** The median of the numbers (the middle one, or the mean of the two middle ones); undefined for none. */
export function median(xs) {
  const s = xs.filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return undefined;
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : Math.round(((s[m - 1] + s[m]) / 2) * 1000) / 1000;
}

/**
 * -> [{ id, value, runs, max, target, status: ok | over-target | fail | missing }]
 * Phase 8 (noise-tolerant rule): a source may be one result or an array of results of repeated runs (`--backend a.json --backend b.json
 * --backend c.json`). The value judged is the MEDIAN of the runs that measured it, so one slow run on a busy host (a virus scan, the indexer,
 * a GC pause in the one sample) does not fail a budget: with three runs, two have to be over `max`. One run behaves exactly as before.
 * A budget is missing only when no run measured it.
 */
export function check(budgets, results) {
  return budgets.budgets.map((b) => {
    const src = results[b.source];
    const runs = src ? (Array.isArray(src) ? src : [src]).map((r) => valueAt(r, b.path)).filter((v) => v !== undefined) : [];
    const value = median(runs);
    const lower = b.better === 'higher';
    const beyond = (lim) => lim != null && value !== undefined && (lower ? value < lim : value > lim);
    const status = value === undefined ? 'missing' : beyond(b.max) ? 'fail' : beyond(b.target) ? 'over-target' : 'ok';
    return { id: b.id, what: b.what, unit: b.unit, value, runs, max: b.max, target: b.target ?? null, baseline: b.baseline ?? null, status };
  });
}

export function report(rows) {
  const L = ['| Budget | value | max (fail) | target | baseline | status |', '|---|---|---|---|---|---|'];
  for (const r of rows) L.push(`| ${r.id} | ${r.value ?? '-'} ${r.unit ?? ''}${r.runs && r.runs.length > 1 ? ` (median of ${r.runs.join(', ')})` : ''} | ${r.max ?? '-'} | ${r.target ?? '-'} | ${r.baseline ?? '-'} | ${r.status.toUpperCase()} |`);
  const n = (s) => rows.filter((r) => r.status === s).length;
  L.push('', `${rows.length} budgets: ${n('ok')} ok, ${n('over-target')} over target, ${n('fail')} FAIL, ${n('missing')} MISSING.`);
  return L.join('\n');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : undefined; };
  const opts = (k) => argv.flatMap((a, i) => (a === `--${k}` && argv[i + 1] ? argv[i + 1].split(',') : [])).filter(Boolean);
  const strict = argv.includes('--strict');
  const budgets = JSON.parse(fs.readFileSync(path.resolve(opt('budgets') ?? path.join(ROOT, 'docs', 'phase3', 'perf-budgets.json')), 'utf8'));
  const results = {};
  // a source given more than once (or as a,b,c) is several runs: the median is judged (see check)
  for (const s of ['backend', 'frontend']) { const files = opts(s); if (files.length) results[s] = files.map((f) => JSON.parse(fs.readFileSync(path.resolve(f), 'utf8'))); }
  if (!Object.keys(results).length) { console.error('perf-budgets: give --backend FILE.json and/or --frontend FILE.json'); process.exit(2); }
  // only the budgets of the results given are checked (a run of the backend bench alone is not "missing" every frontend budget)
  const rows = check({ budgets: budgets.budgets.filter((b) => results[b.source]) }, results);
  const text = report(rows);
  console.log(text);
  if (opt('report')) fs.writeFileSync(path.resolve(opt('report')), `# Performance budgets\n\n${text}\n`);
  const bad = rows.filter((r) => r.status === 'fail' || r.status === 'missing');
  if (strict && bad.length) { console.error(`perf-budgets: ${bad.length} budget(s) FAIL or MISSING (strict)`); process.exit(1); }
}
