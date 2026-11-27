// =============================================================================
// Team routes - the people side of the platform.
//
//   administrator   creates Project Manager and Author accounts; oversees everything
//   project manager creates Author accounts; creates projects and assigns Authors to them;
//                   sees only the projects they manage
//   author          works on projects; can give other Authors view/edit access to their own
//                   project and add a Project Manager - never approves anything
// =============================================================================

import type { Express } from 'express';
import { nowIso } from '../config';
import { requireRoles, requireProject, store, audit, clientIp } from '../context';
import { wrap, param, bad, notFound, conflict, forbidden } from '../services/http';
import { activityFor, monitoredProjects, pendingApprovals } from '../services/activity';
import { notify, adminIds, list as listNotifications } from '../services/notifications';
import { notifyAccess } from '../services/access-notify';
import { PassThrough } from 'stream';
import { pipeline } from 'stream/promises';
import { writeBackup, exportsRunning } from '../services/backup';
import { oversightFor } from '../services/oversight';
import { requireAuth } from '../context';

/* eslint-disable @typescript-eslint/no-var-requires */
const policy = require('../core/auth/policy');
const { hashPassword, newId } = require('../core/auth/crypto');
const { checkGrant } = require('../core/auth/grants');
/* eslint-enable */

const publicUser = (u: any) => ({
  id: u.id, username: u.username, fullName: u.full_name, role: u.role, disabled: !!u.disabled_at,
  onboardingPending: !!u.onboarding_pending, createdAt: u.created_at,
  createdBy: u.created_by ? store.getUser(u.created_by)?.full_name ?? null : null,
});

export function registerTeamRoutes(app: Express): void {
  // ── Accounts ────────────────────────────────────────────────────────────
  /*
    Administrators create Project Manager and Author accounts; a Project Manager creates Authors.
    The new person gets a one-time temporary password (shown once) and must choose their own
    username and password at first sign-in.
  */
  app.post('/api/team/users', requireRoles('admin', 'project_manager'), wrap(async (req, res) => {
    const actor = req.auth.user;
    const body = req.body ?? {};
    const role = String(body.role || 'author');
    const allowed = actor.role === 'admin' ? ['project_manager', 'author'] : ['author'];
    if (!allowed.includes(role)) throw forbidden(actor.role === 'admin' ? 'Choose Project Manager or Author.' : 'A Project Manager can create Author accounts.', 'ROLE_NOT_ALLOWED');

    const u = policy.validateUsername(body.username);
    if (!u.ok) throw bad(u.error);
    const n = policy.validateFullName(body.fullName);
    if (!n.ok) throw bad(n.error);
    if (store.findUserByUsername(u.username)) throw conflict('That username is already taken.');

    const tempPassword = policy.tempPasswordFor(u.username);
    const user = store.createUser({
      id: newId(), username: u.username, fullName: n.fullName, role,
      passwordHash: await hashPassword(tempPassword), onboardingPending: 1, usernameLocked: 0, createdBy: actor.id, now: nowIso(),
    });
    audit({ actorId: actor.id, actorUsername: actor.username, action: 'user.created', ip: clientIp(req), targetType: 'user', targetId: user.id, meta: { username: user.username, role } });
    if (actor.role !== 'admin') notify(adminIds(), { kind: 'account.created', title: 'New account', body: `${actor.full_name} created the Author account @${user.username} (${user.full_name}).`, actorId: actor.id });
    res.status(201).json({ user: publicUser(user), tempPassword });
  }));

  /** The username offered while typing a name: first name, else firstname.<last initial>, else numbered. */
  app.get('/api/team/username-suggestion', requireRoles('admin', 'project_manager'), wrap((req, res) => {
    const username = policy.suggestUsername(String(req.query.name || ''), (u: string) => !!store.findUserByUsername(u));
    res.json({ username });
  }));

  /** Administrators: everyone. Project Managers: the Authors they created and the people on their projects. */
  app.get('/api/team/users', requireRoles('admin', 'project_manager'), wrap((req, res) => {
    const actor = req.auth.user;
    const all: any[] = store.listUsers();
    if (actor.role === 'admin') return res.json({ users: all.map(publicUser) });
    const mine = new Set<string>();
    for (const pid of monitoredProjects(actor)) for (const m of store.listMembers(pid)) mine.add(m.user_id);
    res.json({ users: all.filter((x) => x.created_by === actor.id || mine.has(x.id)).filter((x) => x.role !== 'admin').map(publicUser) });
  }));

  // ── Assigning people to a project ───────────────────────────────────────
  /*
    Direct assignment (no invitation to accept): an owner or the project's manager puts an existing
    account on the project. Which roles each may hand out is one rule, in core/auth/grants.js.
  */
  app.post('/api/projects/:id/assign', requireProject('manager', { from: 'param', cap: 'members.manage' }), wrap((req, res) => {
    const actor = req.auth.user;
    const role = String(req.body?.role || 'editor');
    const target = store.findUserByUsername(String(req.body?.username || ''));
    if (!target) throw bad('No account with that username exists. An administrator or Project Manager creates new accounts.', 'NO_SUCH_USER');
    if (target.disabled_at) throw bad('That account is disabled.');
    const existing = store.getMembership(req.project.id, target.id);
    const g = checkGrant({ actor, actorRole: req.project.role, target, role, currentRole: existing?.role });
    if (!g.ok) throw new (require('../services/http').HttpError)(g.status, g.error, 'GRANT_REFUSED');
    if (existing && existing.role === 'owner' && role !== 'owner' && store.countOwners(req.project.id) <= 1) {
      throw conflict("This is the project's last owner. Make someone else an owner first.", 'LAST_OWNER');
    }
    store.upsertMember(req.project.id, target.id, role, actor.id, nowIso());
    audit({ actorId: actor.id, actorUsername: actor.username, action: 'member.assigned', projectId: req.project.id, targetType: 'user', targetId: target.id, meta: { role, from: existing?.role ?? null } });
    notifyAccess(existing ? 'changed' : 'granted', { actor, projectId: req.project.id, userId: target.id, role });
    res.json({ ok: true, member: { userId: target.id, username: target.username, fullName: target.full_name, role } });
  }));

  // ── Oversight ───────────────────────────────────────────────────────────
  app.get('/api/activity', requireRoles('admin', 'project_manager'), wrap((req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    res.json(activityFor(monitoredProjects(req.auth.user), days));
  }));

  app.get('/api/projects/:id/activity', requireProject('manager', { from: 'param', cap: 'activity.read' }), wrap((req, res) => {
    const days = Math.min(90, Math.max(1, Number(req.query.days) || 7));
    res.json(activityFor([req.project.id], days));
  }));

  /** Release requests this person may decide (Project Manager: their projects; administrator: all). */
  app.get('/api/approvals', requireRoles('admin', 'project_manager'), wrap((req, res) => {
    res.json({ approvals: pendingApprovals(req.auth.user) });
  }));

  /** Dashboard data for administrators and Project Managers: projects with release status, and the team. */
  app.get('/api/oversight', requireRoles('admin', 'project_manager'), wrap((req, res) => { res.json(oversightFor(req.auth.user)); }));

  // ── Notifications (each person's own inbox) ─────────────────────────────
  app.get('/api/notifications', requireAuth(), wrap((req, res) => { res.json(listNotifications(req.auth.user.id)); }));
  app.get('/api/notifications/unread-count', requireAuth(), wrap((req, res) => { res.json({ unread: store.countUnreadNotifications(req.auth.user.id) }); }));
  app.post('/api/notifications/read', requireAuth(), wrap((req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : null;   // no ids = mark everything read
    store.markNotificationsRead(req.auth.user.id, ids, nowIso());
    res.json(listNotifications(req.auth.user.id));
  }));

  // ── Project files export: a ZIP of what this person can open (administrators: every project). Not the platform backup (routes/backups.ts) ──
  // WP-12 (PERF-006, PLT-005, DEP-025): streamed from disk with back-pressure, one export at a time per server; a client that goes away
  // stops the export instead of leaving it waiting.
  app.get('/api/backup', requireAuth(), wrap(async (req, res) => {
    const u = req.auth.user;
    if (exportsRunning() > 0) throw conflict('An export is being written for someone else; try again in a moment.', 'BUSY');
    const stamp = nowIso().replace(/[:.]/g, '-').slice(0, 19);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="agastya-${u.role === 'admin' ? 'platform' : u.username}-backup-${stamp}.zip"`);
    res.setHeader('Cache-Control', 'no-store');
    const pass = new PassThrough();
    const sent = pipeline(pass, res).catch(() => undefined);      // a closed connection ends the pipeline and errors `pass`, which stops the writer
    try {
      const result = await writeBackup(u, pass);
      audit({ actorId: u.id, actorUsername: u.username, action: 'backup.exported', ip: clientIp(req), meta: result });
    } catch (e) {
      pass.destroy(e as Error); res.destroy();
      console.error('[export] project files export stopped:', (e as Error).message);
    }
    await sent;
  }));

  void param; void notFound;
}
