// Starts the REAL backend (serving the built client) on a throwaway workspace for the end-to-end suite.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const backend = path.resolve(here, '..', '..', 'backend');
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-v2-e2e-'));
process.env.AGASTYA_WORKSPACE_DIR = ws;
process.env.AGASTYA_CLIENT_DIST = path.resolve(here, '..', 'dist');
process.env.PORT = process.env.PORT || '4050';

const require = createRequire(import.meta.url);
const { start, stop } = require(path.join(backend, 'dist', 'index.js'));
await start(Number(process.env.PORT));
console.log(`e2e workspace: ${ws}`);

const quit = () => { try { stop(); } catch { /* already stopped */ } fs.rmSync(ws, { recursive: true, force: true }); process.exit(0); };
process.on('SIGINT', quit);
process.on('SIGTERM', quit);
