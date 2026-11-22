// Runs the every-element verification one issue per process (a single long-lived worker accumulates the grammar memo tables and dies).
//   node scripts/verify-elements.mjs [issue ...]      default: 4-2 5-0 6 7  (about 6 minutes each)
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const issues = process.argv.slice(2).length ? process.argv.slice(2) : ['4-2', '5-0', '6', '7'];
let failed = false;
for (const issue of issues) {
  console.log(`\n=== every element, issue ${issue} ===`);
  const r = spawnSync('npx', ['vitest', 'run', 'src/studio/__tests__/verify/elements.test.ts'], { cwd: frontend, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, VERIFY_ONLY: issue, NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ''} --max-old-space-size=16384`.trim() } });
  if (r.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
