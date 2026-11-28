// =============================================================================
// Oversight - the dashboard data for administrators and Project Managers:
// every project in scope with its release status, and the people in scope.
//   administrator    all projects, all accounts
//   project manager  the projects they manage, and the Authors they created
//                    or who work on those projects
// =============================================================================

import { store } from '../context';
import { activityFor, monitoredProjects } from './activity';
import { releaseStateOf } from './release';
import { readProjectJson } from './projects';
import { lastRun } from './validation';

type Row = Record<string, any>;
interface Actor { id: string; role: string }

export type ReleaseStatus = 'released' | 'pending' | 'unreleased';

export function oversightFor(user: Actor) {
  const ids = monitoredProjects(user);
  const report = activityFor(ids, 30);
  const byId = new Map(report.projects.map((p) => [p.id, p]));

  const projects = ids.map((id) => {
    const pj = readProjectJson(id);
    const st = releaseStateOf(id, { reuse: true });            // display only (WP-18): unchanged files keep their digest
    const status: ReleaseStatus = st.released ? 'released' : st.pending ? 'pending' : 'unreleased';
    const a = byId.get(id);
    return {
      id, name: pj.name || id, folder: String(pj.group || ''), status,
      // UI redesign (screen 1): the format under the name and the last validation run in the Validation column, as the mockup's table shows them
      format: String(pj.format || (pj.type === 'JSS' || pj.templateRef === 'uhb' ? 'jss' : 's1000d')), domain: pj.domain ? String(pj.domain) : null, manualType: pj.manualType ? String(pj.manualType) : (pj.templateRef === 'uhb' ? 'uhb' : null),
      validation: (() => { const run = lastRun(id); return run ? { error: run.summary.error, warn: run.summary.warn, ranAt: run.ranAt } : null; })(),
      releaseNumber: st.released ? st.approved?.release_number ?? null : null,
      changedSinceRelease: st.staleRelease,
      dataModules: a?.dataModules ?? 0, lastActivityAt: a?.lastActivityAt ?? null,
      owners: store.listOwners(id).map((o: Row) => o.full_name || o.username),
      members: store.listMembers(id).length,
    };
  }).sort((a, b) => String(b.lastActivityAt ?? '').localeCompare(String(a.lastActivityAt ?? '')) || a.name.localeCompare(b.name));

  const all: Row[] = store.listUsers();
  const onMyProjects = new Set(report.people.map((p) => p.userId));
  const scope = user.role === 'admin'
    ? all.filter((u) => u.role !== 'admin')
    : all.filter((u) => u.role === 'author' && (u.created_by === user.id || onMyProjects.has(u.id)));
  const stats = new Map(report.people.map((p) => [p.userId, p]));
  const team = scope.map((u) => {
    const s = stats.get(u.id);
    return {
      userId: u.id, username: u.username, fullName: u.full_name, role: u.role, disabled: !!u.disabled_at,
      createdAt: u.created_at, createdByYou: u.created_by === user.id,
      edits: s?.edits ?? 0, builds: s?.builds ?? 0, lastActiveAt: s?.lastActiveAt ?? null,
      projects: s?.projects ?? [],
    };
  }).sort((a, b) => String(b.lastActiveAt ?? '').localeCompare(String(a.lastActiveAt ?? '')) || a.fullName.localeCompare(b.fullName));

  return {
    counts: {
      projects: projects.length,
      released: projects.filter((p) => p.status === 'released').length,
      pending: projects.filter((p) => p.status === 'pending').length,
      unreleased: projects.filter((p) => p.status === 'unreleased').length,
      people: team.length,
      managers: team.filter((t) => t.role === 'project_manager').length,
      authors: team.filter((t) => t.role === 'author').length,
      edits: report.totals.edits, days: report.days,
    },
    // the dashboard's Recent activity names people by their full name (the mockup's "Paul Manager approved ..."); the username stays in actor
    projects, team, feed: report.feed.slice(0, 15).map((f) => ({ ...f, actorName: (all.find((u) => u.username === f.actor)?.full_name as string | undefined) || null })),
  };
}
