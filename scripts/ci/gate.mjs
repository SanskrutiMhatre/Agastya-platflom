#!/usr/bin/env node
// The offline quality gate (WP-08: QA-001, QA-002, QA-007, QA-017, QA-019). One command, no network, no hosted CI service:
//
//   node scripts/ci/gate.mjs [--profile pr|nightly|release] [--stages a,b] [--files x.test.js,y.test.js] [--jobs N] [--evidence DIR] [--keep-going]
//                            [--runs N] [--list]
//
// Stages, in order (scripts/ci/test-plan.json says which backend file belongs to which stage):
//   build            backend tsc (dist/ is what the tests run)          frontend-build  tsc --noEmit + vite build (the e2e server serves it)
//   typecheck        frontend tsc --noEmit (the backend build is its type check)
//   lint             scripts/ci/lint.mjs: ratchets (`any`, lazy require, .only) against scripts/ci/lint-baseline.json
//   parity           frontend/scripts/parity/check.mjs (WP-34, GAP-009): no route, rail item, command, key, test id or test removed without a row
//                    in docs/audit/baseline/parity-explanations.json; the report is parity.md in the evidence folder
//   theme            frontend token checks (WP-19/WP-20): tokens.css current, contrast pairs, token coverage, colour-literal lint
//   tools            backend/test/tools-canary.test.js: every tool the tests need, by name; the gate stops here when one is missing
//   security         the security matrix files (authorisation, routes, hostile input)
//   backend          every other backend file except the heavy and PDF-smoke ones, N files at a time, each in its own process
//   pdf-smoke        a fixed set of PDF-building files (one per engine and the furniture/cover/notice checks)
//   backend-heavy    the 21-type x issue suites and the full-book renders, ONE file at a time (QA-019: the native crash showed in parallel runs)
//   frontend         vitest, the everyday suite (vite.config.ts leaves the heavy verification out of it)
//   frontend-verify  the heavy verification suites, one file at a time (frontend/scripts/run-verify.mjs)
//   e2e              Playwright on the reference browser (Edge, D18), on E2E_PORT (default 4050), with a runner lock
//   visual           the theme and accessibility suite (WP-20): per-theme screenshots, G-UX-1 checks on the ten named routes; its own port
//                    (E2E_VISUAL_PORT, default 4060) and config (frontend/playwright.visual.config.ts)
//   perf             performance probes (WP-20, QA-013): scripts/ci/perf.mjs against the runner's history; the release fails on +40 %
//   release-tools    WP-24: the release-engineering tests (scripts/release/*.test.mjs, listed in test-plan.json scriptTests): manifest, SBOM,
//                    signing with a throwaway certificate, both offline verifiers, the host's --verify, doctor faults, support-bundle redaction
//   package          release-tools, then npm run package:win (with --release in the release profile: signed, time-stamped, EULA and publisher
//                    data present, or it refuses), verify:package, and scripts/release/verify-release.mjs over the result
//   readiness        scripts/ci/readiness.mjs (RES-011): the static release gates
//
// Profiles: pr = build, frontend-build, lint, parity, theme, tools, security, backend, pdf-smoke, frontend (about the PR budget of QA-001); nightly = everything
// up to e2e, then visual and perf; release = nightly + frontend-verify + package + readiness.
//
// Evidence (QA-017): DIR (default verification-results/ci/<UTC time>-<commit>) gets meta.json (commit, dirty tree, Node, OS, tool versions),
// one TAP or log file per test file / stage, junit for vitest, skips.json, summary.json and summary.md. Test result files are written there too
// (AGASTYA_TEST_RESULTS), not into the source tree.
//
// Skip policy (QA-007): every skip must carry a reason, and every file's skips must fit scripts/ci/skip-budget.json; a new skip fails the gate.
// Crashes (QA-019): a test process that ends with 0xC0000005 or another native exit is reported as NATIVE CRASH with its file; it is not retried.
// No stage retries a failed test (G-Q-5: a test that passes only on retry is a failure).

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = path.join(ROOT, 'backend'); const FRONTEND = path.join(ROOT, 'frontend');
const PLAN = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'ci', 'test-plan.json'), 'utf8'));

// ---- arguments ------------------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, dflt) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : dflt; };
const BUDGET_FILE = path.resolve(opt('skip-budget', path.join(ROOT, 'scripts', 'ci', 'skip-budget.json')));
const BUDGET = JSON.parse(fs.readFileSync(BUDGET_FILE, 'utf8'));
const flag = (name) => argv.includes(`--${name}`);
const PROFILES = {
  pr: ['build', 'frontend-build', 'lint', 'parity', 'theme', 'tools', 'security', 'backend', 'pdf-smoke', 'frontend'],      // frontend-build: the security headers test reads the served client
  nightly: ['build', 'frontend-build', 'typecheck', 'lint', 'parity', 'theme', 'tools', 'security', 'backend', 'pdf-smoke', 'backend-heavy', 'frontend', 'e2e', 'visual', 'perf'],
  release: ['build', 'frontend-build', 'typecheck', 'lint', 'parity', 'theme', 'tools', 'security', 'backend', 'pdf-smoke', 'backend-heavy', 'frontend', 'frontend-verify', 'e2e', 'visual', 'perf', 'package', 'readiness'],
};
const profile = opt('profile', 'pr');
if (!PROFILES[profile]) { console.error(`unknown profile ${profile} (pr, nightly, release)`); process.exit(2); }
const stages = opt('stages') ? opt('stages').split(',') : PROFILES[profile];
const onlyFiles = opt('files') ? opt('files').split(',').map((f) => path.basename(f)) : null;
const JOBS = Math.max(1, Number(opt('jobs', String(Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4)))))));
const RUNS = Math.max(1, Number(opt('runs', '1')));
const keepGoing = flag('keep-going');

// ---- which backend file runs where ---------------------------------------------------------------------------------------------
const allBackend = fs.readdirSync(path.join(BACKEND, 'test')).filter((f) => f.endsWith('.test.js')).sort();
const inPlan = new Set([PLAN.tools, ...PLAN.security, ...PLAN.pdfSmoke, ...PLAN.heavy]);
for (const f of inPlan) if (!allBackend.includes(f)) { console.error(`scripts/ci/test-plan.json names ${f}, which is not in backend/test`); process.exit(2); }
const scriptTests = PLAN.scriptTests || {};
for (const list of Object.values(scriptTests).filter(Array.isArray)) for (const f of list) if (!fs.existsSync(path.join(ROOT, f))) { console.error(`scripts/ci/test-plan.json scriptTests names ${f}, which does not exist`); process.exit(2); }
const backendFiles = {
  tools: [PLAN.tools],
  security: PLAN.security,
  'pdf-smoke': PLAN.pdfSmoke,
  'backend-heavy': PLAN.heavy,
  backend: allBackend.filter((f) => !inPlan.has(f)),
};
if (flag('list')) { for (const [s, fs_] of Object.entries(backendFiles)) console.log(`${s} (${fs_.length}): ${fs_.join(' ')}`); process.exit(0); }

// ---- evidence -------------------------------------------------------------------------------------------------------------------
const git = (...a) => { const r = spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : ''; };
const commit = git('rev-parse', 'HEAD') || 'unknown';
const dirty = git('status', '--porcelain', '--untracked-files=no') !== '';
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const EVIDENCE = path.resolve(opt('evidence', path.join(ROOT, 'verification-results', 'ci', `${stamp}-${commit.slice(0, 8)}`)));
fs.mkdirSync(EVIDENCE, { recursive: true });
const RESULTS_DIR = path.join(EVIDENCE, 'results'); fs.mkdirSync(RESULTS_DIR, { recursive: true });
// Every test process gets its own temporary folder (TEMP/TMP/TMPDIR) under the evidence folder (QA-010): what a test leaves behind is counted at
// the end instead of piling up in the machine's %TEMP%, and parallel runs cannot meet in a shared temp file. --shared-temp turns this off.
const TMP_DIR = path.join(os.tmpdir(), `agastya-gate-${stamp}-${process.pid}`);
const TMP_ENV = flag('shared-temp') ? {} : { TEMP: TMP_DIR, TMP: TMP_DIR, TMPDIR: TMP_DIR };
if (!flag('shared-temp')) fs.mkdirSync(TMP_DIR, { recursive: true });
const meta = {
  commit, dirty, profile, stages, startedAt: new Date().toISOString(), node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`,
  cpus: os.cpus().length, memGB: Math.round(os.totalmem() / 2 ** 30), jobs: JOBS, runs: RUNS, files: onlyFiles, tools: {},
};
const writeJson = (f, o) => fs.writeFileSync(path.join(EVIDENCE, f), JSON.stringify(o, null, 2) + '\n');
writeJson('meta.json', meta);
console.log(`gate: profile ${profile}, stages ${stages.join(' -> ')}\n      commit ${commit.slice(0, 12)}${dirty ? ' (uncommitted changes!)' : ''}, Node ${process.version}, evidence ${EVIDENCE}`);

// ---- running things -------------------------------------------------------------------------------------------------------------
const NATIVE = new Map([[3221225477, '0xC0000005 access violation'], [3221225725, '0xC00000FD stack overflow'], [3221226505, '0xC0000409 stack buffer overrun'], [134, 'abort']]);
const killTree = (child) => {
  if (!child.pid) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  else try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
};
/** Run a command with a wall-clock limit; output goes to a log file in the evidence folder (and, with echo, to the console). */
function run(cmd, args, { cwd = ROOT, env = {}, log, limitMs = 30 * 60_000, echo = false } = {}) {
  return new Promise((resolve) => {
    const out = fs.createWriteStream(log);
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd, env: { ...process.env, AGASTYA_TEST_RESULTS: RESULTS_DIR, FORCE_COLOR: '0', ...TMP_ENV, ...env }, detached: process.platform !== 'win32', windowsHide: true });
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; killTree(child); }, limitMs);
    for (const s of [child.stdout, child.stderr]) s.on('data', (d) => { out.write(d); if (echo) process.stdout.write(d); });
    child.on('error', (e) => { out.write(`\n[gate] could not start ${cmd}: ${e.message}\n`); });
    child.on('close', (code, signal) => {
      clearTimeout(timer); out.end();
      resolve({ code, signal, timedOut, ms: Date.now() - t0, native: NATIVE.get(code) || (code !== null && code > 255 ? `exit 0x${code.toString(16)}` : null) });
    });
  });
}
const nodeBin = process.execPath;
const npmCli = (pkgDir, ...a) => [nodeBin, [path.join(pkgDir, 'node_modules', ...a)]];

// ---- TAP (node --test) ------------------------------------------------------------------------------------------------------------
function parseTap(text, file) {
  const r = { tests: 0, pass: 0, fail: 0, skipped: 0, todo: 0, cancelled: 0, skips: [], failures: [] };
  for (const k of ['tests', 'pass', 'fail', 'skipped', 'todo', 'cancelled']) { const m = new RegExp(`^# ${k} (\\d+)`, 'm').exec(text); if (m) r[k] = Number(m[1]); }
  const re = /^(\s*)(ok|not ok) \d+ - (.*?)(?: # (SKIP|TODO)\b ?(.*))?$/gm;
  let m;
  while ((m = re.exec(text))) {
    const [, indent, status, name, dir, why] = m;
    if (dir === 'SKIP') r.skips.push({ file, test: name.replace(/\\#/g, '#'), reason: (why || '').trim(), nested: indent.length > 0 });
    else if (status === 'not ok' && dir !== 'TODO' && !/^test[\\/]/.test(name)) r.failures.push(name);
  }
  return r;
}

const results = []; const allSkips = []; let failed = false;
const record = (row) => { results.push(row); if (!row.ok) failed = true; writeJson('summary.json', { meta, results }); };

async function backendStage(stage, files, jobs) {
  const dir = path.join(EVIDENCE, stage); fs.mkdirSync(dir, { recursive: true });
  const list = onlyFiles ? files.filter((f) => onlyFiles.includes(f)) : files;
  const heavy = stage === 'backend-heavy';
  const limitMs = (heavy ? PLAN.heavyFileLimitMin : PLAN.fileLimitMin) * 60_000;
  const queue = [...list]; let okAll = true;
  const worker = async () => {
    for (let f; (f = queue.shift());) {
      for (let run_ = 1; run_ <= RUNS; run_++) {
        const log = path.join(dir, `${f}${RUNS > 1 ? `.run${run_}` : ''}.tap`);
        const r = await run(nodeBin, ['--test', '--test-reporter=tap', '--test-concurrency=1', `--test-timeout=${PLAN.testLimitMin * 60_000}`, `test/${f}`], { cwd: BACKEND, log, limitMs });
        const tap = parseTap(fs.readFileSync(log, 'utf8'), f);
        allSkips.push(...(run_ === 1 ? tap.skips : []));
        const why = r.timedOut ? `TIMEOUT after ${Math.round(limitMs / 60000)} min (killed)` : r.native ? `NATIVE CRASH (${r.native})` : r.code !== 0 ? `exit ${r.code}` : '';
        const ok = r.code === 0 && !r.timedOut && tap.fail === 0 && tap.cancelled === 0;
        if (!ok) okAll = false;
        record({ stage, file: f, run: run_, ok, ms: r.ms, tests: tap.tests, pass: tap.pass, fail: tap.fail, cancelled: tap.cancelled, skipped: tap.skipped, todo: tap.todo, why, failures: tap.failures.slice(0, 10) });
        console.log(`  ${ok ? 'PASS' : 'FAIL'} ${stage.padEnd(13)} ${f.padEnd(42)} ${String(tap.pass).padStart(3)}/${String(tap.tests).padEnd(3)} skip ${tap.skipped} ${(r.ms / 1000).toFixed(0).padStart(5)} s ${why}${tap.failures.length ? ` - ${tap.failures[0].slice(0, 90)}` : ''}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(jobs, list.length || 1) }, worker));
  return okAll;
}

async function simpleStage(stage, cmd, args, opts = {}) {
  const log = path.join(EVIDENCE, `${stage}.log`);
  const r = await run(cmd, args, { log, ...opts });
  const ok = r.code === 0 && !r.timedOut;
  const why = r.timedOut ? 'TIMEOUT (killed)' : r.native ? `NATIVE CRASH (${r.native})` : r.code !== 0 ? `exit ${r.code}` : '';
  record({ stage, ok, ms: r.ms, why, log: path.relative(EVIDENCE, log) });
  console.log(`  ${ok ? 'PASS' : 'FAIL'} ${stage.padEnd(13)} ${(r.ms / 1000).toFixed(0).padStart(5)} s ${why}${ok ? '' : `  (see ${log})`}`);
  return ok;
}

const STAGES = {
  build: () => simpleStage('build', ...npmCli(BACKEND, 'typescript', 'bin', 'tsc'), { cwd: BACKEND, limitMs: 10 * 60_000 }).then((ok) => ok),
  'frontend-build': async () => {
    const [n, a] = npmCli(FRONTEND, 'vite', 'bin', 'vite.js');
    return simpleStage('frontend-build', n, [...a, 'build'], { cwd: FRONTEND, limitMs: 15 * 60_000 });
  },
  typecheck: () => { const [n, a] = npmCli(FRONTEND, 'typescript', 'bin', 'tsc'); return simpleStage('typecheck', n, [...a, '--noEmit', '-p', '.'], { cwd: FRONTEND, limitMs: 10 * 60_000 }); },
  lint: () => simpleStage('lint', nodeBin, [path.join(ROOT, 'scripts', 'ci', 'lint.mjs')], { limitMs: 5 * 60_000 }),
  parity: () => simpleStage('parity', nodeBin, [path.join(FRONTEND, 'scripts', 'parity', 'check.mjs'), '--report', path.join(EVIDENCE, 'parity.md')], { cwd: FRONTEND, limitMs: 10 * 60_000 }),
  // WP-20: the four token checks one after the other (seconds each); all of them run, so the evidence shows every failure at once
  theme: async () => {
    let ok = true;
    for (const [name, script, ...args] of [['theme-build', 'build-tokens.mjs', '--check'], ['theme-contrast', 'check-contrast.mjs'], ['theme-coverage', 'check-coverage.mjs'], ['theme-literals', 'lint-colors.mjs']]) {
      ok = (await simpleStage(name, nodeBin, [path.join(FRONTEND, 'scripts', 'tokens', script), ...args], { cwd: FRONTEND, limitMs: 5 * 60_000 })) && ok;
    }
    return ok;
  },
  tools: async () => {
    const ok = await backendStage('tools', backendFiles.tools, 1);
    const tap = fs.readFileSync(path.join(EVIDENCE, 'tools', `${PLAN.tools}${RUNS > 1 ? '.run1' : ''}.tap`), 'utf8');
    meta.tools = Object.fromEntries([...tap.matchAll(/^# (pdfjs-dist|java|xsltproc|xmllint-wasm|Arial|dist built)[: ](.*)$/gm)].map((m) => [m[1], m[2].trim()]));
    writeJson('meta.json', meta);
    return ok;
  },
  security: () => backendStage('security', backendFiles.security, JOBS),
  backend: () => backendStage('backend', backendFiles.backend, JOBS),
  'pdf-smoke': () => backendStage('pdf-smoke', backendFiles['pdf-smoke'], Math.min(JOBS, 2)),
  'backend-heavy': () => backendStage('backend-heavy', backendFiles['backend-heavy'], 1),
  frontend: () => {
    const [n, a] = npmCli(FRONTEND, 'vitest', 'vitest.mjs');
    return simpleStage('frontend', n, [...a, 'run', '--reporter=default', '--reporter=junit', `--outputFile.junit=${path.join(EVIDENCE, 'frontend-junit.xml')}`], { cwd: FRONTEND, limitMs: 30 * 60_000 });
  },
  'frontend-verify': () => simpleStage('frontend-verify', nodeBin, [path.join(FRONTEND, 'scripts', 'run-verify.mjs')], { cwd: FRONTEND, limitMs: 240 * 60_000 }),   // release only; editor + rules alone took over 75 min on the 8-core host (2026-11-27)
  e2e: () => {
    const [n, a] = npmCli(FRONTEND, '@playwright', 'test', 'cli.js');
    return simpleStage('e2e', n, [...a, 'test'], { cwd: FRONTEND, limitMs: 90 * 60_000, env: { E2E_JUNIT: path.join(EVIDENCE, 'e2e-junit.xml'), E2E_CHANNEL: process.env.E2E_CHANNEL || 'msedge' } });
  },
  // WP-20: needs frontend-build (the server serves dist) and the built backend; its own port, so it never meets the e2e run
  visual: () => {
    const [n, a] = npmCli(FRONTEND, '@playwright', 'test', 'cli.js');
    return simpleStage('visual', n, [...a, 'test', '-c', 'playwright.visual.config.ts'], { cwd: FRONTEND, limitMs: 45 * 60_000, env: { E2E_PORT: process.env.E2E_VISUAL_PORT || '4060', E2E_JUNIT: path.join(EVIDENCE, 'visual-junit.xml'), E2E_CHANNEL: process.env.E2E_CHANNEL || 'msedge' } });
  },
  perf: async () => (await simpleStage('perf-rule', nodeBin, ['--test', path.join(ROOT, 'scripts', 'ci', 'perf-compare.test.mjs')], { limitMs: 2 * 60_000 }))
    && simpleStage('perf', nodeBin, [path.join(ROOT, 'scripts', 'ci', 'perf.mjs'), '--profile', profile === 'release' ? 'release' : 'nightly', '--evidence', EVIDENCE], { limitMs: 120 * 60_000 }),
  // WP-24: the release-engineering tests, one file per process (they compile the host, make and delete a throwaway certificate)
  'release-tools': async () => {
    let ok = true;
    for (const f of scriptTests['release-tools'] || []) {
      ok = (await simpleStage(`release-tools-${path.basename(f, '.test.mjs')}`, nodeBin, ['--test', '--test-concurrency=1', path.join(ROOT, f)], { limitMs: 10 * 60_000 })) && ok;
    }
    return ok;
  },
  package: async () => (await STAGES['release-tools']())
    && (await simpleStage('package', nodeBin, [path.join(ROOT, 'scripts', 'package-windows.mjs'), ...(profile === 'release' ? ['--release'] : [])], { limitMs: 60 * 60_000 }))
    && (await simpleStage('verify-package', nodeBin, [path.join(ROOT, 'scripts', 'verify-package-offline.mjs')], { limitMs: 30 * 60_000 }))
    && simpleStage('verify-release', nodeBin, [path.join(ROOT, 'scripts', 'release', 'verify-release.mjs'), '--release', path.join(ROOT, 'release'),
      ...(profile === 'release' ? ['--require-signed', '--require-timestamp'] : [])], { limitMs: 30 * 60_000 }),
  readiness: () => simpleStage('readiness', nodeBin, [path.join(ROOT, 'scripts', 'ci', 'readiness.mjs'), '--evidence', EVIDENCE], { limitMs: 30 * 60_000 }),
};

// ---- skip budget ------------------------------------------------------------------------------------------------------------------
function checkSkips() {
  const problems = []; const perFile = {};
  for (const s of allSkips) (perFile[s.file] ||= []).push(s);
  for (const s of allSkips) if (!s.reason) problems.push(`${s.file}: "${s.test}" is skipped without a reason`);
  for (const [file, list] of Object.entries(perFile)) {
    const b = BUDGET.files[file];
    if (!b) problems.push(`${file}: ${list.length} skip(s) but the file has no entry in scripts/ci/skip-budget.json (${list[0].reason})`);
    else if (list.length > b.max) problems.push(`${file}: ${list.length} skips, the budget allows ${b.max} (${b.why})`);
  }
  writeJson('skips.json', { budget: path.relative(ROOT, BUDGET_FILE), skips: allSkips, problems });
  return problems;
}

// ---- main ----------------------------------------------------------------------------------------------------------------------
for (const s of stages) {
  if (!STAGES[s]) { console.error(`unknown stage ${s}; known: ${Object.keys(STAGES).join(', ')}`); process.exit(2); }
  console.log(`\n== ${s}`);
  const ok = await STAGES[s]();
  if (!ok && (s === 'build' || s === 'tools')) { console.log(`\n${s} failed: nothing after it can be trusted; stopping.`); break; }
  if (!ok && !keepGoing) { console.log(`\n${s} failed; stopping (--keep-going runs the remaining stages).`); break; }
}
if (!flag('shared-temp')) {
  // what the tests left in their temporary folder (the folder itself is removed afterwards; the list is kept in the evidence)
  const left = fs.readdirSync(TMP_DIR);
  meta.tempLeftovers = { count: left.length, sample: left.slice(0, 30) };
  console.log(`\ntemporary folders/files left by the tests: ${left.length}${left.length ? ` (e.g. ${left.slice(0, 5).join(', ')})` : ''}`);
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 }); } catch (e) { console.log(`  could not remove ${TMP_DIR}: ${e.message}`); }
}
const skipProblems = checkSkips();
if (skipProblems.length) { failed = true; console.log(`\nskip policy:\n  ${skipProblems.join('\n  ')}`); }
meta.finishedAt = new Date().toISOString(); writeJson('meta.json', meta);

const rows = results.map((r) => `| ${r.ok ? 'PASS' : '**FAIL**'} | ${r.stage} | ${r.file ?? ''} | ${r.pass ?? ''}${r.tests !== undefined ? `/${r.tests}` : ''} | ${r.skipped ?? ''} | ${(r.ms / 1000).toFixed(0)} | ${r.why || ''} |`);
const skipRows = allSkips.map((s) => `| ${s.file} | ${s.test.replace(/\|/g, '/')} | ${(s.reason || '**no reason**').replace(/\|/g, '/')} |`);
fs.writeFileSync(path.join(EVIDENCE, 'summary.md'), [
  `# Gate ${profile}: ${failed ? 'FAILED' : 'PASSED'}`, '',
  `Commit \`${commit}\`${dirty ? ' (with uncommitted changes)' : ''}; Node ${process.version}; ${meta.platform}; ${meta.startedAt} to ${meta.finishedAt}.`,
  `Tools: ${Object.entries(meta.tools).map(([k, v]) => `${k} ${v}`).join('; ') || 'not recorded (tools stage not run)'}.`,
  meta.tempLeftovers ? `Temporary entries left by the tests: ${meta.tempLeftovers.count}${meta.tempLeftovers.count ? ` (${meta.tempLeftovers.sample.slice(0, 10).join(', ')})` : ''}.` : '', '',
  '| Result | Stage | File | Pass | Skip | s | Note |', '|---|---|---|---|---|---|---|', ...rows, '',
  `## Skips (${allSkips.length})`, '', '| File | Test | Reason |', '|---|---|---|', ...skipRows, '',
  ...(skipProblems.length ? ['## Skip policy violations', '', ...skipProblems.map((p) => `* ${p}`), ''] : []),
].join('\n'));
console.log(`\ngate ${failed ? 'FAILED' : 'PASSED'}: ${results.filter((r) => r.ok).length}/${results.length} steps green, ${allSkips.length} skips; evidence ${path.join(EVIDENCE, 'summary.md')}`);
process.exit(failed ? 1 : 0);
