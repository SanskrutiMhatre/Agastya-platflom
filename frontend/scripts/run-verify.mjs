// The heavy frontend verification stage (`npm run test:verify`): the suites that vite.config.ts leaves out of a bare `vitest run`, one file at a time.
//   node scripts/run-verify.mjs [vitest args...]
// AGASTYA_VERIFY=1 lifts the exclusion; --no-file-parallelism keeps one worker, so a suite that grows its grammar memo tables cannot starve another
// (a parallel run of these files beside the everyday suite lost a worker process: tinypool "onUnexpectedExit", WP-08 / QA-019).
// The every-element suite runs per issue in its own process (scripts/verify-elements.mjs at the repository root), so it is not listed here.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FILES = ['rules', 'controls', 'editor', 'editor-controls', 'inventory', 'brex-parity', 'brex-xpath'].map((n) => `src/studio/__tests__/verify/${n}.test.ts`);
const vitest = path.join(frontend, 'node_modules', 'vitest', 'vitest.mjs');
const r = spawnSync(process.execPath, [vitest, 'run', '--no-file-parallelism', ...FILES, ...process.argv.slice(2)], {
  cwd: frontend, stdio: 'inherit', env: { ...process.env, AGASTYA_VERIFY: '1' },
});
process.exit(r.status ?? 1);
