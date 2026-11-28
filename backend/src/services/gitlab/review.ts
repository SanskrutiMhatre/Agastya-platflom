// =============================================================================
// Release and PDF storage, and merge requests for review (Phase 3, P3-5).
//
// Releases: the current PDF of the project (and, when asked, the project archive .jsspub.zip as the release package) are uploaded to the
// linked repository's Generic Package Registry (PUT /projects/:id/packages/generic/agastya-<project>/<version>/<file>), then a GitLab Release
// is made with a tag and links to those files; its description carries the metadata (issue, release number, watermark state, build id,
// fingerprint, approvals), and metadata.json goes beside the files. On demand for any build; automatically after an Agastya approval when the
// project asks for it (releaseOnApproval), with the approver's own token or the service token.
//
// Merge requests: "start a review as a merge request" pushes the project's changes to a new review branch and opens an MR into the project's
// branch, with reviewers mapped from Agastya users to their connected GitLab accounts. A sync reads the MR, its approvals, reviewers and
// discussions: new GitLab notes become Agastya review comments (once each), a reviewer who requested changes becomes a "sent back" comment,
// and - when the project counts GitLab approvals - an approval by a GitLab user who is connected to an Agastya account allowed to approve the
// release (not its requester) approves the pending Agastya release through the approve route's own steps. A merged MR moves the project's
// branch; the project is then brought up to date with a pull.
// =============================================================================

import fs from 'fs';
import os from 'os';
import path from 'path';
import { nowIso } from '../../config';
import { authz, projectDirFor, repos, store } from '../../context';
import { bad, conflict, HttpError } from '../http';
import { newId } from '../../core/auth/crypto';
import { readProjectJson } from '../projectRecord';
import { releaseDocumentRel } from '../release';
import { exportProjectArchive, archiveFileName } from '../projectArchive';
import { gitlabRequest, seg, GitlabError, type GitlabAuth } from './http';
import { activeSettings, endpointOf } from './settings';
import { authFor, serviceAuth } from './accounts';
import { ctxFor, linkOf, options, pullApply, pushToReviewBranch, assertBranchName, type Who } from './repo';
import { decideReleaseAs } from '../releaseEvents';
import type { GitlabMrRow } from '../../repositories/gitlabRepository';

const P = (gid: number | string): string => `/api/v4/projects/${seg(gid)}`;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 60) || 'project';

// ── the PDF and its metadata ────────────────────────────────────────────────────────────────────────────────────────────────────

export function pdfOf(projectId: string): string | null {
  const pj = readProjectJson(projectId);
  const name = pj.format === 'jsg' ? 'jsg-output.pdf' : 'jss-output.pdf';
  const abs = path.join(projectDirFor(projectId), name);
  return fs.existsSync(abs) ? abs : null;
}

function issueOf(projectId: string): string | null {
  try {
    const rel = releaseDocumentRel(projectId);
    const head = fs.readFileSync(path.join(projectDirFor(projectId), rel), 'utf8').slice(0, 20000);
    const m = /issueNumber="(\d+)"[^>]*inWork="(\d+)"/.exec(head) ?? /<issueNumber>([^<]+)<\/issueNumber>/.exec(head);
    return m ? (m[2] !== undefined ? `${m[1]}-${m[2]}` : m[1]) : null;
  } catch { return null; }
}

export interface ReleaseMetadata {
  project: string; projectName: string; format: string; kind: 'release' | 'build'; issue: string | null; releaseNumber: number | null;
  released: boolean; watermark: string; fingerprint: string | null; buildId: string | null; approvals: Array<{ by: string | null; at: string | null }>;
  commit: string | null; uploadedBy: string; uploadedAt: string;
}

function metadataOf(projectId: string, kind: 'release' | 'build', user: Who): ReleaseMetadata {
  const pj = readProjectJson(projectId);
  const now = nowIso();
  const approved = store.currentRelease(projectId, now) as null | { release_number: number; decided_by: string | null; decided_at: string | null; content_hash: string };
  // the publisher's own record of the last build: which content (fingerprint) and whether that build was the released one
  let build: null | { fingerprint?: string; released?: boolean } = null;
  const stateFile = pj.format === 'jsg' ? '.jsg-publish-state.json' : '.publish-state.json';     // publisher.ts / jsg/engine.ts BUILD_STATE
  try { build = JSON.parse(fs.readFileSync(path.join(projectDirFor(projectId), stateFile), 'utf8')); } catch { /* not built yet */ }
  const released = !!(approved && build && build.released && build.fingerprint === approved.content_hash);
  const job = repos.jobs.listForProject(projectId, 20).find((j) => j.kind === 'publish' && j.state === 'succeeded') ?? null;
  const by = approved?.decided_by ? store.getUser(approved.decided_by) : null;
  return {
    project: projectId, projectName: String(pj.name ?? projectId), format: String(pj.format ?? 's1000d'), kind, issue: issueOf(projectId),
    releaseNumber: approved?.release_number ?? null, released,
    watermark: released ? 'none (released copy)' : 'NOT RELEASED', fingerprint: build?.fingerprint ?? null, buildId: job?.id ?? null,
    approvals: approved ? [{ by: by?.username ?? approved.decided_by, at: approved.decided_at }] : [],
    commit: repos.gitlab.getLink(projectId)?.base_commit ?? null, uploadedBy: user.username, uploadedAt: now,
  };
}

const describe = (m: ReleaseMetadata): string => [
  `Uploaded by Agastya for **${m.projectName}** (${m.format}).`, '',
  '| | |', '|---|---|',
  `| Kind | ${m.kind === 'release' ? 'approved release' : 'build on demand'} |`,
  `| Issue | ${m.issue ?? '-'} |`, `| Release number | ${m.releaseNumber ?? '-'} |`, `| Watermark | ${m.watermark} |`,
  `| Build | ${m.buildId ?? '-'} |`, `| Content fingerprint | ${m.fingerprint ? `\`${m.fingerprint.slice(0, 16)}\`` : '-'} |`,
  `| Approvals | ${m.approvals.length ? m.approvals.map((a) => `${a.by ?? '?'} (${a.at ?? ''})`).join(', ') : 'none'} |`,
  `| Source commit | ${m.commit ?? '-'} |`, `| Uploaded | ${m.uploadedBy}, ${m.uploadedAt} |`,
].join('\n');

/** Upload the current PDF (and optionally the project archive) as a GitLab release. `auth` overrides the user's token (service uploads). */
export async function uploadRelease(projectId: string, user: Who, body: { kind?: unknown; tag?: unknown; includeArchive?: unknown }, authOverride?: GitlabAuth) {
  const s = activeSettings(); const ep = endpointOf(s.config);
  const link = linkOf(projectId);
  const auth = authOverride ?? await authFor(user.id);
  const pdf = pdfOf(projectId);
  if (!pdf) throw conflict('This project has no PDF yet. Build it first (Publication), then upload.', 'GITLAB_NO_PDF');
  const kind: 'release' | 'build' = body.kind === 'release' ? 'release' : 'build';
  const meta = metadataOf(projectId, kind, user);
  if (kind === 'release' && !meta.releaseNumber) throw conflict('The project has no approved release. Upload the build instead, or approve the release first.', 'GITLAB_NOT_RELEASED');
  if (kind === 'release' && !meta.released) throw conflict('The PDF on the server is not the released copy (it was built before the approval or from other content). Build it again (the download on the Release page does), then upload.', 'GITLAB_PDF_NOT_RELEASED');
  const stamp = meta.uploadedAt.replace(/[-:]/g, '').replace(/\..*$/, '');
  const version = kind === 'release' ? `r${meta.releaseNumber}` : `build-${stamp}`;
  const tag = body.tag ? assertBranchName(String(body.tag)) : `agastya-${version}`;
  const pkg = `agastya-${slug(projectId)}`;
  const base = `${P(link.gitlab_project_id)}/packages/generic/${seg(pkg)}/${seg(version)}`;
  const files: Array<{ name: string; buf: Buffer; type: string }> = [];
  const pdfName = `${slug(String(meta.projectName))}${meta.released ? '' : '-not-released'}.pdf`;
  files.push({ name: pdfName, buf: fs.readFileSync(pdf), type: 'application/pdf' });
  if (body.includeArchive === true) {
    const tmp = path.join(os.tmpdir(), `agastya-gl-${newId()}.zip`);
    try {
      await exportProjectArchive(projectId, fs.createWriteStream(tmp));
      files.push({ name: archiveFileName(projectId), buf: fs.readFileSync(tmp), type: 'application/zip' });
    } finally { fs.rmSync(tmp, { force: true }); }
  }
  files.push({ name: 'metadata.json', buf: Buffer.from(JSON.stringify(meta, null, 2)), type: 'application/json' });
  const assets: Array<{ name: string; url: string; size: number }> = [];
  for (const f of files) {
    await gitlabRequest(ep, { method: 'PUT', path: `${base}/${seg(f.name)}`, auth, body: f.buf, contentType: f.type, timeoutMs: Math.max(ep.timeoutMs, 600_000) }, `uploading ${f.name}`);
    assets.push({ name: f.name, url: `${s.config.baseUrl}${base}/${seg(f.name)}`, size: f.buf.length });
  }
  const rel = await gitlabRequest<{ tag_name: string; name?: string; _links?: { self?: string } }>(ep, { method: 'POST', path: `${P(link.gitlab_project_id)}/releases`, auth, json: {
    name: `${meta.projectName} ${kind === 'release' ? `release ${meta.releaseNumber}` : `build ${stamp}`}`, tag_name: tag, ref: link.base_commit ?? link.branch, description: describe(meta),
    assets: { links: assets.map((a) => ({ name: a.name, url: a.url, link_type: a.name.endsWith('.pdf') ? 'other' : 'package' })) },
  } }, 'creating the release');
  const row = { id: newId(), project_id: projectId, tag, name: rel.data?.name ?? tag, kind, web_url: rel.data?._links?.self ?? (link.web_url ? `${link.web_url}/-/releases/${encodeURIComponent(tag)}` : null), assets: JSON.stringify(assets), metadata: JSON.stringify(meta), created_at: nowIso(), created_by: user.id };
  repos.gitlab.addRelease(row);
  return { release: releaseView(row) };
}

export const releaseView = (r: { id: string; tag: string; name: string | null; kind: string; web_url: string | null; assets: string | null; metadata: string | null; created_at: string; created_by: string | null }) => {
  const parse = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
  return { id: r.id, tag: r.tag, name: r.name, kind: r.kind, webUrl: r.web_url, assets: parse(r.assets, [] as unknown[]), metadata: parse(r.metadata, {} as Record<string, unknown>), at: r.created_at, by: r.created_by ? store.getUser(r.created_by)?.username ?? null : null };
};
export const listReleases = (projectId: string) => repos.gitlab.listReleases(projectId).map(releaseView);

/** After an Agastya approval: upload the released PDF when the project asks for it. Runs in the background; every outcome is audited. */
export async function releaseOnApproval(projectId: string, actor: { id: string; username: string; role: string }, audit: (f: Record<string, unknown>) => void, build: () => Promise<unknown>): Promise<void> {
  const link = repos.gitlab.getLink(projectId);
  if (!link || !options(link).releaseOnApproval) return;
  try {
    let auth: GitlabAuth = null;
    try { auth = await authFor(actor.id); } catch { auth = serviceAuth(); }
    if (!auth) throw new HttpError(409, 'Neither the approver nor the server has a GitLab token (connect your account, or set a service token).', 'GITLAB_NOT_CONNECTED');
    await build();
    const out = await uploadRelease(projectId, actor, { kind: 'release' }, auth);
    audit({ actorId: actor.id, actorUsername: actor.username, action: 'gitlab.release.uploaded', projectId, targetType: 'project', targetId: projectId, meta: { tag: out.release.tag, kind: 'release', automatic: true } });
  } catch (e) {
    audit({ actorId: actor.id, actorUsername: actor.username, action: 'gitlab.release.failed', projectId, targetType: 'project', targetId: projectId, meta: { automatic: true, error: (e as Error).message.slice(0, 300) } });
  }
}

// ── merge requests ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface GlMr { iid: number; title: string; state: string; web_url: string; source_branch: string; target_branch: string; merge_status?: string; detailed_merge_status?: string; author?: { username: string }; reviewers?: Array<{ id: number; username: string; name: string }>; merged_at?: string | null; sha?: string }
interface GlApprovals { approved?: boolean; approvals_required?: number; approvals_left?: number; approved_by?: Array<{ user: { id: number; username: string; name: string } }> }
interface GlNote { id: number; body: string; system?: boolean; author?: { id: number; username: string; name: string }; created_at?: string; resolvable?: boolean; resolved?: boolean; position?: { new_path?: string } }
interface GlDiscussion { id: string; notes: GlNote[] }
interface GlReviewer { user: { id: number; username: string; name: string }; state?: string }

function mrView(r: GitlabMrRow) {
  const parse = <T>(s: string | null, d: T): T => { try { return s ? JSON.parse(s) as T : d; } catch { return d; } };
  return { iid: r.iid, title: r.title, state: r.state, webUrl: r.web_url, sourceBranch: r.source_branch, targetBranch: r.target_branch, releaseId: r.release_id, createdAt: r.created_at, syncedAt: r.synced_at, by: r.created_by ? store.getUser(r.created_by)?.username ?? null : null, approvals: parse(r.approvals, null as unknown) };
}
export const listMrs = (projectId: string) => repos.gitlab.listMrs(projectId).map(mrView);

export async function openMr(projectId: string, user: Who, body: { title?: unknown; description?: unknown; reviewers?: unknown; branch?: unknown }) {
  const c = await ctxFor(projectId, user);
  const title = String(body.title ?? '').trim().slice(0, 250) || `Review: ${readProjectJson(projectId).name ?? projectId}`;
  const stamp = nowIso().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  const branch = assertBranchName(String(body.branch ?? '').trim() || `agastya/review-${stamp}`);
  // reviewers: Agastya user ids -> their connected GitLab accounts
  const ids = Array.isArray(body.reviewers) ? body.reviewers.map(String).slice(0, 20) : [];
  const reviewerIds: number[] = []; const unmapped: string[] = [];
  for (const uid of ids) {
    const u = store.getUser(uid);
    if (!u) continue;
    if (!authz.evaluate(u, projectId, { minRole: 'reviewer' }).ok) { unmapped.push(`${u.username} (not a reviewer of this project)`); continue; }
    const a = repos.gitlab.getAccount(uid);
    if (a?.gitlab_user_id) reviewerIds.push(a.gitlab_user_id); else unmapped.push(`${u.username} (not connected to GitLab)`);
  }
  const pushed = await pushToReviewBranch(projectId, user, branch, `Review: ${title}`);
  const pending = store.pendingRelease(projectId) as null | { id: string };
  const description = [String(body.description ?? '').trim().slice(0, 8000), '',
    `Opened from Agastya by ${user.fullName || user.username}. ${pushed.changes.length} file${pushed.changes.length === 1 ? '' : 's'} changed.`,
    pending ? `Agastya release request: ${pending.id}.` : ''].filter((x, i) => x || i === 1).join('\n');
  const mr = await gitlabRequest<GlMr>(c.ep, { method: 'POST', path: `${P(c.link.gitlab_project_id)}/merge_requests`, auth: c.auth, json: {
    source_branch: branch, target_branch: c.link.branch, title, description, reviewer_ids: reviewerIds, remove_source_branch: true,
  } }, 'opening the merge request');
  const row: GitlabMrRow = { project_id: projectId, iid: mr.data.iid, source_branch: branch, target_branch: c.link.branch, title, web_url: mr.data.web_url, state: mr.data.state,
    release_id: pending?.id ?? null, created_by: user.id, created_at: nowIso(), synced_at: null, approvals: null, imported_notes: '[]' };
  repos.gitlab.putMr(row);
  return { mr: mrView(row), changes: pushed.changes, unmappedReviewers: unmapped, commit: pushed.commit?.id ?? null };
}

function mrOr404(projectId: string, iid: number): GitlabMrRow {
  const r = Number.isInteger(iid) ? repos.gitlab.getMr(projectId, iid) : null;
  if (!r) throw new HttpError(404, 'This project has no such merge request.', 'GITLAB_NOT_FOUND');
  return r;
}

export interface SyncResult { mr: ReturnType<typeof mrView>; imported: number; approvedRelease: null | { releaseId: string; by: string }; approvalNote: string | null; pulled: null | { applied: number; kept: number } ; pullError: string | null; discussions: Array<{ id: string; notes: Array<{ author: string; body: string; at: string | null; resolved: boolean | null; file: string | null }> }> }

/** Read the MR from GitLab and bring what happened there into Agastya (see the header). */
export async function syncMr(projectId: string, user: Who, iid: number): Promise<SyncResult> {
  const row = mrOr404(projectId, iid);
  const c = await ctxFor(projectId, user);
  const base = `${P(c.link.gitlab_project_id)}/merge_requests/${seg(iid)}`;
  const [mr, apr, disc, rev] = await Promise.all([
    gitlabRequest<GlMr>(c.ep, { path: base, auth: c.auth }, 'the merge request'),
    gitlabRequest<GlApprovals>(c.ep, { path: `${base}/approvals`, auth: c.auth }, 'the approvals').catch(() => ({ data: {} as GlApprovals })),
    gitlabRequest<GlDiscussion[]>(c.ep, { path: `${base}/discussions`, auth: c.auth, query: { per_page: 100 } }, 'the discussions'),
    gitlabRequest<GlReviewer[]>(c.ep, { path: `${base}/reviewers`, auth: c.auth }, 'the reviewers').catch(() => ({ data: [] as GlReviewer[] })),
  ]);
  const seen = new Set<string>(((): string[] => { try { return JSON.parse(row.imported_notes ?? '[]'); } catch { return []; } })());
  let imported = 0;
  const syncer = user.id;
  const asAgastya = (glId: number | undefined): string | null => (glId ? repos.gitlab.accountByGitlabUser(glId)?.user_id ?? null : null);
  const releaseId = row.release_id && (store.getRelease(row.release_id) as { status?: string } | null)?.status === 'pending' ? row.release_id : null;
  for (const d of disc.data ?? []) {
    for (const n of d.notes ?? []) {
      if (n.system || seen.has(`n${n.id}`)) continue;
      const who = asAgastya(n.author?.id);
      const prefix = who ? '' : `From GitLab, ${n.author?.name ?? n.author?.username ?? 'someone'} (@${n.author?.username ?? '?'}): `;
      const file = n.position?.new_path ?? null;
      const dmFile = file && /^DMC-[A-Za-z0-9._-]+\.xml$/i.test(path.posix.basename(file)) ? path.posix.basename(file) : null;
      store.addReviewComment({ projectId, releaseId, userId: who ?? syncer, kind: 'comment', body: `${prefix}${String(n.body ?? '').slice(0, 3800)}${file && !dmFile ? ` [${file}]` : ''} (GitLab !${iid})`, dmFile, anchor: null, now: nowIso() });
      seen.add(`n${n.id}`); imported++;
    }
  }
  for (const r of rev.data ?? []) {
    const key = `rc${r.user.id}:${row.synced_at ?? ''}`;
    if (r.state === 'requested_changes' && ![...seen].some((k) => k.startsWith(`rc${r.user.id}:`))) {
      const who = asAgastya(r.user.id);
      store.addReviewComment({ projectId, releaseId, userId: who ?? syncer, kind: 'changes', body: `${who ? '' : `From GitLab, ${r.user.name} (@${r.user.username}): `}requested changes on merge request !${iid}.`, dmFile: null, anchor: null, now: nowIso() });
      seen.add(key); imported++;
    }
    if (r.state !== 'requested_changes') for (const k of [...seen]) if (k.startsWith(`rc${r.user.id}:`)) seen.delete(k);
  }
  const approvedBy = (apr.data?.approved_by ?? []).map((a) => a.user);
  const approvals = { approved: apr.data?.approved ?? (apr.data?.approvals_left === 0), required: apr.data?.approvals_required ?? null, left: apr.data?.approvals_left ?? null, by: approvedBy.map((u) => ({ id: u.id, username: u.username, name: u.name, agastyaUser: asAgastya(u.id) ? store.getUser(asAgastya(u.id)!)?.username ?? null : null })), reviewers: (rev.data ?? []).map((r) => ({ username: r.user.username, name: r.user.name, state: r.state ?? null })) };

  // GitLab approvals that count toward the Agastya approval
  let approvedRelease: SyncResult['approvedRelease'] = null; let approvalNote: string | null = null;
  if (options(c.link).countApprovals && releaseId && approvals.approved) {
    const requester = (store.getRelease(releaseId) as { requested_by?: string } | null)?.requested_by;
    const candidates = approvedBy.map((u) => asAgastya(u.id)).filter((x): x is string => !!x && x !== requester);
    let lastErr: string | null = null;
    for (const uid of candidates) {
      const u = store.getUser(uid);
      if (!u || u.disabled_at) continue;
      const ev = authz.evaluate(u, projectId, { minRole: 'manager', cap: 'release.decide' });
      if (!ev.ok) { lastErr = `${u.username} may not approve releases of this project`; continue; }
      try {
        await decideReleaseAs(projectId, releaseId, { user: { id: u.id, username: u.username, role: u.role, fullName: u.full_name }, projectRole: ev.role }, `gitlab-mr-${iid}`);
        approvedRelease = { releaseId, by: u.username }; break;
      } catch (e) { lastErr = `${u.username}: ${(e as Error).message}`; }
    }
    if (!approvedRelease) approvalNote = lastErr ?? 'The merge request is approved in GitLab, but none of its approvers is connected to an Agastya account that may approve this release (and is not its requester).';
  } else if (approvals.approved && releaseId && !options(c.link).countApprovals) approvalNote = 'Approved in GitLab. This project does not count GitLab approvals; the Project Manager approves the release in Agastya.';

  // a merged MR moved the project's branch: bring the project up to date
  let pulled: SyncResult['pulled'] = null; let pullError: string | null = null;
  if (mr.data.state === 'merged' && row.state !== 'merged') {
    try { const p = await pullApply(projectId, user, {}, 'merge'); pulled = { applied: p.applied.length, kept: p.kept.length }; } catch (e) { pullError = (e as Error).message; }
  }
  repos.gitlab.updateMr(projectId, iid, { state: mr.data.state, approvals: JSON.stringify(approvals), importedNotes: JSON.stringify([...seen]), syncedAt: nowIso(), webUrl: mr.data.web_url });
  const discussions = (disc.data ?? []).map((d) => ({ id: d.id, notes: (d.notes ?? []).filter((n) => !n.system).map((n) => ({ author: n.author?.username ?? '?', body: String(n.body ?? '').slice(0, 2000), at: n.created_at ?? null, resolved: n.resolvable ? !!n.resolved : null, file: n.position?.new_path ?? null })) })).filter((d) => d.notes.length);
  return { mr: mrView(repos.gitlab.getMr(projectId, iid)!), imported, approvedRelease, approvalNote, pulled, pullError, discussions };
}

/** Approve the MR in GitLab with the person's own GitLab account. */
export async function approveMr(projectId: string, user: Who, iid: number): Promise<void> {
  mrOr404(projectId, iid);
  const c = await ctxFor(projectId, user);
  await gitlabRequest(c.ep, { method: 'POST', path: `${P(c.link.gitlab_project_id)}/merge_requests/${seg(iid)}/approve`, auth: c.auth }, 'approving the merge request');
}

/** Merge the MR in GitLab, then pull the project's branch. */
export async function mergeMr(projectId: string, user: Who, iid: number): Promise<SyncResult> {
  const row = mrOr404(projectId, iid);
  if (row.state === 'merged') throw bad('This merge request is already merged.', 'GITLAB_ALREADY_MERGED');
  const c = await ctxFor(projectId, user);
  try {
    await gitlabRequest(c.ep, { method: 'PUT', path: `${P(c.link.gitlab_project_id)}/merge_requests/${seg(iid)}/merge`, auth: c.auth, json: { should_remove_source_branch: true } }, 'merging');
  } catch (e) {
    if ((e as GitlabError).upstreamStatus === 405 || (e as GitlabError).upstreamStatus === 406) throw conflict('GitLab cannot merge this request now (approvals missing, a conflict, or the pipeline). Look at it in GitLab.', 'GITLAB_NOT_MERGEABLE');
    throw e;
  }
  return syncMr(projectId, user, iid);
}
