'use strict';
// Checks this machine can run and publish. Run before first use: npm run doctor

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const root = path.resolve(__dirname, '..');
const paths = require(path.join(root, 'vendor', 'engine', 'paths'));

const rows = [];
const row = (name, ok, detail) => rows.push({ name, ok, detail });

const major = Number(process.versions.node.split('.')[0]);
row('Node.js >= 22.5 (node:sqlite)', major >= 22, process.version);
try { require('node:sqlite'); row('node:sqlite available', true, ''); } catch (e) { row('node:sqlite available', false, e.message); }

const java = spawnSync(paths.JAVA, ['-version'], { encoding: 'utf8' });
row('Java runtime (FOP renders PDF)', java.status === 0, java.status === 0 ? String((java.stderr || java.stdout).split('\n')[0]) : `not found - install a JRE 11+ or set JSS_JAVA (looked for "${paths.JAVA}")`);
row('xsltproc', fs.existsSync(paths.XSLTPROC), paths.XSLTPROC);
row('Apache FOP', fs.existsSync(paths.FOP_BAT), paths.FOP_BAT);
row('S1000D schemas', fs.existsSync(paths.SCHEMAS), paths.SCHEMAS);
row('Client build (optional)', fs.existsSync(path.resolve(root, '..', 'frontend', 'dist', 'index.html')), 'run "npm run build" in frontend/ to serve the UI from this process');

let bad = 0;
for (const r of rows) {
  console.log(`${r.ok ? ' ok ' : 'FAIL'}  ${r.name}${r.detail ? '  - ' + r.detail : ''}`);
  if (!r.ok && !/optional/.test(r.name)) bad++;
}
process.exit(bad ? 1 : 0);
