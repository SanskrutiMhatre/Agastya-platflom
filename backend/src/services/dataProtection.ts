// =============================================================================
// Data protection jobs of one application context (audit WP-12): back up now, the schedule, the weekly restore test, retention.
//
//   backupNow        a platform backup (services/platformBackup.ts) into config.backup.dir, audited
//   restoreTest      restores the newest backup into a scratch folder, checks every file and table against its manifest, removes the folder;
//                    a failure is audited and put in every administrator's notifications (audit 9.7 "automated restore test")
//   runRetention     ended sessions, read notifications and decided reset requests past their retention are removed; audit rows past theirs
//                    are first written to <workspace>/audit-archive/*.jsonl.gz (so they travel in the next backup), then removed
//   tick             what the scheduler does every hour: a scheduled backup when the last one is older than the interval, the GFS pruning
//                    of scheduled backups, the restore test when due, retention once a day
//   status           what the Administrator page shows (last backup and its age, the list, the schedule, the last restore test)
//
// The state of the jobs is one small JSON file beside the backups (backup-state.json), written atomically.
// =============================================================================

import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import crypto from 'crypto';
import type { AppContext } from '../appContext';
import { forDialect } from '../storage/migrations';
import type { MigrationStep } from '../storage/schema';
import { buildInfo } from './version';
import { lastCheckpointAt, verifyAudit, writeCheckpoint } from './auditTrail';
import {
  BackupError, backupRunning, copyBackupTo, createPlatformBackup, listBackups, pruneScheduledBackups, verifyPlatformBackup,
  type BackupKind, type BackupListItem, type CreatedBackup, type RestoreReport,
} from './platformBackup';

const STEPS: MigrationStep[] = forDialect('sqlite');
export const migrationSteps = (): MigrationStep[] => STEPS;

interface JobResult { at: string; ok: boolean; name?: string; message?: string }
export interface DataProtectionState {
  lastBackup?: JobResult;
  lastScheduledAt?: string;
  lastRestoreTest?: JobResult & { files?: number; rows?: number };
  lastRetention?: JobResult & { counts?: Record<string, number> };
  /** WP-29: the daily verification of the audit chain. */
  lastAuditVerify?: JobResult;
  /** WP-28: the last copy to the warm-standby folder */
  lastCopy?: JobResult;
}

const stateFile = (ctx: AppContext): string => path.join(ctx.config.backup.dir, 'backup-state.json');
export function readState(ctx: AppContext): DataProtectionState {
  try { return JSON.parse(fs.readFileSync(stateFile(ctx), 'utf8')) as DataProtectionState; } catch { return {}; }
}
function writeState(ctx: AppContext, patch: Partial<DataProtectionState>): void {
  const next = { ...readState(ctx), ...patch };
  fs.mkdirSync(ctx.config.backup.dir, { recursive: true });
  const tmp = `${stateFile(ctx)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2));
  fs.renameSync(tmp, stateFile(ctx));
}

function tellAdmins(ctx: AppContext, title: string, body: string, now: string): void {
  try {
    for (const u of ctx.store.listUsers() as Array<{ id: string; role: string; disabled_at: string | null }>) {
      if (u.role === 'admin' && !u.disabled_at) ctx.store.insertNotification({ userId: u.id, kind: 'backup.problem', title, body, now });
    }
  } catch (e) { console.error('[backup] notification failed:', (e as Error).message); }
}

const actorOf = (a?: { id: string; username: string } | null): { actorId: string | null; actorUsername: string } =>
  ({ actorId: a?.id ?? null, actorUsername: a?.username ?? 'system' });

/** A platform backup now. Audited; a scheduled one that fails also notifies the administrators. */
export async function backupNow(ctx: AppContext, kind: BackupKind, actor?: { id: string; username: string } | null, now = new Date().toISOString()): Promise<CreatedBackup> {
  try {
    // WP-29 (ENT-003, ENT-006): a signed audit checkpoint with every backup - in the database the backup holds, in the backup folder's
    // checkpoint file and in the Application log - so a later cut at the end of the chain is detectable against it.
    try { writeCheckpoint(ctx, `backup (${kind})`, now); } catch (e) { console.error('[audit] checkpoint before the backup failed:', (e as Error).message); }
    const made = await createPlatformBackup({ db: ctx.db, workspaceDir: ctx.workspaceDir, backupDir: ctx.config.backup.dir, kind, nowIso: now, version: buildInfo().version, createdBy: actor?.username ?? null });
    writeState(ctx, { lastBackup: { at: now, ok: true, name: made.name }, ...(kind === 'scheduled' ? { lastScheduledAt: now } : {}) });
    ctx.audit({ ...actorOf(actor), action: 'backup.created', targetType: 'backup', targetId: made.name,
      meta: { kind, bytes: made.bytes, files: made.manifest.totals.files, tables: Object.keys(made.manifest.database.tables).length } });
    return made;
  } catch (e) {
    const busy = e instanceof BackupError && e.code === 'BUSY';
    if (!busy) {
      writeState(ctx, { lastBackup: { at: now, ok: false, message: (e as Error).message }, ...(kind === 'scheduled' ? { lastScheduledAt: now } : {}) });
      ctx.audit({ ...actorOf(actor), action: 'backup.failed', targetType: 'backup', meta: { kind, error: (e as Error).message } });
      if (kind === 'scheduled') tellAdmins(ctx, 'The scheduled backup failed', (e as Error).message, now);
    }
    throw e;
  }
}

/** Restore the newest backup (or `name`) into a scratch folder, check it completely, remove the folder. Records and audits the result. */
export async function restoreTest(ctx: AppContext, name?: string, actor?: { id: string; username: string } | null, now = new Date().toISOString()): Promise<RestoreReport | null> {
  const dir = ctx.config.backup.dir;
  const target = name ?? listBackups(dir)[0]?.name;
  if (!target) return null;
  try {
    const rep = await verifyPlatformBackup(path.join(dir, target), path.join(dir, '.restore-test'), STEPS);
    writeState(ctx, { lastRestoreTest: { at: now, ok: true, name: target, files: rep.files, rows: rep.rows } });
    ctx.audit({ ...actorOf(actor), action: 'backup.restore_tested', targetType: 'backup', targetId: target, meta: { ok: true, files: rep.files, tables: rep.tables, rows: rep.rows } });
    return rep;
  } catch (e) {
    writeState(ctx, { lastRestoreTest: { at: now, ok: false, name: target, message: (e as Error).message } });
    ctx.audit({ ...actorOf(actor), action: 'backup.restore_tested', targetType: 'backup', targetId: target, meta: { ok: false, error: (e as Error).message } });
    tellAdmins(ctx, 'A backup failed its restore test', `${target}: ${(e as Error).message}`, now);
    throw e;
  }
}

const daysBefore = (now: string, days: number): string => new Date(Date.parse(now) - days * 86400_000).toISOString();

/** Remove housekeeping rows past their retention; audit rows are archived to a compressed file first. Returns the counts. */
export function runRetention(ctx: AppContext, now = new Date().toISOString()): Record<string, number> {
  const r = ctx.config.retention; const R = ctx.repos.retention;
  const counts: Record<string, number> = { sessions: 0, notifications: 0, resetRequests: 0, auditArchived: 0 };
  if (r.sessionsDays > 0) counts.sessions = R.purgeEndedSessions(daysBefore(now, r.sessionsDays));
  if (r.notificationsDays > 0) counts.notifications = R.purgeReadNotifications(daysBefore(now, r.notificationsDays));
  if (r.resetRequestsDays > 0) counts.resetRequests = R.purgeDecidedResetRequests(daysBefore(now, r.resetRequestsDays));
  let archive: { file: string; sha256: string } | null = null;
  if (r.auditDays > 0) {
    const cut = daysBefore(now, r.auditDays);
    const rows: Array<Record<string, unknown> & { id: number }> = [];
    // WP-29: only the oldest rows up to the first one that is still young are taken, so retention removes a PREFIX of the chain and never
    // opens a gap in the middle of it (a row written with an old time after a young one stays until everything before it goes).
    const stop = R.firstAuditIdNotBefore(cut);
    for (let after = 0; ;) {
      const page = R.auditRowsBefore(cut, after, 5000).filter((x) => stop === null || x.id < stop);
      if (!page.length) break;
      rows.push(...page); after = page[page.length - 1].id;
    }
    if (rows.length) {
      const dir = path.join(ctx.workspaceDir, 'audit-archive');
      fs.mkdirSync(dir, { recursive: true });
      const first = rows[0]; const last = rows[rows.length - 1];
      const file = path.join(dir, `audit-${first.id}-${last.id}-${String(now).slice(0, 10)}.jsonl.gz`);
      const body = zlib.gzipSync(Buffer.from(rows.map((x) => JSON.stringify(x)).join('\n') + '\n'));
      const tmp = `${file}.partial`;
      fs.writeFileSync(tmp, body, { flag: 'wx' });
      const fd = fs.openSync(tmp, 'r+'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      // read back before anything is deleted: every row must be in the file
      const back = zlib.gunzipSync(fs.readFileSync(tmp)).toString('utf8').trim().split('\n');
      if (back.length !== rows.length) throw new Error('The audit archive could not be read back; no audit row was removed.');
      fs.renameSync(tmp, file);
      archive = { file: path.relative(ctx.workspaceDir, file), sha256: crypto.createHash('sha256').update(body).digest('hex') };
      // WP-29: the last archived row of the chain becomes its anchor, in the same transaction as the removal
      const chained = rows.filter((x) => x.seq !== null && x.seq !== undefined);
      const lastChained = chained.length ? chained.reduce((a, b) => (Number(b.seq) > Number(a.seq) ? b : a)) : null;
      const arch = archive;
      counts.auditArchived = ctx.repos.transaction(() => {
        if (lastChained) R.setAuditAnchor({ seq: Number(lastChained.seq), row_hash: String(lastChained.row_hash), archived_at: now, archive: arch.file });
        return R.deleteAuditUpTo(cut, last.id);
      });
    }
  }
  writeState(ctx, { lastRetention: { at: now, ok: true, counts } });
  if (Object.values(counts).some((v) => v > 0)) ctx.audit({ actorId: null, actorUsername: 'system', action: 'retention.purged', targetType: 'platform', meta: { ...counts, archive } });
  return counts;
}

const olderThan = (iso: string | undefined, ms: number, now: string): boolean => !iso || Date.parse(now) - Date.parse(iso) >= ms;

/** WP-29: verify the audit chain, record the result, tell the administrators when it is broken. */
export function auditVerifyJob(ctx: AppContext, now = new Date().toISOString()): ReturnType<typeof verifyAudit> {
  const rep = verifyAudit(ctx, { now });
  writeState(ctx, { lastAuditVerify: { at: now, ok: rep.ok, message: rep.summary } });
  if (!rep.ok) tellAdmins(ctx, 'The audit log failed its integrity check', rep.summary, now);
  return rep;
}

/** One run of the schedule. Each job is independent: one failing does not stop the others. */
export async function tick(ctx: AppContext, now = new Date().toISOString()): Promise<string[]> {
  const done: string[] = [];
  const b = ctx.config.backup; const st = readState(ctx);
  if (b.intervalHours > 0 && !backupRunning() && olderThan(st.lastScheduledAt, b.intervalHours * 3600_000 - 60_000, now)) {
    let made: CreatedBackup | null = null;
    try { made = await backupNow(ctx, 'scheduled', null, now); done.push('backup'); } catch (e) { console.error('[backup] scheduled backup failed:', (e as Error).message); }
    try { const removed = pruneScheduledBackups(b.dir, b.keep); if (removed.length) ctx.audit({ actorId: null, actorUsername: 'system', action: 'backup.pruned', targetType: 'backup', meta: { removed } }); } catch (e) { console.error('[backup] pruning failed:', (e as Error).message); }
    if (made && b.copyTo) { if (await copyToStandby(ctx, made, b.copyTo, now)) done.push('copy'); }
  }
  if (b.restoreTestDays > 0 && olderThan(readState(ctx).lastRestoreTest?.at, b.restoreTestDays * 86400_000, now) && listBackups(b.dir).length) {
    try { await restoreTest(ctx, undefined, null, now); done.push('restore-test'); } catch (e) { console.error('[backup] restore test failed:', (e as Error).message); }
  }
  if (olderThan(readState(ctx).lastRetention?.at, 86400_000 - 60_000, now)) {
    try { runRetention(ctx, now); done.push('retention'); } catch (e) { console.error('[retention] failed:', (e as Error).message); }
    // WP-29: the daily housekeeping also verifies the audit chain; a broken chain is raised as Application-log event 4101, recorded in the
    // job state, shown on the Security page and sent to every administrator's notifications.
    try { auditVerifyJob(ctx, now); } catch (e) { console.error('[audit] verification failed to run:', (e as Error).message); }
  }
  // WP-29: a signed checkpoint every config.audit.checkpointHours (default daily) when no backup took one in that time
  const cpHours = ctx.config.audit.checkpointHours;
  if (cpHours > 0 && olderThan(lastCheckpointAt(ctx) ?? undefined, cpHours * 3600_000 - 60_000, now)) {
    try { writeCheckpoint(ctx, 'scheduled', now); done.push('audit-checkpoint'); } catch (e) { console.error('[audit] checkpoint failed:', (e as Error).message); }
  }
  return done;
}

/**
 * WP-28 (PRD-007 warm standby): copy a new scheduled backup to the standby folder (AGASTYA_BACKUP_COPY_DIR), compared by SHA-256, and prune the
 * copies like the originals. A failure is audited and sent to the administrators; the backup itself stays good.
 */
export async function copyToStandby(ctx: AppContext, made: CreatedBackup, folder: string, now = new Date().toISOString()): Promise<boolean> {
  try {
    fs.mkdirSync(folder, { recursive: true });
    const out = await copyBackupTo(made.file, folder);
    writeState(ctx, { lastCopy: { at: now, ok: true, name: made.name } });
    ctx.audit({ actorId: null, actorUsername: 'system', action: 'backup.copied', targetType: 'backup', targetId: made.name, meta: { standby: true, sha256: out.sha256 } });
    try { pruneScheduledBackups(folder, ctx.config.backup.keep); } catch (e) { console.error('[backup] pruning the standby copies failed:', (e as Error).message); }
    return true;
  } catch (e) {
    writeState(ctx, { lastCopy: { at: now, ok: false, name: made.name, message: (e as Error).message } });
    ctx.audit({ actorId: null, actorUsername: 'system', action: 'backup.copy_failed', targetType: 'backup', targetId: made.name, meta: { standby: true, error: (e as Error).message } });
    tellAdmins(ctx, 'The backup could not be copied to the standby folder', (e as Error).message, now);
    return false;
  }
}

let timers: NodeJS.Timeout[] = [];
/** Start the schedule: first run 10 minutes after start (never during start-up), then every hour. Timers do not keep the process alive. */
export function startScheduler(ctx: AppContext, firstDelayMs = 10 * 60_000): void {
  stopScheduler();
  const run = (): void => { void tick(ctx).catch((e) => console.error('[backup] schedule:', (e as Error).message)); };
  const first = setTimeout(() => { run(); const every = setInterval(run, 3600_000); every.unref(); timers.push(every); }, firstDelayMs);
  first.unref(); timers.push(first);
}
export function stopScheduler(): void { for (const t of timers) clearTimeout(t); timers = []; }

export interface DataProtectionStatus {
  dir: string;
  intervalHours: number;
  keep: { daily: number; weekly: number; monthly: number };
  restoreTestDays: number;
  /** WP-28: the warm-standby folder every scheduled backup is copied to (null = none) */
  copyTo: string | null;
  running: boolean;
  backups: BackupListItem[];
  /** The newest backup that exists, and its age in days. */
  latest: (BackupListItem & { ageDays: number }) | null;
  /** true when there is no backup, or the newest is older than 7 days (the Administrator page warns). */
  stale: boolean;
  state: DataProtectionState;
  schema: { applied: number; known: number; latest: string | null };
}

export function status(ctx: AppContext, now = new Date().toISOString()): DataProtectionStatus {
  const b = ctx.config.backup;
  const backups = listBackups(b.dir);
  const newest = backups[0];
  const latest = newest ? { ...newest, ageDays: Math.floor((Date.parse(now) - Date.parse(newest.createdAt)) / 86400_000) } : null;
  return {
    dir: b.dir, intervalHours: b.intervalHours, keep: b.keep, restoreTestDays: b.restoreTestDays, copyTo: b.copyTo, running: backupRunning(), backups, latest,
    stale: !latest || latest.ageDays >= 7, state: readState(ctx),
    schema: { applied: ctx.repos.appliedMigrations().length, known: STEPS.length, latest: STEPS.length ? STEPS[STEPS.length - 1].name : null },
  };
}
