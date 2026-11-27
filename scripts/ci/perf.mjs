#!/usr/bin/env node
// WP-20 (QA-013; audit 11 section 10.5): the performance probes as a gated stage. Runs backend/scripts/perf-phase17.js (a throwaway workspace,
// a project of N data modules and M pictures: package import, project export, validation, findings, assets list, HTML publication, delivery
// package, optionally the PDF; peak RSS) `--repeat` times, takes the per-metric median of the repeats, stores it as one JSON line in the
// history, and compares it with the median of the last five comparable runs (same size, same machine, same Node major) by
// scripts/ci/perf-compare.mjs: +25 % = ALERT, +40 % = FAIL.
//
//   node scripts/ci/perf.mjs [--profile nightly|release] [--size DMS,ASSETS,PDF] [--repeat N] [--strict] [--history DIR] [--evidence DIR] [--no-record]
//
// Policy (audit 10.5: "alert at +25 %, fail a release at +40 %"): the nightly reports ALERT and FAIL in its output and evidence and exits 0;
// the release profile (or --strict) exits 1 on FAIL. Reason, measured on this shared 8-core host on 2026-11-27: four identical 10-module runs
// gave a delivery step of 1 420 to 2 423 ms (+59 % between runs), so one run per night would fail on noise; the release takes 3 repeats.
// Sizes: nightly 100 modules, 200 pictures, no PDF; release 500, 1000, with the PDF (the figures of the Phase 17 record).
// History: verification-results/perf-history/perf.jsonl by default (git-ignored, it belongs to the runner, like the evidence). The first three
// runs on a machine only build the baseline: there is no verdict until then, and no budget number is invented.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compare, median, metricsOf } from './perf-compare.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const profile = opt('profile', 'nightly');
const SIZES = { nightly: '100,200,0', release: '500,1000,1' };
const [dms, assets, pdf] = opt('size', SIZES[profile] ?? SIZES.nightly).split(',').map(Number);
const REPEAT = Math.max(1, Number(opt('repeat', profile === 'release' ? '3' : '1')));
const STRICT = profile === 'release' || argv.includes('--strict');
// AGASTYA_PERF_HISTORY: a folder outside the checkout on a CI runner (a clean checkout removes git-ignored folders, and the history with them)
const HISTORY = path.resolve(opt('history', process.env.AGASTYA_PERF_HISTORY || path.join(ROOT, 'verification-results', 'perf-history')));
const EVIDENCE = opt('evidence') ? path.resolve(opt('evidence')) : null;

const dist = path.join(ROOT, 'backend', 'dist', 'app.js');
if (!fs.existsSync(dist)) { console.error('perf: backend/dist is missing; build the backend first (npx tsc -p backend)'); process.exit(2); }

/** One probe run: its JSON result, or exit with the reason it is not a measurement. */
function probe() {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'backend', 'scripts', 'perf-phase17.js'), String(dms), String(assets), String(pdf)], { cwd: path.join(ROOT, 'backend'), encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 90 * 60_000 });
  if (r.status !== 0) { console.error(`perf: the probe failed (exit ${r.status}${r.signal ? `, ${r.signal}` : ''})\n${(r.stderr || '').slice(-4000)}`); process.exit(1); }
  const out = r.stdout; const at = out.lastIndexOf('\n{') >= 0 ? out.lastIndexOf('\n{') + 1 : out.indexOf('{');
  let result;
  try { result = JSON.parse(out.slice(at)); } catch (e) { console.error(`perf: could not read the probe's JSON (${e.message})\n${out.slice(-2000)}`); process.exit(1); }
  // a probe whose steps did not work is not a measurement
  const broken = [];
  if (result.import?.status && result.import.status >= 300) broken.push(`import HTTP ${result.import.status}`);
  if (result.html?.status && result.html.status >= 300) broken.push(`HTML publication HTTP ${result.html.status}: ${result.html.error ?? ''}`);
  if (result.delivery?.status && result.delivery.status >= 300) broken.push(`delivery HTTP ${result.delivery.status}`);
  if (pdf && result.pdf?.status && result.pdf.status >= 300) broken.push(`PDF HTTP ${result.pdf.status}: ${result.pdf.error ?? ''}`);
  if (broken.length) { console.error(`perf: the probe ran but a step failed, so its time means nothing:\n  ${broken.join('\n  ')}`); process.exit(1); }
  return result;
}

console.log(`perf: ${dms} modules, ${assets} pictures, PDF ${pdf ? 'yes' : 'no'}, ${REPEAT} repeat(s) (profile ${profile}${STRICT ? ', FAIL exits 1' : ', report only'})`);
const t0 = Date.now();
const results = Array.from({ length: REPEAT }, (_, i) => { const res = probe(); console.log(`  run ${i + 1}/${REPEAT}: ${JSON.stringify(metricsOf(res))}`); return res; });
const runs = results.map(metricsOf);
const metrics = Object.fromEntries(Object.keys(runs[0]).map((k) => [k, median(runs.map((m) => m[k]).filter((v) => typeof v === 'number'))]));

const key = `dms${dms}-assets${assets}-pdf${pdf}|${os.hostname()}|${os.cpus().length}cpu|${process.version.split('.')[0]}`;
const commit = (() => { const g = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }); return g.status === 0 ? g.stdout.trim() : 'unknown'; })();
const entry = { at: new Date().toISOString(), commit, key, repeat: REPEAT, metrics, wallMs: Date.now() - t0 };
fs.mkdirSync(HISTORY, { recursive: true });
const file = path.join(HISTORY, 'perf.jsonl');
const history = fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean) : [];
const verdict = compare(history, entry);
if (!argv.includes('--no-record')) fs.appendFileSync(file, JSON.stringify(entry) + '\n');

const table = verdict.rows.map((x) => `  ${x.status.padEnd(8)} ${x.metric.padEnd(16)} ${String(x.value).padStart(8)}${x.median !== null ? `  median ${String(x.median).padStart(8)}  ${x.pct >= 0 ? '+' : ''}${x.pct} %` : ''}`).join('\n');
console.log(`${table}\nperf: ${verdict.verdict}${verdict.verdict === 'BASELINE' ? ` (${verdict.previous} earlier comparable run(s); a verdict needs 3)` : ` against the median of ${verdict.previous} earlier run(s)`}; history ${file}`);
if (EVIDENCE) { fs.mkdirSync(EVIDENCE, { recursive: true }); fs.writeFileSync(path.join(EVIDENCE, 'perf.json'), JSON.stringify({ entry, results, verdict }, null, 2) + '\n'); }
if (verdict.verdict === 'FAIL' && !STRICT) console.log('perf: FAIL reported (the nightly does not stop on it; the release profile does)');
process.exit(verdict.verdict === 'FAIL' && STRICT ? 1 : 0);
