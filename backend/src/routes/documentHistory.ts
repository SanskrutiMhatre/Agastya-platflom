// =============================================================================
// History, restore and check-out routes of a document (audit WP-11: ARC-001, PUB-007, ENT-016, DEP-016, RES-001; decision D22).
//
// For a one-file document (the JSS book under /api/projects/:id/jss, the JSG document under /api/projects/:id/jsg):
//   GET    <base>/history                 the saved versions, newest first   (viewer)
//   GET    <base>/history/:rev            one version's exact text { xml, hash, at }   (viewer)
//   POST   <base>/history/:rev/restore    save that version again as the newest { baseHash } - guarded like a save; nothing is removed   (editor)
//   GET    <base>/checkouts               the live check-outs (whole document part '' or a chapter / section id)   (viewer)
//   POST   <base>/checkout                check out (or renew) { part? } - 423 CHECKED_OUT when another author holds it   (editor)
//   DELETE <base>/checkout?part=&break=1  check in; `break=1` removes another author's check-out (project owner, manager or administrator; audited)
// The data-module equivalents are registered by project-content.ts with the same helpers.
// =============================================================================

import type { Express, Request } from 'express';
import { requireProject, audit, auditedTx } from '../context';
import { wrap, param, forbidden, bad } from '../services/http';
import { versionGuard } from '../services/versionGuard';
import { checkIn, checkOut, leasesOf } from '../services/leases';
import type { RevisionSummary } from '../services/projectFiles';

/** The request's signed-in user and project role, as the routes see them (set by requireProject). */
interface ProjectRequest extends Request { auth: { user: { id: string; username: string; role: string } }; project: { id: string; role: string } }
const pr = (req: Request): ProjectRequest => req as ProjectRequest;

export const actorOf = (req: Request): { id: string; username: string; role: string } => {
  const u = pr(req).auth.user; return { id: u.id, username: u.username, role: u.role };
};

/** May this user break someone else's check-out? A project owner or manager, or an administrator. */
export const mayBreak = (req: Request): boolean => ['owner', 'manager'].includes(pr(req).project.role) || pr(req).auth.user.role === 'admin';

const partOf = (v: unknown): string => {
  const p = typeof v === 'string' ? v.trim() : '';
  if (p.length > 200 || /[\u0000-\u001f]/.test(p)) throw bad('That is not a part of this document.', 'BAD_PART');
  return p;
};

export interface OneFileDocumentRoutes {
  base: string;
  what: string;
  auditPrefix: string;
  need: (req: Request) => void;
  rel: (projectId: string) => string;
  history: (projectId: string) => RevisionSummary[];
  revision: (projectId: string, rev: number) => { text: string; hash: string; at: string };
  save: (req: Request, projectId: string, xml: string, baseHash: string | undefined, reason: string) => Promise<{ hash: string; merged?: boolean; xml?: string }>;
}

export function registerOneFileDocumentRoutes(app: Express, o: OneFileDocumentRoutes): void {
  const viewer = requireProject('viewer', { from: 'param', cap: 'project.read' });
  const editor = requireProject('editor', { from: 'param', cap: 'dm.write' });
  const log = (req: Request, action: string, meta?: unknown): void => {
    const r = pr(req);
    audit({ actorId: r.auth.user.id, actorUsername: r.auth.user.username, action: `${o.auditPrefix}.${action}`, projectId: r.project.id, targetType: 'project', targetId: r.project.id, meta });
  };

  app.get(`${o.base}/history`, viewer, wrap((req, res) => { o.need(req); res.json({ revisions: o.history(pr(req).project.id) }); }));
  app.get(`${o.base}/history/:rev`, viewer, wrap((req, res) => {
    o.need(req);
    const r = o.revision(pr(req).project.id, Number(param(req, 'rev')));
    res.json({ xml: r.text, hash: r.hash, at: r.at });
  }));
  app.post(`${o.base}/history/:rev/restore`, editor, versionGuard(o.what), wrap(async (req, res) => {
    o.need(req);
    const rev = Number(param(req, 'rev'));
    const r = o.revision(pr(req).project.id, rev);
    const out = await o.save(req, pr(req).project.id, r.text, res.locals.baseHash, `restore of revision ${rev}`);
    log(req, 'restored', { revision: rev });
    res.json(out);
  }));

  app.get(`${o.base}/checkouts`, viewer, wrap(async (req, res) => {
    o.need(req); res.json({ leases: await leasesOf(pr(req).project.id, o.rel(pr(req).project.id), pr(req).auth.user.id) });
  }));
  app.post(`${o.base}/checkout`, editor, wrap(async (req, res) => {
    o.need(req);
    const part = partOf(req.body?.part);
    const lease = await checkOut(pr(req).project.id, o.rel(pr(req).project.id), part, actorOf(req));
    log(req, 'checked-out', { part, expiresAt: lease.expiresAt });
    res.json({ lease });
  }));
  app.delete(`${o.base}/checkout`, editor, wrap(async (req, res) => {
    o.need(req);
    const part = partOf(req.query.part);
    const breakIt = req.query.break === '1';
    if (breakIt && !mayBreak(req)) throw forbidden('Only a project owner, a manager or an administrator can break another author\'s check-out.', 'BREAK_NOT_ALLOWED');
    const r = pr(req);
    // WP-29: breaking someone else's check-out is critical - released and recorded together, or neither
    const out = await checkIn(r.project.id, o.rel(r.project.id), part, actorOf(req), breakIt, breakIt
      ? (fn) => auditedTx((x: { released: boolean; holder: string | null }) => (x.released ? { actorId: r.auth.user.id, actorUsername: r.auth.user.username, action: `${o.auditPrefix}.checkout-broken`, projectId: r.project.id, targetType: 'project', targetId: r.project.id, meta: { part, holder: x.holder } } : null), fn)
      : undefined);
    if (out.released && !breakIt) log(req, 'checked-in', { part, holder: out.holder });
    res.json(out);
  }));
}
