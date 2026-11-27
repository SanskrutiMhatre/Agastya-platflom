// =============================================================================
// Central administration of access (audit WP-27: ENT-005, DEP-015, PLT-016, ENT-023).
//
// Directory sign-on (Mode B with AGASTYA_DIRECTORY_URL; the connection itself is server configuration, see docs/OPERATIONS.md):
//   GET    /api/admin/directory                       status: configured?, servers, base DN, nested groups, sync schedule and last run, mappings
//   POST   /api/admin/directory/test                  { username? } reach a server, bind as the service account, optionally find one person
//   POST   /api/admin/directory/sync                  run the offboarding sync now
//   POST   /api/admin/directory/mappings              { groupDn, globalRole?, groupId? } a directory group -> a global role and/or a local group
//   DELETE /api/admin/directory/mappings/:mappingId
// Groups (local, or fed by a mapped directory group):
//   GET    /api/admin/groups                          every group with its member count (administrators and read-only auditors)
//   POST   /api/admin/groups                          { name, description? }
//   PATCH  /api/admin/groups/:groupId                 { name?, description? }
//   DELETE /api/admin/groups/:groupId                 also removes its members, project grants and rules
//   GET    /api/admin/groups/:groupId/members
//   POST   /api/admin/groups/:groupId/members         { username }
//   DELETE /api/admin/groups/:groupId/members/:userId
// One project's access beyond named members (its managers and owners, and administrators):
//   GET    /api/projects/:id/access                   group grants, capability rules, the groups and the capability catalogue to choose from
//   PUT    /api/projects/:id/access/groups/:groupId   { role } grant every member of a group a project role
//   DELETE /api/projects/:id/access/groups/:groupId
//   POST   /api/projects/:id/access/rules             { subjectType: 'user'|'group', subject (username or group id), capability, effect: 'allow'|'deny' }
//   DELETE /api/projects/:id/access/rules/:ruleId
//
// No escalation: a manager can grant a group at most the manager role, and allow only capabilities their own role holds; owners and
// administrators can grant anything. Every change is audited (the existing audit() row format) and applies to the next request.
// =============================================================================

import type { Express, Request, RequestHandler } from 'express';
import fs from 'fs';
import { audit, auditedTx, defaultContext, requireAdmin, requireGlobal, requireProject, store, repos } from '../context';
import { wrap, param, bad, notFound, forbidden, conflict, HttpError } from '../services/http';
import { capabilityTable } from '../services/permissions';
import { lastDirectorySync, runDirectorySync } from '../services/directorySync';
import { ROLE_RANK, PROJECT_ROLES } from '../core/auth/authz';
import { newId } from '../core/auth/crypto';
import type { ProjectRole } from '../repositories/accessRepository';

type Authed = Request & { auth: { user: { id: string; username: string; role: string } }; project: { id: string; role: string } };
const who = (req: Request): Authed['auth']['user'] => (req as Authed).auth.user;
const nowIso = (): string => new Date().toISOString();
const RANK: Record<string, number> = ROLE_RANK;
const GLOBAL_MAP_ROLES = ['admin', 'project_manager', 'author', 'auditor'];
const GROUP_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,63}$/u;

function groupOr404(id: string): { id: string; name: string } {
  const g = repos.access.getGroup(id);
  if (!g) throw notFound('No such group.');
  return g;
}

export function registerAccessRoutes(app: Express): void {
  const log = (req: Request, action: string, meta: Record<string, unknown>, extra: Record<string, unknown> = {}): void =>
    audit({ actorId: who(req).id, actorUsername: who(req).username, action, meta, ...extra });
  // WP-29 (ENT-003): who may do what is a critical change - the change and its audit row are one transaction; when the row cannot be
  // written the change does not happen (503 AUDIT_UNAVAILABLE). Notifications to live sessions (emitAccessChanged) follow the commit.
  const critical = <T>(req: Request, action: string, meta: Record<string, unknown>, extra: Record<string, unknown>, fn: () => T): T =>
    auditedTx({ actorId: who(req).id, actorUsername: who(req).username, action, meta, ...extra }, fn);

  // ── Directory sign-on ───────────────────────────────────────────────────
  app.get('/api/admin/directory', requireGlobal('access.read'), wrap((_req, res) => {
    const ctx = defaultContext(); const d = ctx.config.directory;
    res.json({
      configured: !!d,
      mode: ctx.config.mode,
      settings: d ? {
        urls: d.urls, baseDn: d.baseDn, groupBaseDn: d.groupBaseDn, bindDn: d.bindDn, loginAttribute: d.loginAttribute, userObjectClass: d.userObjectClass,
        nestedGroups: d.nestedGroups, caFile: d.caFile ?? null, caFileReadable: d.caFile ? fs.existsSync(d.caFile) : null,
        bindPasswordFileReadable: fs.existsSync(d.bindPasswordFile), syncHours: d.syncHours, timeoutMs: d.timeoutMs,
      } : null,
      lastSync: lastDirectorySync(ctx),
      directoryUsers: store.listDirectoryUsers().length,
      mappings: repos.access.listDirectoryMappings(),
    });
  }));

  app.post('/api/admin/directory/test', requireAdmin(), wrap(async (req, res) => {
    const ctx = defaultContext(); const provider = ctx.authProvider as unknown as { kind: string; directory?: { test(u?: string): Promise<unknown> } };
    if (!ctx.config.directory || provider.kind !== 'directory' || !provider.directory) throw conflict('Directory sign-on is not configured on this server (AGASTYA_DIRECTORY_URL).', 'DIRECTORY_NOT_CONFIGURED');
    const username = typeof req.body?.username === 'string' ? req.body.username.trim().slice(0, 64) : '';
    try {
      const out = await provider.directory.test(username || undefined);
      log(req, 'directory.test', { ok: true, username: username || undefined });
      res.json(out);
    } catch (e) {
      log(req, 'directory.test', { ok: false, error: (e as Error).message });
      res.status(502).json({ ok: false, error: (e as Error).message, code: 'DIRECTORY_UNAVAILABLE' });
    }
  }));

  app.post('/api/admin/directory/sync', requireAdmin(), wrap(async (req, res) => {
    try { res.json(await runDirectorySync(defaultContext(), who(req))); } catch (e) {
      const status = (e as { status?: number }).status;
      if (status) throw new HttpError(status, (e as Error).message, 'DIRECTORY_NOT_CONFIGURED');
      throw e;
    }
  }));

  app.post('/api/admin/directory/mappings', requireAdmin(), wrap((req, res) => {
    const groupDn = String(req.body?.groupDn ?? '').trim();
    if (!groupDn || groupDn.length > 512 || !/=/.test(groupDn)) throw bad('groupDn is the distinguished name of a directory group, for example "CN=Agastya Authors,OU=Groups,DC=corp,DC=local".');
    const globalRole = req.body?.globalRole == null || req.body.globalRole === '' ? null : String(req.body.globalRole);
    if (globalRole && !GLOBAL_MAP_ROLES.includes(globalRole)) throw bad(`globalRole is one of ${GLOBAL_MAP_ROLES.join(', ')}.`);
    const groupId = req.body?.groupId == null || req.body.groupId === '' ? null : String(req.body.groupId);
    if (groupId) groupOr404(groupId);
    if (!globalRole && !groupId) throw bad('A mapping gives a global role, a local group, or both.');
    if (repos.access.listDirectoryMappings().some((m) => m.group_dn.toLowerCase() === groupDn.toLowerCase())) throw conflict('That directory group is already mapped.', 'DUPLICATE');
    const m = critical(req, 'directory.mapping.added', { groupDn, globalRole, groupId }, {},
      () => repos.access.addDirectoryMapping({ id: newId(), groupDn, globalRole, groupId, now: nowIso(), by: who(req).id }));
    res.status(201).json({ mapping: m });
  }));

  app.delete('/api/admin/directory/mappings/:mappingId', requireAdmin(), wrap((req, res) => {
    const m = repos.access.listDirectoryMappings().find((x) => x.id === param(req, 'mappingId'));
    if (!m) throw notFound('No such mapping.');
    critical(req, 'directory.mapping.removed', { groupDn: m.group_dn, globalRole: m.global_role, groupId: m.group_id }, {}, () => {
      if (!repos.access.deleteDirectoryMapping(m.id)) throw notFound('No such mapping.');
    });
    res.json({ ok: true });
  }));

  // ── Groups ──────────────────────────────────────────────────────────────
  app.get('/api/admin/groups', requireGlobal('access.read'), wrap((_req, res) => { res.json({ groups: repos.access.listGroups() }); }));

  app.post('/api/admin/groups', requireAdmin(), wrap((req, res) => {
    const name = String(req.body?.name ?? '').trim();
    if (!GROUP_NAME.test(name)) throw bad('A group name is 1-64 letters, digits, spaces, dots, dashes or underscores.');
    if (repos.access.findGroupByName(name)) throw conflict('A group with that name exists.', 'DUPLICATE');
    const g = repos.access.createGroup({ id: newId(), name, description: String(req.body?.description ?? '').slice(0, 500), now: nowIso(), by: who(req).id });
    log(req, 'group.created', { groupId: g.id, name });
    res.status(201).json({ group: g });
  }));

  app.patch('/api/admin/groups/:groupId', requireAdmin(), wrap((req, res) => {
    const g = groupOr404(param(req, 'groupId'));
    const f: { name?: string; description?: string } = {};
    if (req.body?.name !== undefined) {
      const name = String(req.body.name).trim();
      if (!GROUP_NAME.test(name)) throw bad('A group name is 1-64 letters, digits, spaces, dots, dashes or underscores.');
      const other = repos.access.findGroupByName(name);
      if (other && other.id !== g.id) throw conflict('A group with that name exists.', 'DUPLICATE');
      f.name = name;
    }
    if (req.body?.description !== undefined) f.description = String(req.body.description).slice(0, 500);
    if (!Object.keys(f).length) throw bad('Nothing to change.');
    const out = repos.access.updateGroup(g.id, f);
    log(req, 'group.updated', { groupId: g.id, ...f });
    res.json({ group: out });
  }));

  app.delete('/api/admin/groups/:groupId', requireAdmin(), wrap((req, res) => {
    const g = groupOr404(param(req, 'groupId'));
    const members = repos.access.listGroupMembers(g.id).map((m) => m.user_id);
    critical(req, 'group.deleted', { groupId: g.id, name: g.name, members: members.length }, {}, () => repos.access.deleteGroup(g.id));
    for (const u of members) store.emitAccessChanged(u);
    res.json({ ok: true });
  }));

  app.get('/api/admin/groups/:groupId/members', requireGlobal('access.read'), wrap((req, res) => {
    const g = groupOr404(param(req, 'groupId'));
    res.json({ group: g, members: repos.access.listGroupMembers(g.id) });
  }));

  app.post('/api/admin/groups/:groupId/members', requireAdmin(), wrap((req, res) => {
    const g = groupOr404(param(req, 'groupId'));
    const u = store.findUserByUsername(String(req.body?.username ?? '').trim());
    if (!u) throw notFound('No account with that user name.');
    critical(req, 'group.member.added', { groupId: g.id, group: g.name, username: u.username }, { targetType: 'user', targetId: u.id },
      () => repos.access.addGroupMember(g.id, u.id, 'local', nowIso(), who(req).id));
    store.emitAccessChanged(u.id);
    res.status(201).json({ members: repos.access.listGroupMembers(g.id) });
  }));

  app.delete('/api/admin/groups/:groupId/members/:userId', requireAdmin(), wrap((req, res) => {
    const g = groupOr404(param(req, 'groupId'));
    const userId = param(req, 'userId');
    critical(req, 'group.member.removed', { groupId: g.id, group: g.name }, { targetType: 'user', targetId: userId }, () => {
      if (!repos.access.removeGroupMember(g.id, userId)) throw notFound('That account is not in the group.');
    });
    store.emitAccessChanged(userId);
    res.json({ members: repos.access.listGroupMembers(g.id) });
  }));

  // ── One project's group grants and capability rules ─────────────────────
  const manage = (): RequestHandler => requireProject('manager', { from: 'param', cap: 'access.manage' }) as RequestHandler;
  const grantorRank = (req: Request): number => RANK[(req as Authed).project.role] || 0;

  const describe = (projectId: string): Record<string, unknown> => {
    const groups = repos.access.listGroups();
    const name = new Map(groups.map((g) => [g.id, g.name]));
    return {
      groupGrants: repos.access.listProjectGroupGrants(projectId).map((g) => ({ groupId: g.group_id, name: g.name, role: g.role, grantedAt: g.granted_at })),
      rules: repos.access.listRules(projectId).map((r) => ({
        id: r.id, subjectType: r.subject_type, subjectId: r.subject_id, capability: r.capability, effect: r.effect, createdAt: r.created_at,
        subject: r.subject_type === 'group' ? (name.get(r.subject_id) ?? r.subject_id) : (store.getUser(r.subject_id)?.username ?? r.subject_id),
      })),
      groups: groups.map((g) => ({ id: g.id, name: g.name, members: g.members ?? 0 })),
      capabilities: Object.entries(capabilityTable()).filter(([c]) => c !== 'project.access').sort(([a], [b]) => a.localeCompare(b)).map(([capability, minRole]) => ({ capability, minRole })),
    };
  };

  app.get('/api/projects/:id/access', manage(), wrap((req, res) => {
    res.json({ ...describe((req as Authed).project.id), yourRole: (req as Authed).project.role });
  }));

  app.put('/api/projects/:id/access/groups/:groupId', manage(), wrap((req, res) => {
    const pid = (req as Authed).project.id;
    const g = groupOr404(param(req, 'groupId'));
    const role = String(req.body?.role ?? '');
    if (!PROJECT_ROLES.includes(role)) throw bad(`role is one of ${PROJECT_ROLES.join(', ')}.`);
    if ((RANK[role] || 0) > grantorRank(req)) throw forbidden('You cannot grant a role above your own on this project.', 'ROLE_ABOVE_YOURS');
    critical(req, 'project.access.group-granted', { groupId: g.id, group: g.name, role }, { projectId: pid, targetType: 'project', targetId: pid },
      () => repos.access.setProjectGroupGrant(pid, g.id, role as ProjectRole, nowIso(), who(req).id));
    for (const m of repos.access.listGroupMembers(g.id)) store.emitAccessChanged(m.user_id);
    res.json(describe(pid));
  }));

  app.delete('/api/projects/:id/access/groups/:groupId', manage(), wrap((req, res) => {
    const pid = (req as Authed).project.id;
    const g = groupOr404(param(req, 'groupId'));
    const held = repos.access.listProjectGroupGrants(pid).find((x) => x.group_id === g.id);
    if (!held) throw notFound('That group holds no role on this project.');
    if ((RANK[held.role] || 0) > grantorRank(req)) throw forbidden('You cannot remove a grant above your own role.', 'ROLE_ABOVE_YOURS');
    critical(req, 'project.access.group-removed', { groupId: g.id, group: g.name, role: held.role }, { projectId: pid, targetType: 'project', targetId: pid },
      () => repos.access.removeProjectGroupGrant(pid, g.id));
    for (const m of repos.access.listGroupMembers(g.id)) store.emitAccessChanged(m.user_id);
    res.json(describe(pid));
  }));

  app.post('/api/projects/:id/access/rules', manage(), wrap((req, res) => {
    const pid = (req as Authed).project.id;
    const b = req.body ?? {};
    const subjectType = String(b.subjectType ?? '');
    if (subjectType !== 'user' && subjectType !== 'group') throw bad('subjectType is "user" or "group".');
    const effect = String(b.effect ?? '');
    if (effect !== 'allow' && effect !== 'deny') throw bad('effect is "allow" or "deny".');
    const capability = String(b.capability ?? '');
    const minRole = capabilityTable()[capability];
    if (!minRole || capability === 'project.access') throw bad('capability is one of the capabilities the project routes declare (GET /api/projects/:id/access lists them).');
    // No escalation: you can only allow what your own role holds.
    if (effect === 'allow' && (RANK[minRole] || 0) > grantorRank(req)) throw forbidden('You cannot allow a capability your own role does not hold.', 'ROLE_ABOVE_YOURS');
    let subjectId: string; let subjectName: string;
    if (subjectType === 'user') {
      const u = store.findUserByUsername(String(b.subject ?? '').trim());
      if (!u) throw notFound('No account with that user name.');
      subjectId = u.id; subjectName = u.username;
    } else {
      const g = groupOr404(String(b.subject ?? ''));
      subjectId = g.id; subjectName = g.name;
    }
    const rule = critical(req, 'project.access.rule-set', { subjectType, subject: subjectName, capability, effect }, { projectId: pid, targetType: 'project', targetId: pid },
      () => repos.access.putRule({ id: newId(), project_id: pid, subject_type: subjectType, subject_id: subjectId, capability, effect, created_at: nowIso(), created_by: who(req).id }));
    if (subjectType === 'user') store.emitAccessChanged(subjectId); else for (const m of repos.access.listGroupMembers(subjectId)) store.emitAccessChanged(m.user_id);
    res.status(201).json({ rule, ...describe(pid) });
  }));

  app.delete('/api/projects/:id/access/rules/:ruleId', manage(), wrap((req, res) => {
    const pid = (req as Authed).project.id;
    const r = repos.access.listRules(pid).find((x) => x.id === param(req, 'ruleId'));
    if (!r) throw notFound('No such rule on this project.');
    if (r.effect === 'allow' && (RANK[capabilityTable()[r.capability]] || 0) > grantorRank(req)) throw forbidden('You cannot remove an allowance above your own role.', 'ROLE_ABOVE_YOURS');
    critical(req, 'project.access.rule-removed', { subjectType: r.subject_type, subjectId: r.subject_id, capability: r.capability, effect: r.effect }, { projectId: pid, targetType: 'project', targetId: pid },
      () => repos.access.deleteRule(pid, r.id));
    if (r.subject_type === 'user') store.emitAccessChanged(r.subject_id); else for (const m of repos.access.listGroupMembers(r.subject_id)) store.emitAccessChanged(m.user_id);
    res.json(describe(pid));
  }));
}
