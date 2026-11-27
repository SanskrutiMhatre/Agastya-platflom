// =============================================================================
// Platform backups (audit WP-12). Administrators only: an archive holds every account's password hash and the whole history.
//
//   GET    /api/admin/backups                   status: the archives, the schedule, the last backup / restore test / retention run
//   POST   /api/admin/backups                   back up now (one at a time; a second request answers 409 BUSY)
//   GET    /api/admin/backups/:name/download    the archive, streamed (to keep a copy elsewhere)
//   POST   /api/admin/backups/:name/verify      a full check: restored into a scratch folder, every file and table compared, removed again
//   POST   /api/admin/backups/:name/copy        { folder } copy to another folder (a second disk, a USB stick), checked by SHA-256
//   POST   /api/admin/backups/:name/restore     { target } restore into a NEW, empty folder; the running data folder is never touched
//   DELETE /api/admin/backups/:name             remove one archive
//
// The project-files export GET /api/backup (routes/team.ts) is a different thing: what a person can open, without the database.
// =============================================================================

import type { Express, Request } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAdmin, defaultContext } from '../context';
import { wrap, HttpError } from '../services/http';
import { BackupError, backupPath, copyBackupTo, restorePlatformBackup } from '../services/platformBackup';
import { backupNow, migrationSteps, restoreTest, status } from '../services/dataProtection';

const STATUS: Record<BackupError['code'], number> = {
  BUSY: 409, NOT_FOUND: 404, TARGET_NOT_EMPTY: 400, BAD_TARGET: 400, NEWER_BACKUP: 409,
  NOT_A_BACKUP: 422, MISSING_ENTRY: 422, UNEXPECTED_ENTRY: 422, HASH_MISMATCH: 422, DATABASE_MISMATCH: 422, DATABASE_DAMAGED: 500,
};
const asHttp = (e: unknown): unknown => (e instanceof BackupError ? new HttpError(STATUS[e.code] ?? 400, e.message, e.code) : e);

type Authed = Request & { auth: { user: { id: string; username: string } } };
const actor = (req: Request) => ({ id: (req as Authed).auth.user.id, username: (req as Authed).auth.user.username });

const inside = (child: string, parent: string): boolean => { const c = path.resolve(child); const p = path.resolve(parent); return c === p || c.startsWith(p + path.sep); };

/** A folder an administrator typed: absolute, and never the running data folder or the backups folder (or inside them). */
function folderArg(raw: unknown, what: string): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s || !path.isAbsolute(s)) throw new HttpError(400, `Give the ${what} as a full path (for example D:\\Agastya-restore).`, 'BAD_TARGET');
  const ctx = defaultContext();
  if (inside(s, ctx.workspaceDir) || inside(ctx.workspaceDir, s)) throw new HttpError(400, `The ${what} must be outside the running data folder (${ctx.workspaceDir}).`, 'BAD_TARGET');
  if (inside(s, ctx.config.backup.dir)) throw new HttpError(400, `The ${what} must be outside the backups folder.`, 'BAD_TARGET');
  return path.resolve(s);
}

export function registerBackupRoutes(app: Express): void {
  app.get('/api/admin/backups', requireAdmin(), wrap((_req, res) => { res.json(status(defaultContext())); }));

  app.post('/api/admin/backups', requireAdmin(), wrap(async (req, res) => {
    try {
      const made = await backupNow(defaultContext(), 'manual', actor(req));
      res.json({ name: made.name, bytes: made.bytes, files: made.manifest.totals.files, tables: Object.keys(made.manifest.database.tables).length, createdAt: made.manifest.createdAt });
    } catch (e) { throw asHttp(e); }
  }));

  app.get('/api/admin/backups/:name/download', requireAdmin(), wrap((req, res) => {
    const ctx = defaultContext();
    let file: string; try { file = backupPath(ctx.config.backup.dir, String(req.params.name)); } catch (e) { throw asHttp(e); }
    ctx.audit({ actorId: actor(req).id, actorUsername: actor(req).username, action: 'backup.downloaded', targetType: 'backup', targetId: path.basename(file) });
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(fs.statSync(file).size));
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(file)}"`);
    res.setHeader('Cache-Control', 'no-store');
    fs.createReadStream(file).on('error', () => res.destroy()).pipe(res);
  }));

  app.post('/api/admin/backups/:name/verify', requireAdmin(), wrap(async (req, res) => {
    const ctx = defaultContext();
    try {
      const name = path.basename(backupPath(ctx.config.backup.dir, String(req.params.name)));
      const rep = await restoreTest(ctx, name, actor(req));
      res.json({ ok: true, report: rep });
    } catch (e) { throw asHttp(e); }
  }));

  app.post('/api/admin/backups/:name/copy', requireAdmin(), wrap(async (req, res) => {
    const ctx = defaultContext();
    try {
      const file = backupPath(ctx.config.backup.dir, String(req.params.name));
      const out = await copyBackupTo(file, folderArg(req.body?.folder, 'folder'));
      ctx.audit({ actorId: actor(req).id, actorUsername: actor(req).username, action: 'backup.copied', targetType: 'backup', targetId: path.basename(file), meta: { to: out.file, sha256: out.sha256 } });
      res.json(out);
    } catch (e) { throw asHttp(e); }
  }));

  app.post('/api/admin/backups/:name/restore', requireAdmin(), wrap(async (req, res) => {
    const ctx = defaultContext();
    try {
      const file = backupPath(ctx.config.backup.dir, String(req.params.name));
      const target = folderArg(req.body?.target, 'restore folder');
      // WP-29 (G-REL-8): a restore is a critical action - it is recorded BEFORE it runs, and refused (503) when it cannot be recorded
      ctx.auditStrict({ actorId: actor(req).id, actorUsername: actor(req).username, action: 'backup.restore_started', targetType: 'backup', targetId: path.basename(file), meta: { target } });
      const rep = await restorePlatformBackup(file, target, migrationSteps());
      ctx.audit({ actorId: actor(req).id, actorUsername: actor(req).username, action: 'backup.restored', targetType: 'backup', targetId: path.basename(file), meta: { target: rep.target, files: rep.files, rows: rep.rows } });
      res.json({
        report: rep,
        next: [
          'Stop the server.',
          `Point the server at the restored folder: set AGASTYA_WORKSPACE_DIR=${rep.target} (or rename the current data folder away and this folder into its place).`,
          'Start the server. It checks the database, takes a safety copy and runs any migration this version adds.',
          'Sign in and open a project to confirm.',
        ],
      });
    } catch (e) { throw asHttp(e); }
  }));

  app.delete('/api/admin/backups/:name', requireAdmin(), wrap((req, res) => {
    const ctx = defaultContext();
    let file: string; try { file = backupPath(ctx.config.backup.dir, String(req.params.name)); } catch (e) { throw asHttp(e); }
    fs.rmSync(file);
    ctx.audit({ actorId: actor(req).id, actorUsername: actor(req).username, action: 'backup.deleted', targetType: 'backup', targetId: path.basename(file) });
    res.json({ ok: true });
  }));
}
