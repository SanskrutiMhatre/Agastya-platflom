#!/usr/bin/env node
'use strict';
// Platform backup and restore from the command line (audit WP-12). Uses the compiled server code (run "npm run build" in backend/ first).
//
//   node scripts/agastya-backup.js backup  --workspace <data folder> [--to <folder>] [--kind cli|pre-update]
//        A platform backup (database image + every file + SHA-256 manifest). Works while the server runs (the SQLite backup API reads a
//        consistent state) and while it is stopped. Default --to: <data folder>\backups\platform.
//   node scripts/agastya-backup.js verify  <archive>
//        Restores the archive into a scratch folder, checks every file and table against its manifest, removes the folder.
//   node scripts/agastya-backup.js restore <archive> <new folder>
//        Restores into a NEW or empty folder (never over existing data). Then stop the server, set AGASTYA_WORKSPACE_DIR to that folder
//        (or swap the folders) and start it.
//   node scripts/agastya-backup.js check   --workspace <data folder>
//        The database's quick_check, its schema against this version (a newer database is reported), the newest backup and its age.
//
// Exit code 0 = done / healthy, 1 = refused or failed (the reason is printed), 2 = wrong arguments.

const path = require('path');
const fs = require('fs');
const os = require('os');

const DIST = path.resolve(__dirname, '..', 'dist');
if (!fs.existsSync(path.join(DIST, 'services', 'platformBackup.js'))) { console.error('Build the backend first: npm run build (in backend/).'); process.exit(2); }
const { DatabaseSync } = require('node:sqlite');
const pb = require(path.join(DIST, 'services', 'platformBackup'));
const schema = require(path.join(DIST, 'storage', 'schema'));
const { forDialect } = require(path.join(DIST, 'storage', 'migrations'));
const { buildInfo } = require(path.join(DIST, 'services', 'version'));
const STEPS = forDialect('sqlite');

const argv = process.argv.slice(2);
const cmd = argv[0];
const opt = (name) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : undefined; };
const positional = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && all[i - 1].startsWith('--')));
const usage = () => { console.error(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 17).map((l) => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(2); };
const fail = (e) => { console.error(`FAILED: ${e.message}`); process.exit(1); };

async function main() {
  if (cmd === 'backup') {
    const ws = opt('workspace'); if (!ws) usage();
    const dbFile = path.join(path.resolve(ws), 'publisher.db');
    if (!fs.existsSync(dbFile)) throw new Error(`${dbFile} does not exist.`);
    const kind = opt('kind') || 'cli';
    if (!['cli', 'pre-update', 'manual'].includes(kind)) usage();
    const db = new DatabaseSync(dbFile);
    db.exec('PRAGMA busy_timeout = 5000;');
    try {
      const made = await pb.createPlatformBackup({ db, workspaceDir: path.resolve(ws), backupDir: path.resolve(opt('to') || path.join(ws, 'backups', 'platform')), kind, nowIso: new Date().toISOString(), version: buildInfo().version, createdBy: os.userInfo().username });
      console.log(`Backup written: ${made.file}`);
      console.log(`  ${made.manifest.totals.files} files, ${Object.keys(made.manifest.database.tables).length} tables, ${(made.bytes / 1048576).toFixed(1)} MB; database integrity ${made.manifest.database.integrity}`);
      if (made.manifest.skipped.length) console.log(`  ${made.manifest.skipped.length} file(s) disappeared while the backup ran and are not in it.`);
    } finally { db.close(); }
  } else if (cmd === 'verify') {
    const archive = positional[0]; if (!archive) usage();
    const rep = await pb.verifyPlatformBackup(path.resolve(archive), os.tmpdir(), STEPS);
    console.log(`OK: ${path.basename(archive)} (made ${rep.createdAt} by version ${rep.version}) restores completely: ${rep.files} files, ${rep.tables} tables, ${rep.rows} rows, database ${rep.database.integrity}.`);
    if (rep.schema.pendingHere.length) console.log(`  This version adds ${rep.schema.pendingHere.length} migration(s) at the first start after a restore: ${rep.schema.pendingHere.join(', ')}.`);
  } else if (cmd === 'restore') {
    const [archive, target] = positional; if (!archive || !target) usage();
    const rep = await pb.restorePlatformBackup(path.resolve(archive), path.resolve(target), STEPS);
    console.log(`Restored into ${rep.target}: ${rep.files} files, ${rep.tables} tables, ${rep.rows} rows; every file and table matches the backup.`);
    console.log('Next: stop the server, set AGASTYA_WORKSPACE_DIR to that folder (or swap the folders), start the server.');
  } else if (cmd === 'check') {
    const ws = opt('workspace'); if (!ws) usage();
    const dbFile = path.join(path.resolve(ws), 'publisher.db');
    if (!fs.existsSync(dbFile)) throw new Error(`${dbFile} does not exist.`);
    const db = new DatabaseSync(dbFile, { readOnly: true });
    let bad = 0;
    try {
      try { schema.quickCheck(db); console.log(' ok   database quick_check'); } catch (e) { bad++; console.log(`FAIL  ${e.message}`); }
      try { const s = schema.inspectSchema(db, STEPS); console.log(` ok   schema: ${s.applied.length} migration(s) applied, ${s.pending.length} pending for this version`); } catch (e) { bad++; console.log(`FAIL  ${e.message}`); }
    } finally { db.close(); }
    const dir = opt('to') || path.join(path.resolve(ws), 'backups', 'platform');
    const latest = pb.listBackups(dir)[0];
    if (!latest) { bad++; console.log(`FAIL  no platform backup in ${dir}`); }
    else {
      const age = (Date.now() - Date.parse(latest.createdAt)) / 86400000;
      if (age >= 7) bad++;
      console.log(`${age < 7 ? ' ok ' : 'FAIL'}  newest backup ${latest.name} (${age.toFixed(1)} days old)`);
    }
    process.exitCode = bad ? 1 : 0;
  } else usage();
}

main().catch(fail);
