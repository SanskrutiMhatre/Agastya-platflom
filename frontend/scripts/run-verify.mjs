// The heavy frontend verification stage (`npm run test:verify`): the suites that vite.config.ts leaves out of a bare `vitest run`, one file at a time.
//   node scripts/run-verify.mjs [--only name,name] [vitest args...]
// AGASTYA_VERIFY=1 lifts the exclusion. Each file runs in ITS OWN vitest process, one after the other: a suite that grows its grammar memo tables
// cannot starve another (a parallel run of these files beside the everyday suite lost a worker process: tinypool "onUnexpectedExit", WP-08 / QA-019),
// and a file that is slow or crashes is named in the summary instead of hiding the files after it (the 2026-11-27 gate run killed one shared
// process after 90 minutes with rules.test.ts still unreported).
// The every-element suite runs per issue in its own process (scripts/verify-elements.mjs at the repository root), so it is not listed here.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NAMES = ['inventory', 'brex-parity', 'brex-xpath', 'editor-controls', 'controls', 'editor', 'rules'];   // quickest first
const argv = process.argv.slice(2);
const onlyAt = argv.indexOf('--only');
const only = onlyAt >= 0 ? new Set(argv[onlyAt + 1].split(',')) : null;
const passThrough = onlyAt >= 0 ? [...argv.slice(0, onlyAt), ...argv.slice(onlyAt + 2)] : argv;
const vitest = path.join(frontend, 'node_modules', 'vitest', 'vitest.mjs');

const results = [];
for (const name of NAMES.filter((n) => !only || only.has(n))) {
  const file = `src/studio/__tests__/verify/${name}.test.ts`;
  const t0 = Date.now();
  console.log(`\n=== ${file}`);
  const r = spawnSync(process.execPath, [vitest, 'run', file, ...passThrough], {
    cwd: frontend, stdio: 'inherit', env: { ...process.env, AGASTYA_VERIFY: '1' },
  });
  results.push({ name, status: r.status, signal: r.signal, s: Math.round((Date.now() - t0) / 1000) });
}

console.log('\nverification suites:');
for (const r of results) console.log(`  ${r.status === 0 ? 'PASS' : 'FAIL'}  ${r.name.padEnd(16)} ${String(r.s).padStart(6)} s${r.signal ? `  (${r.signal})` : r.status !== 0 ? `  exit ${r.status}` : ''}`);
process.exit(results.every((r) => r.status === 0) ? 0 : 1);
