#!/usr/bin/env node
// WP-34 (GAP-009): the feature-preservation check. "Not one feature is lost" is checked by a diff, not by memory.
//
//   npm run check:parity                 compare the code with docs/audit/baseline/parity-baseline.json; exit 1 on any unexplained removal
//   npm run parity:update                write the current surface as the new baseline (refused while a removal is unexplained)
//   node scripts/parity/check.mjs [--report FILE.md] [--json FILE.json] [--update] [--force]
//
// The surface has six categories: routes (every <Route>, with its permission condition, and whether it is a page or only a redirect), rail
// (the project rail per kind: S1000D, JSS, JSG, CIR), commands (the Studio command registry at run time, generated commands included),
// keys (Studio accelerators, the JSS/JSG shortcut registry, and the keys compared in the editors' own handlers), testids (data-testid values)
// and tests (browser test titles, unit and backend test files). Routes, test ids, tests and handler keys come from scan.mjs; commands, rail
// and registry keys from src/parity/parity-dump.test.ts, run here with vitest.
//
// A removed item needs a row in docs/audit/baseline/parity-explanations.json (category, key, reason, newHome, and the checklist row and
// decision it belongs to). Additions are listed and never fail. The baseline also lists the screens the owner removed before the baseline
// was taken (removedByOwner): they must stay redirects or absent, and the test that guards their absence must still exist.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { FRONTEND, ROOT, staticSurface } from './scan.mjs';
import { BASELINE_FILE, CATEGORIES, EXPLANATIONS_FILE, diffSurface, loadExplanations, readJson } from './diff.mjs';

const argv = process.argv.slice(2);
const opt = (n) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : undefined; };
const flag = (n) => argv.includes(`--${n}`);
const relRoot = (p) => path.relative(ROOT, p).split(path.sep).join('/');

// Screens the owner removed before the baseline (2026-11-26 / 2026-11-27, see docs/audit/16 section 2 and the platform memory). They are
// not present features: an old address is a redirect, and a browser test guards that the control stays gone.
const REMOVED_BY_OWNER = [
  { feature: 'Files (CSDB) page of a project', removed: '2026-11-26', route: '/projects/:id/csdb -> ../editor', note: 'an old link lands in the editor' },
  { feature: 'Second SNS screen ("SNS defaults", System 2 SNS) in the Administrator', removed: '2026-11-26', route: '/administrator/sns-defaults -> ../sns-presets', note: 'Numbering (SNS) is the one SNS screen', guard: 'e2e 00-platform.spec.ts > administrator: every V1 section is there; reference data is edited, maintenance and settings do real things' },
  { feature: 'Brand pack screen of a project', removed: '2026-11-26', route: '/projects/:id/settings/brand -> ../publishing', note: 'brand settings are on the Publishing tab' },
  { feature: 'Applicability UI (settings section, Configuration... beside Generate, the editor picker)', removed: '2026-11-26', guard: 'e2e s1000d-config.spec.ts > no applicability tools: no Applicability section in the settings, no Configuration… button beside Generate' },
  { feature: 'Codes strip and Codes button of the JSS and JSG editors', removed: '2026-11-27', guard: 'e2e doc-pages.spec.ts > the codes are not a strip on the editor page, and there is no Codes button: the code beside a heading is a badge, switched on from the Publication page', note: 'the code beside a heading stays, as a badge switched on from the Publication page' },
  { feature: 'PMC, ICN and contents code switches', removed: '2026-11-27', note: '`show` is `{ dmc }` only; the server accepts and ignores the old keys (backend tests)' },
];

function runtimeDump() {
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'parity-')), 'runtime.json');
  const vitest = path.join(FRONTEND, 'node_modules', 'vitest', 'vitest.mjs');
  const r = spawnSync(process.execPath, [vitest, 'run', 'src/parity/parity-dump.test.ts', '--reporter=dot'], {
    cwd: FRONTEND, env: { ...process.env, PARITY_DUMP: out }, encoding: 'utf8', timeout: 10 * 60_000,
  });
  if (r.status !== 0 || !fs.existsSync(out)) {
    process.stderr.write(`${r.stdout ?? ''}${r.stderr ?? ''}\nparity: the run-time dump (src/parity/parity-dump.test.ts) failed (exit ${r.status}).\n`);
    process.exit(2);
  }
  const data = JSON.parse(fs.readFileSync(out, 'utf8'));
  fs.rmSync(path.dirname(out), { recursive: true, force: true });
  return data;
}

function gitCommit() {
  const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : 'unknown';
}

const stat = staticSurface();
const rt = runtimeDump();
const current = {
  routes: stat.routes, rail: rt.rail, commands: rt.commands, keys: [...rt.keys, ...stat.handlerKeys], testids: stat.testids, tests: stat.tests,
};
const counts = Object.fromEntries(CATEGORIES.map((c) => [c, current[c].length]));

const { rows: explanations, problems } = loadExplanations();
const baseline = readJson(BASELINE_FILE, null);
const removedByOwner = baseline?.removedByOwner ?? REMOVED_BY_OWNER;

// the owner's removals stay removed: the old address is a redirect (never a page again) and the guarding test exists
const ownerProblems = [];
const routeKeys = new Set(current.routes.map((r) => r.key));
const pagePaths = new Set(current.routes.filter((r) => r.kind === 'page').map((r) => r.path));
const testKeys = new Set(current.tests.map((t) => t.key));
for (const f of removedByOwner) {
  if (f.route) {
    const p = f.route.split(' -> ')[0];
    if (pagePaths.has(p)) ownerProblems.push(`${f.feature}: ${p} is a page again`);
    if (!routeKeys.has(f.route)) ownerProblems.push(`${f.feature}: the redirect "${f.route}" is gone (an old link would now fall through)`);
  }
  if (f.guard && !testKeys.has(f.guard)) ownerProblems.push(`${f.feature}: the test that guards its absence is gone ("${f.guard}")`);
}

const d = baseline ? diffSurface(baseline, current, explanations) : { removed: [], unexplained: [], added: [], explainedButPresent: [] };

// ---- report --------------------------------------------------------------------------------------------------------------------------
const lines = [];
const say = (s = '') => { lines.push(s); };
say(`# Parity check (WP-34)`);
say();
say(`Baseline: ${baseline ? `${relRoot(BASELINE_FILE)} (captured ${baseline.captured} at ${baseline.commit})` : 'none yet'}; explanations: ${explanations.length} row(s) in ${relRoot(EXPLANATIONS_FILE)}.`);
say();
say('| Category | Baseline | Now | Removed | Explained | Unexplained | Added |');
say('|---|---|---|---|---|---|---|');
for (const c of CATEGORIES) {
  const rem = d.removed.filter((x) => x.category === c);
  say(`| ${c} | ${baseline?.categories?.[c]?.length ?? '-'} | ${counts[c]} | ${rem.length} | ${rem.filter((x) => x.explanation).length} | ${rem.filter((x) => !x.explanation).length} | ${d.added.filter((x) => x.category === c).length} |`);
}
if (d.unexplained.length) { say(); say('## Removed without an explanation (each needs a row in parity-explanations.json)'); say(); for (const x of d.unexplained) say(`* ${x.category}: \`${x.key}\``); }
const explainedRemovals = d.removed.filter((x) => x.explanation);
if (explainedRemovals.length) { say(); say('## Removed, explained'); say(); for (const x of explainedRemovals) say(`* ${x.category}: \`${x.key}\` -> ${x.explanation.newHome} (${x.explanation.reason})`); }
if (d.added.length) { say(); say(`## Added (${d.added.length}; not a failure: \`npm run parity:update\` records them)`); say(); for (const x of d.added.slice(0, 200)) say(`* ${x.category}: \`${x.key}\``); if (d.added.length > 200) say(`* ... and ${d.added.length - 200} more`); }
if (d.explainedButPresent.length) { say(); say('## Explanations for items that are still there (stale rows, warning only)'); say(); for (const x of d.explainedButPresent) say(`* ${x.category}: \`${x.key}\``); }
if (problems.length) { say(); say('## Problems in the explanations file'); say(); for (const p of problems) say(`* ${p}`); }
if (ownerProblems.length) { say(); say('## Screens the owner removed'); say(); for (const p of ownerProblems) say(`* ${p}`); }

const failed = d.unexplained.length > 0 || problems.length > 0 || ownerProblems.length > 0;
say();
say(failed ? `**FAIL**: ${d.unexplained.length} unexplained removal(s), ${problems.length} explanation problem(s), ${ownerProblems.length} owner-removal problem(s).`
  : `PASS: nothing removed without an explanation.`);

const report = `${lines.join('\n')}\n`;
if (opt('report')) fs.writeFileSync(path.resolve(opt('report')), report);
if (opt('json')) fs.writeFileSync(path.resolve(opt('json')), `${JSON.stringify({ counts, diff: d, problems, ownerProblems, failed }, null, 2)}\n`);
process.stdout.write(report);

// ---- update ----------------------------------------------------------------------------------------------------------------------------
if (flag('update')) {
  if (failed && !flag('force')) {
    process.stderr.write('\nparity: the baseline is not updated while a removal is unexplained (or the explanations or owner removals have problems). Explain it first; --force only for a first capture.\n');
    process.exit(1);
  }
  const strip = (items) => items.map(({ line, ...rest }) => rest);           // line numbers move with every edit: not part of the baseline
  const next = {
    _comment: 'WP-34 feature-preservation baseline. Generated by frontend/scripts/parity/check.mjs --update; do not edit by hand. Removals need a row in parity-explanations.json.',
    schema: 1,
    captured: new Date().toISOString().slice(0, 10),
    commit: gitCommit(),
    counts,
    removedByOwner,
    info: stat.info,
    categories: Object.fromEntries(CATEGORIES.map((c) => [c, strip(current[c])])),
  };
  fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(next, null, 2)}\n`);
  if (!fs.existsSync(EXPLANATIONS_FILE)) {
    fs.writeFileSync(EXPLANATIONS_FILE, `${JSON.stringify({ _comment: 'One row per item removed from the parity baseline: { category, key, reason, newHome, checklistRow, decision, batch, date }.', explanations: [] }, null, 2)}\n`);
  }
  process.stdout.write(`\nparity: baseline written to ${relRoot(BASELINE_FILE)} (${CATEGORIES.map((c) => `${c} ${counts[c]}`).join(', ')}).\n`);
  process.exit(0);
}
process.exit(failed ? 1 : 0);
