// The audit trail (audit WP-29: ENT-003, RES-004). Reading - verify, the checkpoint list, the export, the event list - is
// requireGlobal('audit.read'): administrators and WP-27's read-only auditors. Taking a checkpoint writes, so it stays requireAdmin().
// Every use is itself audited (an auditor's export and verification included).
//
//   GET  /api/admin/audit/verify        walk the chain and compare it with the checkpoints; the report names every problem found
//   GET  /api/admin/audit/checkpoints   the newest signed checkpoints (database), and the backup folder's file name
//   POST /api/admin/audit/checkpoint    take a checkpoint now (also raised as Application-log event 4102)
//   GET  /api/admin/audit/export        every row matching the filters, streamed: ?format=csv|jsonl&action=&actor=&project=&from=&to=
//   GET  /api/admin/audit/events        the security events with their stable Windows event ids (docs/OPERATIONS.md section 13)
//
// The viewer itself is GET /api/admin/audit (core/auth/routes.js), which now filters by action, actor, project and time as well.

import type { Express, Request } from 'express';
import { requireAdmin, requireGlobal, defaultContext } from '../context';
import { wrap, bad } from '../services/http';
import { verifyAudit, writeCheckpoint, exportAudit, checkpointFileOf } from '../services/auditTrail';
import { securityEventCatalogue } from '../services/securityEvents';
import type { AuditFilter } from '../repositories/auditRepository';

type Authed = Request & { auth: { user: { id: string; username: string } } };
const actor = (req: Request): { actorId: string; actorUsername: string } => ({ actorId: (req as Authed).auth.user.id, actorUsername: (req as Authed).auth.user.username });

/** The filters of the viewer and the export, from a query string. A time that does not parse is refused (not silently ignored). */
export function auditFilterOf(q: Record<string, unknown>): AuditFilter {
  const text = (k: string, n: number): string | null => (typeof q[k] === 'string' && (q[k] as string).trim() ? (q[k] as string).trim().slice(0, n) : null);
  const time = (k: string): string | null => {
    const v = text(k, 40); if (!v) return null;
    const t = Date.parse(v);
    if (!Number.isFinite(t)) throw bad(`${k} is not a date or time (for example 2026-11-27 or 2026-11-27T10:00:00Z).`, 'BAD_TIME');
    return new Date(t).toISOString();
  };
  return { action: text('action', 60), actor: text('actor', 64), project: text('project', 120), from: time('from'), to: time('to') };
}

export function registerAuditRoutes(app: Express): void {
  // GET: verification only reads (and records that it ran), so a read-only auditor - who may not POST - runs it too
  app.get('/api/admin/audit/verify', requireGlobal('audit.read'), wrap((req, res) => {
    const ctx = defaultContext();
    const report = verifyAudit(ctx);
    ctx.audit({ ...actor(req), action: 'audit.verified', targetType: 'audit', meta: { ok: report.ok, chained: report.chained, problems: report.problemCount } });
    res.json({ report });
  }));

  app.get('/api/admin/audit/checkpoints', requireGlobal('audit.read'), wrap((_req, res) => {
    const ctx = defaultContext();
    res.json({ checkpoints: ctx.repos.audit.checkpoints(50), file: checkpointFileOf(ctx), keyId: ctx.auditKey().id });
  }));

  app.post('/api/admin/audit/checkpoint', requireAdmin(), wrap((req, res) => {
    const ctx = defaultContext();
    const cp = writeCheckpoint(ctx, 'manual');
    ctx.audit({ ...actor(req), action: 'audit.checkpoint', targetType: 'audit', meta: { seq: cp.seq, rowHash: cp.row_hash } });
    res.json({ checkpoint: cp });
  }));

  app.get('/api/admin/audit/export', requireGlobal('audit.read'), wrap(async (req, res) => {
    const ctx = defaultContext();
    const format = String(req.query.format ?? 'csv').toLowerCase();
    if (format !== 'csv' && format !== 'jsonl') throw bad('format must be csv or jsonl.', 'BAD_FORMAT');
    const filter = auditFilterOf(req.query as Record<string, unknown>);
    const stamp = new Date().toISOString().slice(0, 10);
    res.attachment(`agastya-audit-log-${stamp}.${format}`);     // (sets a type from the extension; ours follows)
    res.setHeader('Content-Type', format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson; charset=utf-8');
    // the export is itself recorded (before it runs: the row count is what the filter matched at that moment)
    ctx.audit({ ...actor(req), action: 'audit.exported', targetType: 'audit', meta: { format, filter, rows: ctx.repos.audit.count(filter) } });
    try { await exportAudit(ctx, filter, format, res); } catch (e) { if (!res.headersSent) throw e; res.destroy(); return; }
    res.end();
  }));

  app.get('/api/admin/audit/events', requireGlobal('audit.read'), wrap((_req, res) => {
    res.json({ source: 'Agastya Platform', log: 'Application', events: securityEventCatalogue() });
  }));
}
