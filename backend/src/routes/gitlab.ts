// =============================================================================
// GitLab integration routes (Phase 3, decision P3-5: the offline intranet GitLab; docs/phase3/gitlab.md).
//
// Administrator (always reachable by administrators, so the integration can be set up):
//   GET    /api/admin/gitlab                         the configuration without secrets ("set / not set"), the redirect URI to copy, status
//   POST   /api/admin/gitlab/test                    run the connection test on a candidate configuration; nothing is saved
//   POST   /api/admin/gitlab                         test, and save only when every required check passed (422 with the report otherwise)
//   DELETE /api/admin/gitlab                         switch the integration off: configuration, secrets and every user's tokens removed
//   GET    /api/admin/gitlab/accounts                who connected which GitLab account
//   DELETE /api/admin/gitlab/accounts/:userId        revoke one person's connection (the OAuth token is revoked at GitLab too)
// Everyone else - 404 FEATURE_OFF until the administrator saved a configuration that passed its test:
//   GET    /api/gitlab/me                            whether GitLab is on, the ways to connect, my connection
//   POST   /api/gitlab/connect/oauth                 { returnTo } -> { authorizeUrl } (authorization code + PKCE)
//   GET    /api/gitlab/oauth/callback                GitLab sends the browser back here; redirects to returnTo?gitlab=connected|error
//   POST   /api/gitlab/connect/token                 { token } connect with a personal access token (when the administrator accepts them)
//   DELETE /api/gitlab/me                            disconnect
// One project (`requireProject` first: a non-member gets the uniform 404; then the feature check):
//   GET    /api/projects/:id/gitlab                  link, local changes, where the branch is              viewer   gitlab.read
//   GET    .../gitlab/remote-projects?search=        my GitLab projects to link                            manager  gitlab.link
//   GET    .../gitlab/namespaces?search=             my groups/namespaces to create a repository in        manager  gitlab.link
//   POST   .../gitlab/link                           { mode: 'create'|'existing', ... }                    manager  gitlab.link
//   DELETE .../gitlab/link                           unlink (GitLab is not touched)                        manager  gitlab.link
//   POST   .../gitlab/options                        { countApprovals, releaseOnApproval }                 manager  gitlab.link
//   POST   .../gitlab/push                           { message }                                           editor   gitlab.push
//   GET    .../gitlab/incoming                       the pull summary (nothing changes)                    editor   gitlab.pull
//   POST   .../gitlab/pull                           { expectHead, resolutions: { path: 'mine'|'theirs' } } editor gitlab.pull
//   GET    .../gitlab/branches                                                                             viewer   gitlab.read
//   POST   .../gitlab/branches                       { name, from? } create a branch in GitLab             editor   gitlab.push
//   POST   .../gitlab/branch                         { name } switch the project to another branch         manager  gitlab.branch
//   GET    .../gitlab/commits?ref=                   history                                               viewer   gitlab.read
//   GET    .../gitlab/releases                       releases uploaded from here                           viewer   gitlab.read
//   POST   .../gitlab/releases                       { kind: 'release'|'build', tag?, includeArchive? }   manager  gitlab.release
//   GET    .../gitlab/reviewers                      project members who can review, with their GitLab connection  editor  gitlab.mr
//   GET    .../gitlab/mrs                            merge requests started here                           viewer   gitlab.read
//   POST   .../gitlab/mrs                            { title, description, reviewers: [userId] }           editor   gitlab.mr
//   POST   .../gitlab/mrs/:iid/sync                  status, approvals, discussions -> review comments     reviewer gitlab.mr.sync
//   POST   .../gitlab/mrs/:iid/approve               approve in GitLab with my account                     reviewer gitlab.mr.approve
//   POST   .../gitlab/mrs/:iid/merge                 merge in GitLab, then pull                            manager  gitlab.mr.merge
// Every GitLab call is made on the server with the acting person's own token (or the service token for an automatic release upload);
// no token ever reaches the browser. Every write is audited (gitlab.*).
// =============================================================================

import type { Express, Request, RequestHandler } from 'express';
import { audit, requireAdmin, requireAuth, requireProject, store, repos } from '../context';
import { wrap, param, bad } from '../services/http';
import * as jobs from '../services/jobs';
import { onReleaseApproved } from '../services/releaseEvents';
import { activeSettings, candidateFrom, describeSettings, loadSettings, saveSettings, testConnection, gitlabEnabled } from '../services/gitlab/settings';
import { accountView, connectWithToken, finishOauth, removeAccount, safeReturnTo, startOauth } from '../services/gitlab/accounts';
import * as repo from '../services/gitlab/repo';
import * as review from '../services/gitlab/review';
import { readProjectJson } from '../services/projectRecord';

type Authed = Request & { auth: { user: { id: string; username: string; role: string; fullName?: string; full_name?: string } }; project: { id: string; role: string } };
const userOf = (req: Request): repo.Who => { const u = (req as Authed).auth.user; return { id: u.id, username: u.username, fullName: u.fullName ?? u.full_name ?? null, role: u.role }; };
const pid = (req: Request): string => (req as Authed).project.id;
const proj = (min: string, cap: string): RequestHandler => requireProject(min, { from: 'param', cap });
/** The request's own address, the default for the Agastya address (the OAuth redirect URI). */
const originOf = (req: Request): string => `${req.protocol}://${req.get('host') ?? 'localhost'}`;

export function registerGitlabRoutes(app: Express): void {
  const log = (req: Request, action: string, meta: Record<string, unknown> = {}, projectId?: string): void => {
    const u = userOf(req);
    audit({ actorId: u.id, actorUsername: u.username, action, meta, ...(projectId ? { projectId, targetType: 'project', targetId: projectId } : {}) });
  };
  /** GitLab is off: nothing of it exists for anyone but the administrator's configuration page. */
  const on = (): void => { activeSettings(); };

  // ── administrator ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  app.get('/api/admin/gitlab', requireAdmin(), wrap((req, res) => { res.json(describeSettings(originOf(req))); }));

  app.post('/api/admin/gitlab/test', requireAdmin(), wrap(async (req, res) => {
    const report = await testConnection(candidateFrom(req.body ?? {}, originOf(req)));
    log(req, 'gitlab.config.tested', { ok: report.ok, failed: report.checks.filter((c) => c.required && c.ok !== true).map((c) => c.id) });
    res.json({ report });
  }));

  app.post('/api/admin/gitlab', requireAdmin(), wrap(async (req, res) => {
    const cand = candidateFrom(req.body ?? {}, originOf(req));
    const report = await testConnection(cand);
    const before = loadSettings();
    saveSettings(cand, report, userOf(req).id);         // 422 GITLAB_TEST_FAILED (nothing saved) unless every required check passed
    log(req, 'gitlab.config.saved', {
      baseUrl: cand.config.baseUrl, oauthAppId: cand.config.oauthAppId, allowPat: cand.config.allowPat, ca: !!cand.config.caPem,
      clientSecretChanged: (before?.secrets.clientSecret ?? null) !== (cand.secrets.clientSecret ?? null), serviceTokenChanged: (before?.secrets.serviceToken ?? null) !== (cand.secrets.serviceToken ?? null), version: report.version,
    });
    res.json({ report, settings: describeSettings(originOf(req)) });
  }));

  app.delete('/api/admin/gitlab', requireAdmin(), wrap(async (req, res) => {
    const accounts = repos.gitlab.listAccounts();
    for (const a of accounts) await removeAccount(a.user_id);       // revoke OAuth tokens at GitLab while the configuration still exists
    repos.gitlab.deleteSettings();
    log(req, 'gitlab.config.removed', { accountsRemoved: accounts.length });
    res.json({ ok: true, accountsRemoved: accounts.length });
  }));

  app.get('/api/admin/gitlab/accounts', requireAdmin(), wrap((_req, res) => {
    res.json({ accounts: repos.gitlab.listAccounts().map((a) => ({ userId: a.user_id, user: store.getUser(a.user_id)?.username ?? null, fullName: store.getUser(a.user_id)?.full_name ?? null, ...accountView(a) })) });
  }));

  app.delete('/api/admin/gitlab/accounts/:userId', requireAdmin(), wrap(async (req, res) => {
    const out = await removeAccount(param(req, 'userId'));
    log(req, 'gitlab.account.revoked', { userId: param(req, 'userId'), ...out });
    res.json(out);
  }));

  // ── the signed-in person's own connection ─────────────────────────────────────────────────────────────────────────────────────
  app.get('/api/gitlab/me', requireAuth(), wrap((req, res) => {
    const s = activeSettings();
    res.json({ enabled: true, baseUrl: s.config.baseUrl, methods: { oauth: !!s.config.oauthAppId, pat: s.config.allowPat }, account: accountView(repos.gitlab.getAccount(userOf(req).id)) });
  }));

  app.post('/api/gitlab/connect/oauth', requireAuth(), wrap((req, res) => {
    on();
    const out = startOauth(userOf(req).id, req.body?.returnTo);
    log(req, 'gitlab.connect.started', { method: 'oauth' });
    res.json(out);
  }));

  // GitLab sends the browser here (a top-level navigation carries the Lax session cookie). Answers with a redirect into the application.
  app.get('/api/gitlab/oauth/callback', requireAuth(), wrap(async (req, res) => {
    on();
    const back = (to: string, q: string): void => { res.redirect(302, `${to}${to.includes('?') ? '&' : '?'}${q}`); };
    if (typeof req.query.error === 'string') { log(req, 'gitlab.connect.failed', { reason: String(req.query.error).slice(0, 100) }); back('/settings', `gitlab=error&reason=${encodeURIComponent(String(req.query.error).slice(0, 100))}`); return; }
    try {
      const out = await finishOauth(userOf(req).id, String(req.query.code ?? ''), String(req.query.state ?? ''));
      log(req, 'gitlab.account.connected', { method: 'oauth', gitlabUser: out.account.gitlab_username, gitlabUserId: out.account.gitlab_user_id });
      back(safeReturnTo(out.returnTo), 'gitlab=connected');
    } catch (e) {
      log(req, 'gitlab.connect.failed', { reason: (e as Error).message.slice(0, 200) });
      back('/settings', `gitlab=error&reason=${encodeURIComponent((e as Error).message.slice(0, 200))}`);
    }
  }));

  app.post('/api/gitlab/connect/token', requireAuth(), wrap(async (req, res) => {
    on();
    const a = await connectWithToken(userOf(req).id, String(req.body?.token ?? ''));
    log(req, 'gitlab.account.connected', { method: 'pat', gitlabUser: a.gitlab_username, gitlabUserId: a.gitlab_user_id });
    res.json({ account: accountView(a) });
  }));

  app.delete('/api/gitlab/me', requireAuth(), wrap(async (req, res) => {
    on();
    const out = await removeAccount(userOf(req).id);
    log(req, 'gitlab.account.disconnected', out);
    res.json(out);
  }));

  // ── one project ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const base = '/api/projects/:id/gitlab';

  app.get(base, proj('viewer', 'gitlab.read'), wrap(async (req, res) => {
    on();
    const st = await repo.status(pid(req), userOf(req));
    res.json({ ...st, account: accountView(repos.gitlab.getAccount(userOf(req).id)), releases: review.listReleases(pid(req)), mrs: review.listMrs(pid(req)), hasPdf: !!review.pdfOf(pid(req)) });
  }));
  app.get(`${base}/remote-projects`, proj('manager', 'gitlab.link'), wrap(async (req, res) => { on(); res.json({ projects: await repo.remoteProjects(userOf(req), String(req.query.search ?? '')) }); }));
  app.get(`${base}/namespaces`, proj('manager', 'gitlab.link'), wrap(async (req, res) => { on(); res.json({ namespaces: await repo.namespaces(userOf(req), String(req.query.search ?? '')) }); }));

  app.post(`${base}/link`, proj('manager', 'gitlab.link'), wrap(async (req, res) => {
    on();
    const l = await repo.linkProject(pid(req), userOf(req), req.body ?? {});
    log(req, 'gitlab.project.linked', { gitlabProjectId: l.gitlab_project_id, path: l.path_with_namespace, branch: l.branch, created: req.body?.mode === 'create' }, pid(req));
    res.status(201).json({ link: repo.linkView(l) });
  }));
  app.delete(`${base}/link`, proj('manager', 'gitlab.link'), wrap((req, res) => {
    on();
    const l = repo.linkOf(pid(req));
    repo.unlinkProject(pid(req));
    log(req, 'gitlab.project.unlinked', { gitlabProjectId: l.gitlab_project_id, path: l.path_with_namespace }, pid(req));
    res.json({ ok: true });
  }));
  app.post(`${base}/options`, proj('manager', 'gitlab.link'), wrap((req, res) => {
    on();
    const l = repo.linkOf(pid(req));
    const o = { ...repo.options(l), ...(typeof req.body?.countApprovals === 'boolean' ? { countApprovals: req.body.countApprovals } : {}), ...(typeof req.body?.releaseOnApproval === 'boolean' ? { releaseOnApproval: req.body.releaseOnApproval } : {}) };
    repos.gitlab.setLinkOptions(pid(req), JSON.stringify(o));
    log(req, 'gitlab.project.options', o, pid(req));
    res.json({ options: o });
  }));

  app.post(`${base}/push`, proj('editor', 'gitlab.push'), wrap(async (req, res) => {
    on();
    const out = await repo.push(pid(req), userOf(req), String(req.body?.message ?? ''));
    log(req, 'gitlab.pushed', { branch: out.branch, commit: out.commit?.id ?? null, files: out.changes.length }, pid(req));
    res.json({ commit: out.commit ? { id: out.commit.id, webUrl: out.commit.web_url ?? null } : null, changes: out.changes, branch: out.branch });
  }));
  app.get(`${base}/incoming`, proj('editor', 'gitlab.pull'), wrap(async (req, res) => { on(); res.json(await repo.pullPreview(pid(req), userOf(req))); }));
  app.post(`${base}/pull`, proj('editor', 'gitlab.pull'), wrap(async (req, res) => {
    on();
    const out = await repo.pullApply(pid(req), userOf(req), req.body ?? {});
    log(req, 'gitlab.pulled', { branch: out.branch, commit: out.head, applied: out.applied.length, kept: out.kept, blocked: out.blocked.map((b) => b.path) }, pid(req));
    res.json(out);
  }));

  app.get(`${base}/branches`, proj('viewer', 'gitlab.read'), wrap(async (req, res) => { on(); res.json(await repo.branches(pid(req), userOf(req))); }));
  app.post(`${base}/branches`, proj('editor', 'gitlab.push'), wrap(async (req, res) => {
    on();
    const out = await repo.createBranch(pid(req), userOf(req), String(req.body?.name ?? ''), req.body?.from ? String(req.body.from) : undefined);
    log(req, 'gitlab.branch.created', out, pid(req));
    res.status(201).json({ branch: out });
  }));
  app.post(`${base}/branch`, proj('manager', 'gitlab.branch'), wrap(async (req, res) => {
    on();
    const out = await repo.switchBranch(pid(req), userOf(req), String(req.body?.name ?? ''));
    log(req, 'gitlab.branch.switched', { branch: out.branch, commit: out.head, applied: out.applied.length }, pid(req));
    res.json(out);
  }));
  app.get(`${base}/commits`, proj('viewer', 'gitlab.read'), wrap(async (req, res) => { on(); res.json(await repo.commits(pid(req), userOf(req), typeof req.query.ref === 'string' && req.query.ref ? req.query.ref : undefined)); }));

  app.get(`${base}/releases`, proj('viewer', 'gitlab.read'), wrap((req, res) => { on(); res.json({ releases: review.listReleases(pid(req)), hasPdf: !!review.pdfOf(pid(req)) }); }));
  app.post(`${base}/releases`, proj('manager', 'gitlab.release'), wrap(async (req, res) => {
    on();
    const out = await review.uploadRelease(pid(req), userOf(req), req.body ?? {});
    log(req, 'gitlab.release.uploaded', { tag: out.release.tag, kind: out.release.kind, assets: (out.release.assets as Array<{ name: string }>).map((a) => a.name) }, pid(req));
    res.status(201).json(out);
  }));

  app.get(`${base}/reviewers`, proj('editor', 'gitlab.mr'), wrap((req, res) => {
    on();
    const members = store.listMembers(pid(req)) as Array<{ user_id: string; username: string; full_name: string; role: string; disabled_at: string | null }>;
    res.json({ reviewers: members.filter((m) => !m.disabled_at && m.role !== 'viewer' && m.user_id !== userOf(req).id).map((m) => {
      const a = repos.gitlab.getAccount(m.user_id);
      return { userId: m.user_id, username: m.username, fullName: m.full_name, role: m.role, gitlab: a ? { username: a.gitlab_username, id: a.gitlab_user_id } : null };
    }) });
  }));
  app.get(`${base}/mrs`, proj('viewer', 'gitlab.read'), wrap((req, res) => { on(); res.json({ mrs: review.listMrs(pid(req)) }); }));
  app.post(`${base}/mrs`, proj('editor', 'gitlab.mr'), wrap(async (req, res) => {
    on();
    const out = await review.openMr(pid(req), userOf(req), req.body ?? {});
    log(req, 'gitlab.mr.opened', { iid: out.mr.iid, branch: out.mr.sourceBranch, target: out.mr.targetBranch, files: out.changes.length, unmappedReviewers: out.unmappedReviewers }, pid(req));
    res.status(201).json(out);
  }));
  const iidOf = (req: Request): number => { const n = Number(param(req, 'iid')); if (!Number.isInteger(n) || n <= 0) throw bad('That is not a merge request number.', 'GITLAB_BAD_IID'); return n; };
  app.post(`${base}/mrs/:iid/sync`, proj('reviewer', 'gitlab.mr.sync'), wrap(async (req, res) => {
    on();
    const out = await review.syncMr(pid(req), userOf(req), iidOf(req));
    log(req, 'gitlab.mr.synced', { iid: iidOf(req), state: out.mr.state, imported: out.imported, approvedRelease: out.approvedRelease, pulled: out.pulled }, pid(req));
    res.json(out);
  }));
  app.post(`${base}/mrs/:iid/approve`, proj('reviewer', 'gitlab.mr.approve'), wrap(async (req, res) => {
    on();
    await review.approveMr(pid(req), userOf(req), iidOf(req));
    log(req, 'gitlab.mr.approved', { iid: iidOf(req) }, pid(req));
    res.json({ ok: true });
  }));
  app.post(`${base}/mrs/:iid/merge`, proj('manager', 'gitlab.mr.merge'), wrap(async (req, res) => {
    on();
    const out = await review.mergeMr(pid(req), userOf(req), iidOf(req));
    log(req, 'gitlab.mr.merged', { iid: iidOf(req), pulled: out.pulled, pullError: out.pullError }, pid(req));
    res.json(out);
  }));

  // An approved Agastya release: upload its PDF when the project asks for it (in the background; audited either way).
  // (one listener per process: createApp may run more than once in a test process)
  if (unlisten) unlisten();
  unlisten = onReleaseApproved((ev) => {
    if (!gitlabEnabled() || !repos.gitlab.getLink(ev.projectId)) return;
    const kind = readProjectJson(ev.projectId).format === 'jsg' ? 'jsg' : 'publish';
    void review.releaseOnApproval(ev.projectId, ev.actor, audit, () => jobs.run({ kind, projectId: ev.projectId, params: {}, actor: ev.actor }));
  });
}
let unlisten: (() => void) | null = null;
