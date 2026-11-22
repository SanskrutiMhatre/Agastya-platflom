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
// Windows stops the bundled native tools (xsltproc, xmllint) at 259 characters of path. A file is <workspace>\projects\<project id>\csdb\<data module file>:
// the project id is the project name (up to 80 characters), a data module file name up to ~60. Leave room for both.
const workspace = path.resolve(process.env.AGASTYA_WORKSPACE_DIR || path.join(root, '..', 'workspace'));
const worst = workspace.length + '\\projects\\'.length + 80 + '\\csdb\\'.length + 60;
row('Workspace path length (Windows 259-character limit)', process.platform !== 'win32' || worst < 260,
  `${workspace} is ${workspace.length} characters; with an 80-character project name and a long data module file name a file path reaches ${worst}` +
  (worst < 260 || process.platform !== 'win32' ? '' : ' - move the workspace nearer the drive root (AGASTYA_WORKSPACE_DIR) or keep project names short'));

row('Client build (optional)', fs.existsSync(path.resolve(root, '..', 'frontend', 'dist', 'index.html')), 'run "npm run build" in frontend/ to serve the UI from this process');

let bad = 0;
for (const r of rows) {
  console.log(`${r.ok ? ' ok ' : 'FAIL'}  ${r.name}${r.detail ? '  - ' + r.detail : ''}`);
  if (!r.ok && !/optional/.test(r.name)) bad++;
}
process.exit(bad ? 1 : 0);
