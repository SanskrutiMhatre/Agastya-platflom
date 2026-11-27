// =============================================================================
// Workspace routes - overview, folders, projects.
//
// Every route here is guarded by exactly one factory from core/auth/authz.js,
// and a static test (test/routes-guarded.test.ts) fails the build if one is
// not. Project-scoped routes go through requireProject(), which is where the
// membership check, the role ladder and the "404 not 403 for non-members" rule
// live - nothing here re-derives them.
// =============================================================================

import { FORMATS } from '../services/formats';
import type { Express } from 'express';
import { nowIso } from '../config';
import { requireAuth, requireProject, store, audit, workspace, workspaceDir, clientIp } from '../context';
import { wrap, param, bad } from '../services/http';
import { pageRequest, searchText, windowOf } from '../services/paging';
import * as P from '../services/projects';
import { createSampleProject } from '../services/sample';
import { createJsgSampleProject } from '../services/jsg/sample';
import { PROFILES } from '../services/profiles';
import { csdbDir, listDms } from '../services/csdb';
import { explore } from '../services/pm';
import { lastRun } from '../services/validation';
import { releaseStateOf } from '../services/release';
import { reviewState, openComments } from '../services/review';
import { listMarks, problemKey } from '../services/problems';
import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { PDF_NAME } from '../services/publisher';
import { notify, adminIds } from '../services/notifications';

export function registerWorkspaceRoutes(app: Express): void {
  // ── Overview ────────────────────────────────────────────────────────────
  app.get('/api/overview', requireAuth(), wrap((req, res) => {
    const user = req.auth.user;
    const cards = P.listProjectsFor(user);
    const ids = new Set(cards.map((c) => c.id));
    const folders = P.workspaceFor(user, cards).folders;          // the cards just built, not a second pass over every project (WP-17)
    const recent = [...cards].sort((a, b) => String(b.lastOpened ?? b.updatedAt).localeCompare(String(a.lastOpened ?? a.updatedAt))).slice(0, 6);

    const activity = store.listAudit({ limit: 300 })
      .filter((a: any) => (a.project_id && ids.has(a.project_id)) || a.actor_id === user.id)
      .slice(0, 12)
      .map((a: any) => ({ id: a.id, at: a.at, actor: a.actor_username, action: a.action, projectId: a.project_id, meta: safeJson(a.meta) }));

    const names = new Map(cards.map((c) => [c.id, c.name]));
    res.json({
      counts: {
        projects: cards.length, folders: folders.length,
        dataModules: cards.reduce((n, c) => n + c.dmCount, 0),
        published: cards.filter((c) => c.hasPdf).length,
        invitations: store.listInvitationsForUser(user.id).length,
      },
      recent,
      activity: activity.map((a: any) => ({ ...a, projectName: a.projectId ? names.get(a.projectId) ?? null : null })),
    });
  }));

  // ── Workspace (folders + projects) ──────────────────────────────────────
  app.get('/api/workspace', requireAuth(), wrap((req, res) => { res.json(P.workspaceFor(req.auth.user)); }));

  app.post('/api/folders', requireAuth(), wrap((req, res) => {
    const name = P.createFolder(req.auth.user, req.body?.name);
    res.status(201).json({ name, key: P.folderKey(name) });
  }));

  app.patch('/api/folders/:key', requireAuth(), wrap((req, res) => {
    const name = P.renameFolder(req.auth.user, param(req, 'key'), req.body?.name);
    res.json({ name, key: P.folderKey(name) });
  }));

  app.delete('/api/folders/:key', requireAuth(), wrap((req, res) => {
    res.json(P.deleteFolder(req.auth.user, param(req, 'key'), req.query.withProjects === '1'));
  }));

  app.get('/api/folders/:key/access', requireAuth(), wrap((req, res) => { res.json(P.folderAccess(req.auth.user, param(req, 'key'))); }));
  app.put('/api/folders/:key/access', requireAuth(), wrap((req, res) => {
    P.setFolderAccess(req.auth.user, param(req, 'key'), req.body?.grants);
    res.json({ ok: true });
  }));

  // ── Projects ────────────────────────────────────────────────────────────
  // What a new project can start as (see services/profiles).
  app.get('/api/document-types', requireAuth(), wrap((_req, res) => { res.json({ types: PROFILES.map((p) => ({ id: p.id, label: p.label, chapters: p.chapters.length })) }); }));

  // the formats / domains / manual types the wizard offers (services/formats): the wizard never hard-codes them
  app.get('/api/formats', requireAuth(), wrap((_req, res) => { res.json({ formats: FORMATS }); }));

  // WP-18 (PERF-016): `?limit=&offset=` (and `q`, matched against name, id and folder) return one window and the total; without them, the whole list as before.
  app.get('/api/projects', requireAuth(), wrap((req, res) => {
    const want = pageRequest(req); const q = searchText(req);
    let projects = P.listProjectsFor(req.auth.user);
    if (q) projects = projects.filter((p) => [p.name, p.id, (p as { folder?: unknown }).folder, (p as { group?: unknown }).group].some((v) => typeof v === 'string' && v.toLowerCase().includes(q)));
    if (!want) return void res.json({ projects });
    const w = windowOf(projects, want);
    res.json({ projects: w.items, ...w.page });
  }));

  app.post('/api/projects', requireAuth(), wrap(async (req, res) => {
    const card = await P.createProject(req.auth.user, req.body ?? {});
    if (req.auth.user.role === 'project_manager') notify(adminIds(), { kind: 'project.created', title: 'New project', body: `${req.auth.user.full_name} created “${card.name}”.`, projectId: card.id, actorId: req.auth.user.id });
    res.status(201).json({ project: card });
  }));

  // A ready-made project (three real data modules, a figure, a three-chapter publication) for trying the platform.
  app.post('/api/projects/sample', requireAuth(), wrap(async (req, res) => {
    res.status(201).json({ project: await createSampleProject(req.auth.user, req.body?.folder) });
  }));

  // A ready-made JSG document (kind "uhb": the filled Modular Bridge handbook; "ispl": the filled foot-bridge spare parts list), imported from Word, to try the editor, the ancillary pages and the PDF on a real document.
  app.post('/api/projects/sample-jsg', requireAuth(), wrap(async (req, res) => {
    res.status(201).json({ project: await createJsgSampleProject(req.auth.user, req.body?.folder, req.body?.kind === 'ispl' ? 'ispl' : 'uhb') });
  }));

  app.get('/api/projects/:id', requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    const row = store.getProjectRow(req.project.id);
    res.json({ project: P.projectCard(row, req.project.role, req.auth.user.role === 'admin' ? 'admin' : 'project', req.auth.user) });
  }));

  // Opening a project is what makes it the "recent" one; it is not a write to its content.
  app.post('/api/projects/:id/open', requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    P.touchOpened(req.project.id);
    store.updateUser(req.auth.user.id, { active_project_id: req.project.id }, nowIso());
    res.json({ ok: true });
  }));

  app.patch('/api/projects/:id', requireProject('owner', { from: 'param', cap: 'project.rename' }), wrap(async (req, res) => {
    const card = await P.updateProject(req.auth.user, req.project.id, req.body ?? {});
    res.json({ project: card });
  }));

  app.delete('/api/projects/:id', requireProject('owner', { from: 'param', cap: 'project.delete' }), wrap((req, res) => {
    // Deleting removes every data module on disk; make the caller say the project's name.
    const confirmName = String(req.query.confirm ?? '');
    const pj = P.readProjectJson(req.project.id);
    // WP-06 (PLT-003): a project whose folder is missing has no project.json to read; the name it was registered under is the one shown
    if (confirmName !== (pj.name || store.getProjectRow(req.project.id)?.name || req.project.id)) throw bad('Type the project name to confirm deletion.', 'CONFIRM_REQUIRED');
    P.deleteProject(req.auth.user, req.project.id);
    res.json({ ok: true });
  }));

  app.post('/api/projects/:id/copy', requireProject('viewer', { from: 'param', cap: 'project.clone' }), wrap(async (req, res) => {
    const name = String(req.body?.name ?? '').trim() || `${P.readProjectJson(req.project.id).name || req.project.id} (copy)`;
    const card = await P.createProject(req.auth.user, { name, folder: req.body?.folder, from: req.project.id });
    res.status(201).json({ project: card });
  }));

  // ── Project dashboard summary ───────────────────────────────────────────
  app.get('/api/projects/:id/summary', requireProject('viewer', { from: 'param', cap: 'project.read' }), wrap((req, res) => {
    const id: string = req.project.id;
    const dms = listDms(id);
    let pm: any = null;
    try { const ex = explore(id, dms); pm = { totals: ex.totals, chapters: ex.tree.filter((n) => n.kind === 'chapter').length, title: ex.meta?.pmTitle ?? '' }; } catch { /* no PM yet */ }
    const validation = lastRun(id);
    const rel = (() => { try { return releaseStateOf(id, { reuse: true, known: dms }); } catch { return null; } })();   // display only (WP-18)
    const pdf = path.join(projectDirFor(id), PDF_NAME);
    res.json({
      project: P.projectCard(store.getProjectRow(id), req.project.role, req.auth.user.role === 'admin' ? 'admin' : 'project', req.auth.user),
      role: req.project.role,
      dataModules: { total: dms.length, withIssues: validation ? new Set(validation.issues.filter((i) => i.sev !== 'info').map((i) => i.file)).size : null },
      publication: pm,
      validation: validation ? { ranAt: validation.ranAt, ...validation.summary } : null,
      release: rel ? {
        released: rel.released, stale: rel.staleRelease,
        number: rel.approved ? rel.approved.release_number : null,
        pending: !!rel.pending, scheduledAt: rel.scheduled ? rel.scheduled.scheduled_at : null,
      } : null,
      build: fs.existsSync(pdf) ? { builtAt: fs.statSync(pdf).mtime.toISOString(), size: fs.statSync(pdf).size } : null,
      members: store.listMembers(id).length,
      // WP-22 (UX-007): the Project Home's Review and Check cards; display only, a failure leaves them out
      review: (() => { try { return { ...reviewState(id, rel ?? undefined), open: openComments(id) }; } catch { return null; } })(),   // the state above, not a second full pass (WP-17)
      problems: validation ? (() => { const marks = new Set(listMarks(id).map((m) => m.key)); return { reviewed: validation.issues.filter((i) => marks.has(problemKey(i))).length }; })() : null,
    });
  }));

  void csdbDir; void workspace; void workspaceDir; void audit; void clientIp;
}

function safeJson(s: unknown): unknown { try { return typeof s === 'string' ? JSON.parse(s) : s; } catch { return null; } }
