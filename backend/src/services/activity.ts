// =============================================================================
// Activity - "who is working on what", derived from the audit log.
//
// Scope is decided here, once:
//   administrator    every project (platform-wide oversight)
//   project manager  the projects they hold the manager or owner role on
//   anyone else      nothing (the routes refuse before they get here)
// Nothing new is recorded for this - the audit log already carries who did what
// on which project; this reads it, never changes it.
// =============================================================================

import { store } from '../context';
import { readProjectJson } from './projects';

type Row = Record<string, any>;
interface Actor { id: string; role: string }

/** Project ids this person may monitor. */
export function monitoredProjects(user: Actor): string[] {
  if (user.role === 'admin') return store.listAllProjects().map((p: Row) => p.id);
  return store.listProjectsForUser(user.id)
    .filter((p: Row) => (p.status || 'active') === 'active' && (p.member_role === 'manager' || p.member_role === 'owner'))
    .map((p: Row) => p.id);
}

const EDIT = new Set(['dm.saved', 'dm.created', 'dm.imported', 'dm.deleted', 'pm.saved', 'pm.imported']);
const BUILD = new Set(['publish.built']);
const CHECK = new Set(['validation.run']);

const marks = (n: number): string => Array.from({ length: n }, () => '?').join(',');

export interface ActivityReport {
  since: string; days: number;
  totals: { projects: number; people: number; edits: number; builds: number; pendingApprovals: number };
  projects: Array<{
    id: string; name: string; folder: string; dataModules: number; edits: number; builds: number; validations: number;
    lastActivityAt: string | null; pendingRelease: boolean;
    members: Array<{ userId: string; username: string; fullName: string; role: string; globalRole: string; edits: number; lastActiveAt: string | null }>;
  }>;
  people: Array<{ userId: string; username: string; fullName: string; globalRole: string; edits: number; builds: number; lastActiveAt: string | null; projects: Array<{ id: string; name: string; role: string }> }>;
  feed: Array<{ id: number; at: string; actor: string | null; action: string; projectId: string | null; projectName: string | null; meta: unknown }>;
}

export function activityFor(projectIds: string[], days = 7): ActivityReport {
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const empty: ActivityReport = { since, days, totals: { projects: 0, people: 0, edits: 0, builds: 0, pendingApprovals: 0 }, projects: [], people: [], feed: [] };
  if (!projectIds.length) return empty;

  const q = marks(projectIds.length);
  const stats: Row[] = store.db.prepare(
    `SELECT project_id, actor_id, action, COUNT(*) AS n, MAX(at) AS last FROM audit_log
     WHERE project_id IN (${q}) AND at >= ? GROUP BY project_id, actor_id, action`).all(...projectIds, since);
  const lastEver: Row[] = store.db.prepare(
    `SELECT project_id, actor_id, MAX(at) AS last FROM audit_log WHERE project_id IN (${q}) AND actor_id IS NOT NULL GROUP BY project_id, actor_id`).all(...projectIds);
  const feedRows: Row[] = store.db.prepare(
    `SELECT id, at, actor_username, action, project_id, meta FROM audit_log WHERE project_id IN (${q}) ORDER BY id DESC LIMIT 60`).all(...projectIds);
  const pending = new Set<string>(store.listPendingReleases().map((r: Row) => r.project_id));

  const names = new Map<string, { name: string; folder: string }>();
  for (const id of projectIds) { const pj = readProjectJson(id); names.set(id, { name: pj.name || id, folder: String(pj.group || '') }); }

  const lastBy = new Map<string, string>();               // project|actor -> last time ever
  for (const r of lastEver) lastBy.set(`${r.project_id}|${r.actor_id}`, r.last);

  const people = new Map<string, ActivityReport['people'][number]>();
  const projects: ActivityReport['projects'] = [];

  for (const id of projectIds) {
    const mine = stats.filter((s) => s.project_id === id);
    const sum = (set: Set<string>) => mine.filter((s) => set.has(s.action)).reduce((n, s) => n + Number(s.n), 0);
    const edits = sum(EDIT);
    const members = store.listMembers(id).map((m: Row) => {
      const mEdits = mine.filter((s) => s.actor_id === m.user_id && EDIT.has(s.action)).reduce((n, s) => n + Number(s.n), 0);
      const lastActiveAt = lastBy.get(`${id}|${m.user_id}`) ?? null;
      const entry: ActivityReport['people'][number] = people.get(m.user_id) ?? { userId: m.user_id, username: m.username, fullName: m.full_name, globalRole: m.global_role, edits: 0, builds: 0, lastActiveAt: null, projects: [] };
      entry.edits += mEdits;
      entry.builds += mine.filter((s) => s.actor_id === m.user_id && BUILD.has(s.action)).reduce((n, s) => n + Number(s.n), 0);
      if (lastActiveAt && (!entry.lastActiveAt || lastActiveAt > entry.lastActiveAt)) entry.lastActiveAt = lastActiveAt;
      entry.projects.push({ id, name: names.get(id)!.name, role: m.role });
      people.set(m.user_id, entry);
      return { userId: m.user_id, username: m.username, fullName: m.full_name, role: m.role, globalRole: m.global_role, edits: mEdits, lastActiveAt };
    });
    const lastAny = mine.reduce<string | null>((l, s) => (!l || s.last > l ? s.last : l), null);
    let dms = 0;
    try { dms = require('./csdb').listDms(id).length; } catch { /* project directory missing */ }
    projects.push({
      id, ...names.get(id)!, dataModules: dms, edits, builds: sum(BUILD), validations: sum(CHECK),
      lastActivityAt: lastAny, pendingRelease: pending.has(id), members,
    });
  }
  projects.sort((a, b) => String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? '')) || a.name.localeCompare(b.name));
  const peopleList = [...people.values()].sort((a, b) => String(b.lastActiveAt ?? '').localeCompare(String(a.lastActiveAt ?? '')) || a.fullName.localeCompare(b.fullName));

  return {
    since, days,
    totals: {
      projects: projects.length, people: peopleList.length,
      edits: projects.reduce((n, p) => n + p.edits, 0), builds: projects.reduce((n, p) => n + p.builds, 0),
      pendingApprovals: projects.filter((p) => p.pendingRelease).length,
    },
    projects, people: peopleList,
    feed: feedRows.map((r) => ({
      id: r.id, at: r.at, actor: r.actor_username, action: r.action, projectId: r.project_id,
      projectName: r.project_id ? names.get(r.project_id)?.name ?? null : null,
      meta: (() => { try { return r.meta ? JSON.parse(r.meta) : null; } catch { return null; } })(),
    })),
  };
}

/** Release requests waiting for a decision, limited to what this person may decide. */
export function pendingApprovals(user: Actor) {
  const scope = new Set(monitoredProjects(user));
  return store.listPendingReleases()
    .filter((r: Row) => scope.has(r.project_id))
    .map((r: Row) => ({
      id: r.id, projectId: r.project_id, projectName: r.project_name || r.project_id,
      scheduledAt: r.scheduled_at, requestedAt: r.requested_at, note: r.note,
      requestedBy: r.requested_by_name || r.requested_by_username || null,
    }));
}
