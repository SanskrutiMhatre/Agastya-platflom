// Runs the browser verification (4 issues x 21 types, about 5 minutes). It is excluded from the everyday `npm run e2e`.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const frontend = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'frontend');
const r = spawnSync('npx', ['playwright', 'test', ...(process.argv.slice(2).length ? process.argv.slice(2) : ['zz-verify-'])], { cwd: frontend, stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, VERIFY_E2E: '1' } });
process.exit(r.status ?? 1);
