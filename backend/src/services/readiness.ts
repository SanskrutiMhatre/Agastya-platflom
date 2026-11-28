// =============================================================================
// Readiness (audit WP-10, PLT-031): /api/health says the process is up; this says whether it can do work. A monitor or a load balancer in
// front of a Mode B server asks GET /api/ready, which answers 503 when the database does not answer, the data folder cannot be written, or
// free disk space is below the floor (AGASTYA_READY_MIN_FREE_BYTES). The answer names the failing check, never paths or sizes.
// =============================================================================

import fs from 'fs';
import path from 'path';
import type { AppContext } from '../appContext';

export type CheckState = 'ok' | 'failed';
export interface Readiness { ready: boolean; checks: { database: CheckState; workspace: CheckState; disk: CheckState } }

export function readiness(ctx: Pick<AppContext, 'repos' | 'workspaceDir' | 'config'>): Readiness {
  const run = (fn: () => void): CheckState => { try { fn(); return 'ok'; } catch { return 'failed'; } };
  const database = run(() => ctx.repos.ping());
  const workspace = run(() => {
    const probe = path.join(ctx.workspaceDir, `.ready-${process.pid}-${Date.now()}`);
    fs.writeFileSync(probe, 'ok'); fs.unlinkSync(probe);
  });
  const disk = run(() => {
    const s = fs.statfsSync(ctx.workspaceDir);
    if (Number(s.bavail) * Number(s.bsize) < ctx.config.limits.readyMinFreeBytes) throw new Error('low disk');
  });
  return { ready: database === 'ok' && workspace === 'ok' && disk === 'ok', checks: { database, workspace, disk } };
}

/** The administration page's Service tile and Storage card (read-only): seconds since the server started, and the size and free space of
 *  the disk that holds the data folder (null when the system cannot say). Sizes go to administrators only (GET /api/admin/health). */
export interface SystemFigures { uptimeSeconds: number; startedAt: string; disk: { totalBytes: number; freeBytes: number } | null }
export function systemFigures(ctx: Pick<AppContext, 'workspaceDir'>): SystemFigures {
  let disk: SystemFigures['disk'] = null;
  try { const s = fs.statfsSync(ctx.workspaceDir); disk = { totalBytes: Number(s.blocks) * Number(s.bsize), freeBytes: Number(s.bavail) * Number(s.bsize) }; } catch { /* unknown */ }
  const up = process.uptime();
  return { uptimeSeconds: Math.round(up), startedAt: new Date(Date.now() - up * 1000).toISOString(), disk };
}
