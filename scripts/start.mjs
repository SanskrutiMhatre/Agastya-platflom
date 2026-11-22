// `npm start`: run the server, rebuilding first if the build is out of date.
//
// A server started from an old build silently lacks routes the current app calls (the UI
// is served from the frontend build, the API from the backend build, and either can lag the
// sources). Comparing source and build times here means starting always runs what is on disk.
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Newest modification time of any file under `dir` (skipping dependencies and build output). */
function newest(dir) {
  let t = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === 'dist' || e.name === 'test-results' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    t = Math.max(t, e.isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);
  }
  return t;
}
const built = (file) => (fs.existsSync(file) ? fs.statSync(file).mtimeMs : 0);

const parts = [
  { name: 'backend', sources: [path.join(root, 'backend', 'src'), path.join(root, 'backend', 'package.json')], output: path.join(root, 'backend', 'dist', 'index.js') },
  { name: 'frontend', sources: [path.join(root, 'frontend', 'src'), path.join(root, 'frontend', 'public'), path.join(root, 'frontend', 'index.html')], output: path.join(root, 'frontend', 'dist', 'index.html') },
];
const mtime = (p) => (fs.statSync(p).isDirectory() ? newest(p) : fs.statSync(p).mtimeMs);

for (const part of parts) {
  const src = Math.max(...part.sources.filter(fs.existsSync).map(mtime));
  if (src > built(part.output)) {
    console.log(`[start] The ${part.name} build is out of date - rebuilding...`);
    const r = spawnSync('npm', ['--prefix', part.name, 'run', 'build'], { cwd: root, stdio: 'inherit', shell: true });
    if (r.status !== 0) { console.error(`[start] The ${part.name} build failed; not starting.`); process.exit(r.status ?? 1); }
  }
}

const child = spawn(process.execPath, [path.join(root, 'backend', 'dist', 'index.js')], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
