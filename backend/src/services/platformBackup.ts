// =============================================================================
// Platform backup and restore (audit WP-12: PLT-001, PLT-005, PERF-006, DEP-008, DEP-025, ENT-006, ARC-005, PLT-029, G-REL-1, G-REL-3).
//
// ONE archive restores the whole platform: users with their password hashes, sessions, releases and approvals, revision history, locks,
// grants, settings (the database) and every file of the data folder (projects, the common information repository, house templates,
// workspace.json, logs). It is a ZIP (ZIP64 when needed) written to DISK with the streaming writer, never built in memory:
//
//   manifest.json            format, product version, the schema it carries (applied migrations, user_version), per table the row count and a
//                            SHA-256 over the rows, and per file its size and SHA-256
//   database/publisher.db    an image taken with the SQLite online-backup API (storage/dbImage.ts), checked before it is added
//   workspace/<path>         every file of the data folder except the live database files, the server lock and the backups themselves
//
// Restore never touches the running data folder. It unpacks into a NEW folder (refused when the folder exists and is not empty), checks every
// file against the manifest (size and SHA-256), checks the database (integrity_check, foreign_key_check, every table's count and digest),
// refuses an archive from a newer build (its migrations are unknown here: a downgrade) and only then moves the folder into place. An operator
// switches to it by pointing AGASTYA_WORKSPACE_DIR at it (or renaming folders) while the server is stopped; the first start runs any migration
// the archive lacks, after the usual pre-migration copy. "Verify" is a restore into a scratch folder that is removed afterwards.
//
// The archive holds password hashes: treat it as a secret (docs/OPERATIONS.md, "Backups").
// =============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { Transform } from 'stream';
import { ZipFileReader, ZipStreamWriter, safeJoin, type ZipEntry } from './zipio';
import { imageDatabase, inspectDatabaseFileAsync, sha256File, type DatabaseFacts, type TableFacts } from '../storage/dbImage';
import type { SqlDatabase } from '../storage/sqlite';
import type { MigrationStep } from '../storage/schema';

export const BACKUP_FORMAT = 'agastya-platform-backup';
export const BACKUP_FORMAT_VERSION = 1;
const DB_ENTRY = 'database/publisher.db';
const FILES_PREFIX = 'workspace/';
export type BackupKind = 'manual' | 'scheduled' | 'pre-update' | 'cli';

export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  formatVersion: number;
  product: string;
  version: string;
  createdAt: string;
  kind: BackupKind;
  createdBy: string | null;
  host: string;
  schema: { applied: string[]; userVersion: number };
  database: { entry: string; bytes: number; sha256: string; integrity: string; foreignKeyErrors: number; tables: Record<string, TableFacts> };
  files: Array<{ path: string; bytes: number; sha256: string }>;
  totals: { files: number; bytes: number };
  /** Files that vanished between listing and reading (a module deleted during the backup); everything else is in the archive. */
  skipped: string[];
}

export class BackupError extends Error {
  constructor(public code: 'BUSY' | 'DATABASE_DAMAGED' | 'NOT_A_BACKUP' | 'NEWER_BACKUP' | 'TARGET_NOT_EMPTY' | 'MISSING_ENTRY' | 'UNEXPECTED_ENTRY'
    | 'HASH_MISMATCH' | 'DATABASE_MISMATCH' | 'NOT_FOUND' | 'BAD_TARGET', message: string) { super(message); this.name = 'BackupError'; }
}

/** Names in the data folder that a backup never copies as files: the live database (it goes in as an image), the server lock, the backups. */
const EXCLUDE_TOP = new Set(['publisher.db', 'publisher.db-wal', 'publisher.db-shm', 'publisher.db-journal', '.agastya-server.lock', 'backups']);

function* walk(root: string, rel = '', exclude: string[] = []): Generator<{ abs: string; rel: string }> {
  let entries: fs.Dirent[] = [];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const e of entries) {
    if (!rel && EXCLUDE_TOP.has(e.name)) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    const abs = path.join(root, r);
    if (exclude.some((x) => abs === x || abs.startsWith(x + path.sep))) continue;
    if (e.isDirectory()) yield* walk(root, r, exclude);
    else if (e.isFile()) yield { abs, rel: r };          // links and devices are not followed
  }
}

const stampOf = (iso: string): string => iso.replace(/\.\d+Z$/, 'Z').replace(/[-:]/g, '').replace('T', '-');
const NAME_RE = /^agastya-backup-(\d{8}-\d{6}Z)-(manual|scheduled|pre-update|cli)(-\d+)?\.zip$/;
export const isBackupName = (name: string): boolean => NAME_RE.test(name);

let running: Promise<unknown> | null = null;
/** true while a backup is being written (one at a time per process: a second request is refused, not queued). */
export const backupRunning = (): boolean => running !== null;

export interface CreateBackupOptions {
  db: SqlDatabase;
  workspaceDir: string;
  backupDir: string;
  kind: BackupKind;
  nowIso: string;
  version: string;
  createdBy?: string | null;
}
export interface CreatedBackup { file: string; name: string; bytes: number; manifest: BackupManifest }

/** Write one platform backup into `backupDir`. Refuses (BUSY) while another one is being written by this process. */
export async function createPlatformBackup(o: CreateBackupOptions): Promise<CreatedBackup> {
  if (running) throw new BackupError('BUSY', 'A backup is already being written; wait for it to finish.');
  const job = writeBackup(o);
  running = job;
  try { return await job; } finally { running = null; }
}

/**
 * WP-30 (QA-008, seen in the chaos suite): a backup cut off by a killed server leaves its `.partial` archive and its `.staging-` folder (the
 * database image) behind - never listed as a backup, but each one as large as a backup. The next backup removes those that nothing has
 * written to for ten minutes (a backup being written by the CLI next to the server keeps touching its own files).
 */
function sweepAbandoned(backupDir: string, idleMs = 10 * 60_000): void {
  let names: string[] = []; try { names = fs.readdirSync(backupDir); } catch { return; }
  const now = Date.now();
  for (const n of names) {
    if (!/\.zip\.partial$/.test(n) && !/^\.staging-/.test(n)) continue;
    const p = path.join(backupDir, n);
    try {
      const st = fs.statSync(p);
      let newest = st.mtimeMs;
      if (st.isDirectory()) for (const f of fs.readdirSync(p)) { try { newest = Math.max(newest, fs.statSync(path.join(p, f)).mtimeMs); } catch { /* gone */ } }
      if (now - newest >= idleMs) fs.rmSync(p, { recursive: true, force: true });
    } catch { /* in use or gone: tried again next time */ }
  }
}

async function writeBackup(o: CreateBackupOptions): Promise<CreatedBackup> {
  const backupDir = path.resolve(o.backupDir);
  fs.mkdirSync(backupDir, { recursive: true });
  sweepAbandoned(backupDir);
  let name = `agastya-backup-${stampOf(o.nowIso)}-${o.kind}.zip`;
  for (let n = 1; fs.existsSync(path.join(backupDir, name)); n++) name = `agastya-backup-${stampOf(o.nowIso)}-${o.kind}-${n}.zip`;
  const file = path.join(backupDir, name);
  const partial = `${file}.partial`;
  const staging = fs.mkdtempSync(path.join(backupDir, '.staging-'));
  try {
    // 1. the database image, checked before anything is written
    const image = path.join(staging, 'publisher.db');
    await imageDatabase(o.db, image);
    const facts = await inspectDatabaseFileAsync(image);
    if (facts.integrity !== 'ok') throw new BackupError('DATABASE_DAMAGED', `The database failed its integrity check (${facts.integrity}); no backup was written. Restore the latest good backup.`);

    // 2. the archive, streamed to disk
    const out = fs.createWriteStream(partial, { flags: 'wx' });
    const zip = new ZipStreamWriter(out);
    const dbAdded = await zip.addFile(DB_ENTRY, image);
    const files: BackupManifest['files'] = []; const skipped: string[] = []; let bytes = 0;
    for (const f of walk(path.resolve(o.workspaceDir), '', [backupDir])) {
      try {
        const a = await zip.addFile(FILES_PREFIX + f.rel, f.abs);
        files.push({ path: f.rel, bytes: a.size, sha256: a.sha256 }); bytes += a.size;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' && !fs.existsSync(f.abs)) { skipped.push(f.rel); continue; }
        throw e;
      }
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT, formatVersion: BACKUP_FORMAT_VERSION, product: 'Agastya Platform', version: o.version, createdAt: o.nowIso,
      kind: o.kind, createdBy: o.createdBy ?? null, host: os.hostname(),
      schema: { applied: facts.applied, userVersion: facts.userVersion },
      database: { entry: DB_ENTRY, bytes: dbAdded.size, sha256: dbAdded.sha256, integrity: facts.integrity, foreignKeyErrors: facts.foreignKeyErrors, tables: facts.tables },
      files, totals: { files: files.length, bytes }, skipped,
    };
    await zip.addBuffer('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2)));
    await zip.finish();
    const fd = fs.openSync(partial, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(partial, file);
    return { file, name, bytes: fs.statSync(file).size, manifest };
  } catch (e) {
    try { fs.rmSync(partial, { force: true }); } catch { /* best effort */ }
    throw e;
  } finally {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}

// ── reading ──────────────────────────────────────────────────────────────────

/** Restore reads archives an administrator chose; the hashes in the manifest are the real check, so the reader's limits are generous. */
const RESTORE_LIMITS = { maxEntries: 5_000_000, maxTotalBytes: Number.MAX_SAFE_INTEGER, maxEntryBytes: Number.MAX_SAFE_INTEGER, maxRatio: 1_000_000 };

async function readManifest(zip: ZipFileReader): Promise<BackupManifest> {
  const entry = zip.entries.find((e) => e.name === 'manifest.json');
  if (!entry) throw new BackupError('NOT_A_BACKUP', 'This file is not an Agastya Platform backup (it has no manifest.json).');
  if (entry.size > 512 * 1024 * 1024) throw new BackupError('NOT_A_BACKUP', 'The manifest of this archive is implausibly large.');
  let m: BackupManifest;
  try { m = JSON.parse((await zip.readBuffer(entry)).toString('utf8')) as BackupManifest; } catch (e) { throw new BackupError('NOT_A_BACKUP', `The manifest cannot be read: ${(e as Error).message}`); }
  if (m?.format !== BACKUP_FORMAT || typeof m.formatVersion !== 'number') throw new BackupError('NOT_A_BACKUP', 'This file is not an Agastya Platform backup (unknown manifest format).');
  if (m.formatVersion > BACKUP_FORMAT_VERSION) throw new BackupError('NEWER_BACKUP', `This backup uses format ${m.formatVersion}; this version reads up to ${BACKUP_FORMAT_VERSION}. Restore it with the version that made it (${m.version}) or newer.`);
  if (!Array.isArray(m.files) || !m.database || typeof m.database.sha256 !== 'string' || !Array.isArray(m.schema?.applied)) throw new BackupError('NOT_A_BACKUP', 'The manifest is incomplete.');
  return m;
}

/** Summary of an archive from its manifest alone (no hashing): for the list of backups. */
export async function readBackupSummary(file: string): Promise<{ manifest: BackupManifest } | { error: string }> {
  let zip: ZipFileReader | null = null;
  try { zip = ZipFileReader.open(file, RESTORE_LIMITS); return { manifest: await readManifest(zip) }; } catch (e) { return { error: (e as Error).message }; } finally { zip?.close(); }
}

/** Refuse an archive whose database carries migrations this build does not know (an older program must not open a newer database). */
function refuseNewer(applied: string[], steps: MigrationStep[], version: string): void {
  const known = new Set(steps.map((s) => s.name));
  const unknown = applied.filter((n) => !known.has(n));
  if (unknown.length) {
    throw new BackupError('NEWER_BACKUP', `This backup was made by a newer version (${version}); its database has migration${unknown.length > 1 ? 's' : ''} ${unknown.join(', ')}, which this version does not know. ` +
      'Restore it with that version or a newer one.');
  }
}

async function extractChecked(zip: ZipFileReader, entry: ZipEntry, dest: string, expect: { bytes: number; sha256: string }, label: string): Promise<void> {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const h = crypto.createHash('sha256'); let n = 0;
  const meter = new Transform({
    transform(c: Buffer, _e, cb) {
      n += c.length; h.update(c);
      if (n > expect.bytes) return cb(new BackupError('HASH_MISMATCH', `${label} is larger in the archive than the manifest says.`));
      cb(null, c);
    },
  });
  try {
    await pipeline(zip.open(entry), meter, fs.createWriteStream(dest, { flags: 'wx' }));
  } catch (e) {
    if (e instanceof BackupError) throw e;
    throw new BackupError('HASH_MISMATCH', `${label} cannot be read from the archive: ${(e as Error).message}`);
  }
  if (n !== expect.bytes || h.digest('hex') !== expect.sha256) throw new BackupError('HASH_MISMATCH', `${label} does not match the manifest (size or SHA-256): the archive is damaged or was changed.`);
}

export interface RestoreReport {
  target: string;
  archive: string;
  createdAt: string;
  version: string;
  files: number;
  bytes: number;
  tables: number;
  rows: number;
  schema: { applied: number; pendingHere: string[] };
  database: Pick<DatabaseFacts, 'integrity' | 'foreignKeyErrors' | 'userVersion'>;
}

const isEmptyDir = (d: string): boolean => { try { return fs.statSync(d).isDirectory() && fs.readdirSync(d).length === 0; } catch { return false; } };

/**
 * Restore `archive` into `target`, a folder that does not exist yet or is empty. Everything is checked before the folder is moved into place;
 * on any failure nothing is left behind and `target` is as it was.
 */
export async function restorePlatformBackup(archive: string, target: string, steps: MigrationStep[]): Promise<RestoreReport> {
  const dest = path.resolve(target);
  if (fs.existsSync(dest) && !isEmptyDir(dest)) {
    throw new BackupError('TARGET_NOT_EMPTY', `${dest} is not empty. A restore only goes into a new or empty folder, so nothing that exists is ever overwritten.`);
  }
  if (!fs.existsSync(path.dirname(dest))) throw new BackupError('BAD_TARGET', `The parent folder of ${dest} does not exist.`);
  let zip: ZipFileReader;
  try { zip = ZipFileReader.open(archive, RESTORE_LIMITS); } catch (e) { throw new BackupError('NOT_A_BACKUP', `${path.basename(archive)} cannot be opened as a ZIP archive: ${(e as Error).message}`); }
  const staging = `${dest}.restoring-${process.pid}-${Date.now()}`;
  try {
    const m = await readManifest(zip);
    refuseNewer(m.schema.applied, steps, m.version);

    // the entries must be exactly the manifest's: nothing missing, nothing added
    const byName = new Map(zip.entries.filter((e) => !e.isDirectory).map((e) => [e.name, e]));
    const expected = new Set(['manifest.json', m.database.entry, ...m.files.map((f) => FILES_PREFIX + f.path)]);
    for (const n of expected) if (!byName.has(n)) throw new BackupError('MISSING_ENTRY', `The archive is missing ${n}, which its manifest lists.`);
    for (const n of byName.keys()) if (!expected.has(n)) throw new BackupError('UNEXPECTED_ENTRY', `The archive holds ${n}, which its manifest does not list.`);

    fs.mkdirSync(staging, { recursive: false });
    let bytes = 0;
    for (const f of m.files) {
      await extractChecked(zip, byName.get(FILES_PREFIX + f.path) as ZipEntry, safeJoin(staging, f.path), f, f.path);
      bytes += f.bytes;
    }
    const dbFile = path.join(staging, 'publisher.db');
    if (fs.existsSync(dbFile)) throw new BackupError('UNEXPECTED_ENTRY', 'The archive carries publisher.db among the files as well as the database image.');
    await extractChecked(zip, byName.get(m.database.entry) as ZipEntry, dbFile, m.database, 'The database image');

    const facts = await inspectDatabaseFileAsync(dbFile);
    if (facts.integrity !== 'ok') throw new BackupError('DATABASE_MISMATCH', `The restored database failed its integrity check (${facts.integrity}).`);
    if (facts.foreignKeyErrors !== m.database.foreignKeyErrors) throw new BackupError('DATABASE_MISMATCH', `The restored database has ${facts.foreignKeyErrors} broken references; the backup recorded ${m.database.foreignKeyErrors}.`);
    refuseNewer(facts.applied, steps, m.version);
    const want = Object.keys(m.database.tables).sort(); const got = Object.keys(facts.tables).sort();
    if (want.join('\n') !== got.join('\n')) throw new BackupError('DATABASE_MISMATCH', 'The restored database does not have the tables the backup recorded.');
    let rows = 0;
    for (const t of want) {
      const a = m.database.tables[t]; const b = facts.tables[t];
      if (a.rows !== b.rows || a.sha256 !== b.sha256) throw new BackupError('DATABASE_MISMATCH', `Table ${t} differs from the backup (${b.rows} rows restored, ${a.rows} recorded).`);
      rows += b.rows;
    }
    zip.close();

    if (fs.existsSync(dest)) fs.rmdirSync(dest);                 // the empty folder the operator named
    fs.renameSync(staging, dest);
    const known = new Set(facts.applied);
    return {
      target: dest, archive: path.resolve(archive), createdAt: m.createdAt, version: m.version, files: m.files.length, bytes, tables: want.length, rows,
      schema: { applied: facts.applied.length, pendingHere: steps.map((s) => s.name).filter((n) => !known.has(n)) },
      database: { integrity: facts.integrity, foreignKeyErrors: facts.foreignKeyErrors, userVersion: facts.userVersion },
    };
  } catch (e) {
    zip.close();
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* best effort */ }
    throw e;
  }
}

/** Verify an archive completely: restore it into a scratch folder under `scratchParent`, then remove the folder. */
export async function verifyPlatformBackup(archive: string, scratchParent: string, steps: MigrationStep[]): Promise<RestoreReport> {
  fs.mkdirSync(scratchParent, { recursive: true });
  const scratch = path.join(scratchParent, `.verify-${process.pid}-${Date.now()}`);
  try { return await restorePlatformBackup(archive, scratch, steps); } finally { try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* best effort */ } }
}

// ── listing and retention ────────────────────────────────────────────────────

export interface BackupListItem { name: string; bytes: number; createdAt: string; kind: BackupKind }

/** The archives in `dir`, newest first (from their names; a file with another name is not a backup of ours and is never touched). */
export function listBackups(dir: string): BackupListItem[] {
  let names: string[] = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  const out: BackupListItem[] = [];
  for (const n of names) {
    const m = NAME_RE.exec(n); if (!m) continue;
    const s = m[1];
    const createdAt = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
    let bytes = 0; try { bytes = fs.statSync(path.join(dir, n)).size; } catch { continue; }
    out.push({ name: n, bytes, createdAt, kind: m[2] as BackupKind });
  }
  return out.sort((a, b) => (a.createdAt === b.createdAt ? (a.name < b.name ? 1 : -1) : a.createdAt < b.createdAt ? 1 : -1));
}

/** The absolute path of a backup in `dir` by its name; only names of our own pattern are accepted (no path parts). */
export function backupPath(dir: string, name: string): string {
  if (!isBackupName(name) || path.basename(name) !== name) throw new BackupError('NOT_FOUND', 'No such backup.');
  const f = path.join(dir, name);
  if (!fs.existsSync(f)) throw new BackupError('NOT_FOUND', 'No such backup.');
  return f;
}

const isoWeek = (d: Date): string => {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
  const y = t.getUTCFullYear(); const w = Math.ceil(((t.getTime() - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
  return `${y}-W${w}`;
};

/**
 * Grandfather-father-son: of `items` (any order), keep the newest of each of the `daily` most recent days, `weekly` most recent ISO weeks and
 * `monthly` most recent months that have a backup. Returns the names to keep.
 */
export function retainedBackups(items: Array<{ name: string; createdAt: string }>, keep: { daily: number; weekly: number; monthly: number }): Set<string> {
  const sorted = [...items].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const kept = new Set<string>();
  const pick = (bucket: (d: Date) => string, n: number): void => {
    const seen = new Set<string>();
    for (const it of sorted) {
      const b = bucket(new Date(it.createdAt));
      if (seen.has(b)) continue;
      if (seen.size >= n) break;
      seen.add(b); kept.add(it.name);
    }
  };
  pick((d) => d.toISOString().slice(0, 10), keep.daily);
  pick(isoWeek, keep.weekly);
  pick((d) => d.toISOString().slice(0, 7), keep.monthly);
  return kept;
}

/** Apply the retention policy to the SCHEDULED backups in `dir` (manual and pre-update archives are kept until an administrator deletes them). */
export function pruneScheduledBackups(dir: string, keep: { daily: number; weekly: number; monthly: number }): string[] {
  const scheduled = listBackups(dir).filter((b) => b.kind === 'scheduled');
  const kept = retainedBackups(scheduled, keep);
  const removed: string[] = [];
  for (const b of scheduled) {
    if (kept.has(b.name)) continue;
    try { fs.rmSync(path.join(dir, b.name)); removed.push(b.name); } catch { /* tried again next time */ }
  }
  return removed;
}

/** Copy an archive to another folder (a second disk, a USB stick) and check the copy byte for byte by SHA-256. */
export async function copyBackupTo(file: string, folder: string): Promise<{ file: string; sha256: string }> {
  const dir = path.resolve(folder);
  let st: fs.Stats;
  try { st = fs.statSync(dir); } catch { throw new BackupError('BAD_TARGET', `${dir} does not exist.`); }
  if (!st.isDirectory()) throw new BackupError('BAD_TARGET', `${dir} is not a folder.`);
  const dest = path.join(dir, path.basename(file));
  if (fs.existsSync(dest)) throw new BackupError('BAD_TARGET', `${dest} already exists; it is not overwritten.`);
  const tmp = `${dest}.partial`;
  try {
    await pipeline(fs.createReadStream(file), fs.createWriteStream(tmp, { flags: 'wx' }));
    const [a, b] = await Promise.all([sha256File(file), sha256File(tmp)]);
    if (a !== b) throw new BackupError('HASH_MISMATCH', `The copy in ${dir} does not match the original; it was removed.`);
    fs.renameSync(tmp, dest);
    return { file: dest, sha256: a };
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw e;
  }
}
