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
// WP-13 (ENT-008): the product ships Node 24 LTS (packaging/product.json runtime.node); a source checkout also runs on Node 22.13+.
row('Node.js 24 LTS (or 22.13+ for development)', major === 24 || (major === 22 && Number(process.versions.node.split('.')[1]) >= 13), process.version);
try { require('node:sqlite'); row('node:sqlite available', true, ''); } catch (e) { row('node:sqlite available', false, e.message); }
// WP-13 (ARC-019): Argon2 is required; the server does not start without it.
try { require('argon2'); row('argon2 password hashing (required)', true, ''); } catch (e) { row('argon2 password hashing (required)', false, `${String(e.message).split('\n')[0]} - run "npm install" in backend/`); }

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

// WP-12 (PLT-013, DEP-013, G-REL-9): the database itself - quick_check, a schema from a newer version, and how old the newest backup is.
// Opened read-only; nothing is written. A workspace without a database yet (first run) is not a failure.
const dbFile = path.join(workspace, 'publisher.db');
if (fs.existsSync(dbFile)) {
  try {
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(dbFile, { readOnly: true });
    try {
      const qc = db.prepare('PRAGMA quick_check').all().map((r) => String(Object.values(r)[0]));
      row('Database quick_check', qc.length === 1 && qc[0] === 'ok', qc.length === 1 && qc[0] === 'ok' ? dbFile : `${qc.slice(0, 3).join('; ')} - restore the latest backup (docs/OPERATIONS.md, "Restore")`);
      const known = new Set(require(path.join(root, 'src', 'storage', 'migrations')).ORDER);
      let applied = []; try { applied = db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name); } catch { /* none yet */ }
      const unknown = applied.filter((n) => !known.has(n));
      row('Database schema not newer than this version', unknown.length === 0, unknown.length ? `written by a newer version (migrations ${unknown.join(', ')}); install that version again` : `${applied.length} of ${known.size} migrations applied`);
    } finally { db.close(); }
  } catch (e) { row('Database quick_check', false, e.message); }
  const backupDir = process.env.AGASTYA_BACKUP_DIR || path.join(workspace, 'backups', 'platform');
  let newest = null;
  try { newest = fs.readdirSync(backupDir).filter((f) => /^agastya-backup-\d{8}-\d{6}Z-[a-z-]+(-\d+)?\.zip$/.test(f)).sort((a, b) => (a.slice(15, 31) < b.slice(15, 31) ? 1 : -1))[0] || null; } catch { /* no folder yet */ }
  const ageDays = newest ? (Date.now() - Date.parse(newest.replace(/^agastya-backup-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})Z.*$/, '$1-$2-$3T$4:$5:$6Z'))) / 86400000 : Infinity;
  row('Platform backup in the last 7 days (optional)', ageDays < 7, newest ? `${newest} (${ageDays.toFixed(1)} days old) in ${backupDir}` : `none in ${backupDir} - Administrator > Maintenance > Back up now`);
}

row('Client build (optional)', fs.existsSync(path.resolve(root, '..', 'frontend', 'dist', 'index.html')), 'run "npm run build" in frontend/ to serve the UI from this process');

let bad = 0;
for (const r of rows) {
  console.log(`${r.ok ? ' ok ' : 'FAIL'}  ${r.name}${r.detail ? '  - ' + r.detail : ''}`);
  if (!r.ok && !/optional/.test(r.name)) bad++;
}
process.exit(bad ? 1 : 0);
