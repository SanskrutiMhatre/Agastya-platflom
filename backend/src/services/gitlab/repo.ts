// =============================================================================
// Project repositories with push and pull (Phase 3, P3-5), over the GitLab REST API only - no git binary.
//
//   link        an Agastya project <-> a GitLab project and branch (create one in a group, or pick an existing one)
//   push        the project's SOURCE files (see `tracked`) as ONE commit per batch through the Commits API (multi-file actions, base64),
//               author mapped from the user; refused when GitLab has commits the project has not pulled (pull first: nothing is overwritten)
//   pull        the change summary (preview), then apply: a file changed only in GitLab is written; changed on both sides, a text file is
//               merged three-way (base = the file at the last synced commit); a real conflict is never resolved silently - the person
//               chooses "mine" or "theirs" per file. Writes go through the platform's write path (services/projectFiles.ts: the revision
//               first, then the atomic write), under each document's write lock, refusing a file someone else has checked out; then the
//               document index is refreshed, `files changed externally` is raised (services/externalChanges.ts) and connected pages reload.
//   branches    list, create, switch (a switch is refused while there are unpushed changes; it then works as a pull of the other branch)
//   history     the commits of the branch
//
// The base: for every tracked path, the git blob id it had at `gitlab_links.base_commit` (gitlab_sync_files). A local file is "changed"
// when its blob id (sha1 of "blob <len>\0<bytes>", computed here) differs from the base.
// =============================================================================

import crypto from 'crypto';
import path from 'path';
import { nowIso } from '../../config';
import { content, docIndex, projectDirFor, repos } from '../../context';
import { bad, conflict, HttpError } from '../http';
import { broadcast } from '../broadcast';
import { listArchiveFiles } from '../projectArchive';
import { readProjectJson, csdbRel, PROTECTED_PROJECT_KEYS, cleanInput, isS1000dProject } from '../projectRecord';
import { saveRevisioned, recordBeforeDelete, withDocumentLock } from '../projectFiles';
import { assertNotLeasedByOther } from '../leases';
import { DM_FILE_RE, noteDmWritten } from '../csdbIndex';
import { restoreSettings, settingsOf } from '../packageSettings';
import { emitFilesChangedExternally, type ExternalFileChange } from '../externalChanges';
import { gitlabAll, gitlabRequest, seg, GitlabError, type GitlabAuth, type GitlabEndpoint } from './http';
import { activeSettings, endpointOf, type GitlabConfig } from './settings';
import { authFor, serviceAuth } from './accounts';
import { merge3 } from './merge3';
import type { GitlabLinkRow } from '../../repositories/gitlabRepository';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { checkXmlSafety } = require('../../core/auth/xmlGuard') as { checkXmlSafety: (xml: string) => { ok: boolean; error?: string } };

export interface Who { id: string; username: string; fullName?: string | null; role?: string }

export const SETTINGS_PATH = '.agastya/settings.json';
const TEXT_RE = /\.(xml|json|xsl|xslt|ent|dtd|txt|md|csv|html?|css|sgml?|svg|mod|cat)$/i;
const isText = (p: string): boolean => TEXT_RE.test(p);

/**
 * Is a path part of the project's source in the repository? Not: anything under a folder or file whose name starts with "_" or "." (built
 * pictures and logos, temporary and state files), editor backups and temporary files, the PDF/FO a build writes at the top of the project.
 * The one exception is `.agastya/settings.json`, the project configuration the platform writes for a rebuild (S1000D projects).
 */
export function tracked(p: string): boolean {
  if (p === SETTINGS_PATH) return true;
  if (!p || p.length > 400 || p.includes('\\') || p.includes('\0') || /^[A-Za-z]:/.test(p) || p.startsWith('/')) return false;
  const parts = p.split('/');
  if (parts.some((s) => !s || s === '.' || s === '..' || s.startsWith('_') || s.startsWith('.') || /[<>:"|?*\u0000-\u001f]/.test(s) || /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(s))) return false;
  const name = parts[parts.length - 1];
  if (/(\.tmp|\.bak|~|\.swp)$/i.test(name) || /^(thumbs\.db|desktop\.ini)$/i.test(name)) return false;
  if (parts.length === 1 && /\.(pdf|fo)$/i.test(name)) return false;
  return true;
}

export const blobSha = (buf: Buffer): string => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const sha256 = (buf: Buffer): string => crypto.createHash('sha256').update(buf).digest('hex');

/** The project's source files now: path -> bytes (the synthetic settings file included for S1000D projects). */
export function localFiles(projectId: string): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  for (const f of listArchiveFiles(projectDirFor(projectId))) if (tracked(f.rel) && f.rel !== SETTINGS_PATH) out.set(f.rel, content.readBuffer(projectId, f.rel));
  if (isS1000dProject(projectId)) { try { out.set(SETTINGS_PATH, Buffer.from(`${JSON.stringify(settingsOf(projectId), null, 2)}\n`, 'utf8')); } catch { /* no configuration yet */ } }
  return out;
}
const shasOf = (files: Map<string, Buffer>): Map<string, string> => new Map([...files].map(([p, b]) => [p, blobSha(b)]));

// ── context ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface Ctx { ep: GitlabEndpoint; auth: GitlabAuth; cfg: GitlabConfig; link: GitlabLinkRow }
export function linkOf(projectId: string): GitlabLinkRow {
  const l = repos.gitlab.getLink(projectId);
  if (!l) throw new HttpError(409, 'This project is not linked to a GitLab repository yet.', 'GITLAB_NOT_LINKED');
  return l;
}
export async function ctxFor(projectId: string, user: Who, mode: 'write' | 'read' = 'write'): Promise<Ctx> {
  const s = activeSettings();
  const link = linkOf(projectId);
  // A read (branches, history) by a member without a connected account uses the administrator's service token when one is configured;
  // anything that changes GitLab is always done as the person.
  if (mode === 'read' && !repos.gitlab.getAccount(user.id)) { const svc = serviceAuth(); if (svc) return { ep: endpointOf(s.config), auth: svc, cfg: s.config, link }; }
  return { ep: endpointOf(s.config), auth: await authFor(user.id), cfg: s.config, link };
}
const P = (gid: number | string): string => `/api/v4/projects/${seg(gid)}`;
export const options = (l: GitlabLinkRow): { countApprovals: boolean; releaseOnApproval: boolean } => {
  try { const o = JSON.parse(l.options ?? '{}'); return { countApprovals: o.countApprovals === true, releaseOnApproval: o.releaseOnApproval === true }; } catch { return { countApprovals: false, releaseOnApproval: false }; }
};
/** One linked-project operation at a time (push, pull, branch switch, review branch). */
const exclusive = <T>(projectId: string, fn: () => Promise<T>): Promise<T> => withDocumentLock(`gitlab:${projectId}`, fn);

// ── GitLab calls ────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface GlProject { id: number; path_with_namespace: string; web_url?: string; default_branch?: string | null; name?: string; empty_repo?: boolean }
interface GlBranch { name: string; commit: { id: string; message?: string; committed_date?: string }; default?: boolean; protected?: boolean }
interface GlTreeItem { id: string; path: string; type: string; mode?: string }
interface GlCommit { id: string; short_id?: string; title?: string; message?: string; author_name?: string; author_email?: string; authored_date?: string; committed_date?: string; web_url?: string; parent_ids?: string[] }

export async function branchHead(c: Pick<Ctx, 'ep' | 'auth'>, gid: number, branch: string): Promise<string | null> {
  try {
    const r = await gitlabRequest<GlBranch>(c.ep, { path: `${P(gid)}/repository/branches/${seg(branch)}`, auth: c.auth }, `the branch ${branch}`);
    return r.data?.commit?.id ?? null;
  } catch (e) { if ((e as GitlabError).code === 'GITLAB_NOT_FOUND') return null; throw e; }
}

export async function remoteTree(c: Pick<Ctx, 'ep' | 'auth'>, gid: number, ref: string): Promise<Map<string, string>> {
  const items = await gitlabAll<GlTreeItem>(c.ep, { path: `${P(gid)}/repository/tree`, auth: c.auth, query: { ref, recursive: true } }, 'the repository files', 1000);
  return new Map(items.filter((i) => i.type === 'blob' && tracked(i.path)).map((i) => [i.path, i.id]));
}

async function blob(c: Pick<Ctx, 'ep' | 'auth'>, gid: number, sha: string): Promise<Buffer> {
  const r = await gitlabRequest(c.ep, { path: `${P(gid)}/repository/blobs/${seg(sha)}/raw`, auth: c.auth, raw: true, timeoutMs: Math.max(c.ep.timeoutMs, 120_000) }, 'a file of the repository');
  const buf = r.buffer ?? Buffer.alloc(0);
  if (blobSha(buf) !== sha) throw new GitlabError(502, 'A file read from GitLab does not match its id (damaged in transit); nothing was changed.', 'GITLAB_BLOB_MISMATCH');
  return buf;
}

// ── link ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function remoteProjects(user: Who, search: string): Promise<Array<{ id: number; path: string; name: string; webUrl: string | null; defaultBranch: string | null }>> {
  const s = activeSettings(); const ep = endpointOf(s.config); const auth = await authFor(user.id);
  const r = await gitlabRequest<GlProject[]>(ep, { path: '/api/v4/projects', auth, query: { membership: true, simple: true, search: search.slice(0, 100) || undefined, order_by: 'last_activity_at', per_page: 50 } }, 'your GitLab projects');
  return (r.data ?? []).map((p) => ({ id: p.id, path: p.path_with_namespace, name: p.name ?? p.path_with_namespace, webUrl: p.web_url ?? null, defaultBranch: p.default_branch ?? null }));
}

export async function namespaces(user: Who, search: string): Promise<Array<{ id: number; path: string; kind: string; name: string }>> {
  const s = activeSettings(); const ep = endpointOf(s.config); const auth = await authFor(user.id);
  const r = await gitlabRequest<Array<{ id: number; full_path: string; kind: string; name: string }>>(ep, { path: '/api/v4/namespaces', auth, query: { search: search.slice(0, 100) || undefined, per_page: 50 } }, 'your GitLab groups');
  return (r.data ?? []).map((n) => ({ id: n.id, path: n.full_path, kind: n.kind, name: n.name }));
}

const PATH_RE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/;
const BRANCH_RE = /^(?!\/|.*\/\/|.*\.\.|.*@\{|.*\.lock$|.*\/$)[A-Za-z0-9._\/-]{1,200}$/;
export const assertBranchName = (b: string): string => { if (!BRANCH_RE.test(b)) throw bad('That is not a branch name GitLab accepts (letters, digits, . _ - /).', 'GITLAB_BAD_BRANCH'); return b; };

export async function linkProject(projectId: string, user: Who, body: Record<string, unknown>): Promise<GitlabLinkRow> {
  if (repos.gitlab.getLink(projectId)) throw conflict('This project is already linked. Unlink it first to link another repository.', 'GITLAB_ALREADY_LINKED');
  const s = activeSettings(); const ep = endpointOf(s.config); const auth = await authFor(user.id);
  let proj: GlProject;
  if (body.mode === 'create') {
    const name = String(body.name ?? readProjectJson(projectId).name ?? projectId).trim().slice(0, 200);
    const p = String(body.path ?? name).trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 100);
    if (!PATH_RE.test(p)) throw bad('The repository path must be letters, digits, ".", "_" or "-".', 'GITLAB_BAD_PATH');
    const nsId = Number(body.namespaceId);
    const r = await gitlabRequest<GlProject>(ep, { method: 'POST', path: '/api/v4/projects', auth, json: {
      name, path: p, ...(Number.isInteger(nsId) && nsId > 0 ? { namespace_id: nsId } : {}), visibility: 'private', initialize_with_readme: false,
      description: `Agastya project ${readProjectJson(projectId).name ?? projectId} (source content)`, default_branch: String(body.branch ?? 'main'),
    } }, 'creating the repository');
    proj = r.data;
  } else {
    const gid = Number(body.gitlabProjectId);
    if (!Number.isInteger(gid) || gid <= 0) throw bad('Choose the GitLab project to link.', 'GITLAB_PROJECT_REQUIRED');
    proj = (await gitlabRequest<GlProject>(ep, { path: P(gid), auth }, 'that project')).data;
  }
  const branch = assertBranchName(String(body.branch ?? proj.default_branch ?? 'main').trim() || 'main');
  const row: GitlabLinkRow = {
    project_id: projectId, gitlab_project_id: proj.id, path_with_namespace: proj.path_with_namespace, web_url: proj.web_url ?? null, branch,
    base_commit: null, options: JSON.stringify({ countApprovals: body.countApprovals === true, releaseOnApproval: body.releaseOnApproval === true }),
    linked_by: user.id, linked_at: nowIso(), last_push_at: null, last_pull_at: null,
  };
  repos.gitlab.putLink(row);
  repos.gitlab.replaceSyncFiles(projectId, new Map());
  return row;
}

export function unlinkProject(projectId: string): void { linkOf(projectId); repos.gitlab.deleteLink(projectId); }

// ── status ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface LocalChange { path: string; change: 'added' | 'modified' | 'deleted' }
export function localChanges(projectId: string, local = shasOf(localFiles(projectId))): LocalChange[] {
  const base = repos.gitlab.syncFiles(projectId);
  const out: LocalChange[] = [];
  for (const [p, sha] of local) { const b = base.get(p); if (!b) out.push({ path: p, change: 'added' }); else if (b !== sha) out.push({ path: p, change: 'modified' }); }
  for (const p of base.keys()) if (!local.has(p)) out.push({ path: p, change: 'deleted' });
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

export function linkView(l: GitlabLinkRow | null) {
  if (!l) return null;
  return { gitlabProjectId: l.gitlab_project_id, path: l.path_with_namespace, webUrl: l.web_url, branch: l.branch, baseCommit: l.base_commit, options: options(l), linkedAt: l.linked_at, lastPushAt: l.last_push_at, lastPullAt: l.last_pull_at };
}

/** The link, the local changes, and (when the user is connected) where the branch is in GitLab. */
export async function status(projectId: string, user: Who) {
  const l = repos.gitlab.getLink(projectId);
  if (!l) return { link: null, local: [], remote: null };
  const local = localChanges(projectId);
  let remote: null | { head: string | null; behind: boolean; error?: string; code?: string } = null;
  try {
    const c = await ctxFor(projectId, user);
    const head = await branchHead(c, l.gitlab_project_id, l.branch);
    remote = { head, behind: !!head && head !== l.base_commit };
  } catch (e) { remote = { head: null, behind: false, error: (e as Error).message, code: (e as HttpError).code }; }
  return { link: linkView(l), local, remote };
}

// ── push ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

interface Action { action: 'create' | 'update' | 'delete'; file_path: string; content?: string; encoding?: 'base64' }

function authorOf(user: Who): { author_name: string; author_email: string } {
  const a = repos.gitlab.getAccount(user.id);
  return { author_name: String(user.fullName || a?.gitlab_name || user.username), author_email: a?.gitlab_email || `${user.username}@users.agastya.invalid` };
}

/** Commit `actions` to `branch` in batches of at most maxCommitBytes; returns the last commit. */
async function commitActions(c: Ctx, branch: string, startBranch: string | null, message: string, actions: Action[], sizes: Map<string, number>, user: Who): Promise<GlCommit | null> {
  const batches: Action[][] = [];
  let cur: Action[] = []; let bytes = 0;
  for (const a of actions) {
    const n = sizes.get(a.file_path) ?? 0;
    if (cur.length && (bytes + n > c.cfg.maxCommitBytes || cur.length >= 500)) { batches.push(cur); cur = []; bytes = 0; }
    cur.push(a); bytes += n;
  }
  if (cur.length) batches.push(cur);
  let last: GlCommit | null = null;
  for (const [i, batch] of batches.entries()) {
    const msg = batches.length > 1 ? `${message} (part ${i + 1} of ${batches.length})` : message;
    const r = await gitlabRequest<GlCommit>(c.ep, { method: 'POST', path: `${P(c.link.gitlab_project_id)}/repository/commits`, auth: c.auth, timeoutMs: Math.max(c.ep.timeoutMs, 300_000), json: {
      branch, commit_message: msg, actions: batch, ...authorOf(user), ...(i === 0 && startBranch ? { start_branch: startBranch } : {}),
    } }, 'the commit');
    last = r.data;
  }
  return last;
}

function actionsFor(local: Map<string, Buffer>, remote: Map<string, string>, cfg: GitlabConfig): { actions: Action[]; sizes: Map<string, number>; changed: LocalChange[] } {
  const actions: Action[] = []; const sizes = new Map<string, number>(); const changed: LocalChange[] = []; const tooBig: string[] = [];
  for (const [p, buf] of local) {
    const r = remote.get(p); const sha = blobSha(buf);
    if (r === sha) continue;
    if (buf.length > cfg.maxFileBytes) { tooBig.push(`${p} (${(buf.length / 1048576).toFixed(1)} MB)`); continue; }
    actions.push({ action: r ? 'update' : 'create', file_path: p, content: buf.toString('base64'), encoding: 'base64' });
    sizes.set(p, buf.length); changed.push({ path: p, change: r ? 'modified' : 'added' });
  }
  if (tooBig.length) throw new HttpError(413, `These files are larger than the ${(cfg.maxFileBytes / 1048576).toFixed(0)} MB a push sends through the GitLab API: ${tooBig.join(', ')}. Make them smaller, or keep them in Git LFS (set up by the GitLab administrator; see docs/OPERATIONS.md, GitLab) - nothing was pushed.`, 'GITLAB_FILE_TOO_LARGE', { files: tooBig });
  for (const p of remote.keys()) if (!local.has(p)) { actions.push({ action: 'delete', file_path: p }); changed.push({ path: p, change: 'deleted' }); }
  return { actions, sizes, changed };
}

export async function push(projectId: string, user: Who, message: string): Promise<{ commit: GlCommit | null; changes: LocalChange[]; branch: string }> {
  return exclusive(projectId, async () => {
    const c = await ctxFor(projectId, user);
    const { link } = c; const gid = link.gitlab_project_id;
    const head = await branchHead(c, gid, link.branch);
    if (head && head !== link.base_commit) {
      throw conflict(`GitLab has commits on ${link.branch} that this project has not pulled yet. Pull first; nothing was pushed.`, 'GITLAB_REMOTE_AHEAD', { head, base: link.base_commit });
    }
    const local = localFiles(projectId);
    const remote = head ? await remoteTree(c, gid, head) : new Map<string, string>();
    const { actions, sizes, changed } = actionsFor(local, remote, c.cfg);
    if (!actions.length) { repos.gitlab.replaceSyncFiles(projectId, remote); return { commit: null, changes: [], branch: link.branch }; }
    // an empty repository gets its first branch from this commit; in a repository that has commits the branch must exist
    if (!head) {
      const proj = (await gitlabRequest<GlProject>(c.ep, { path: P(gid), auth: c.auth }, 'the repository')).data;
      if (proj.default_branch && proj.default_branch !== link.branch && await branchHead(c, gid, proj.default_branch)) {
        throw conflict(`The branch ${link.branch} does not exist in GitLab. Create it (Branches) or switch to an existing branch first.`, 'GITLAB_NO_BRANCH');
      }
    }
    const commit = await commitActions(c, link.branch, null, String(message || '').trim().slice(0, 2000) || `Update from Agastya by ${user.username}`, actions, sizes, user);
    const next = new Map(remote);
    for (const [p, buf] of local) next.set(p, blobSha(buf));
    for (const p of remote.keys()) if (!local.has(p)) next.delete(p);
    repos.gitlab.replaceSyncFiles(projectId, next);
    repos.gitlab.setLinkSync(projectId, { branch: link.branch, baseCommit: commit?.id ?? head, at: nowIso(), kind: 'push' });
    return { commit, changes: changed, branch: link.branch };
  });
}

// ── pull ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────

export type PullAction = 'apply' | 'merge' | 'conflict' | 'same' | 'blocked';
export interface PullItem { path: string; change: 'added' | 'modified' | 'deleted'; action: PullAction; reason?: string; localChanged: boolean }
interface Plan {
  head: string | null; base: string | null; branch: string; items: PullItem[];
  remote: Map<string, string>; merged: Map<string, Buffer>; local: Map<string, Buffer>;
  commits: Array<{ id: string; title: string; author: string; at: string; webUrl: string | null }>;
}

async function plan(c: Ctx, projectId: string, branch: string): Promise<Plan> {
  const gid = c.link.gitlab_project_id;
  const head = await branchHead(c, gid, branch);
  const local = localFiles(projectId);
  const base = repos.gitlab.syncFiles(projectId);
  const out: Plan = { head, base: c.link.base_commit, branch, items: [], remote: new Map(), merged: new Map(), local, commits: [] };
  if (!head) return out;
  if (head === c.link.base_commit && branch === c.link.branch) { out.remote = new Map(base); return out; }
  const remote = await remoteTree(c, gid, head);
  out.remote = remote;
  try {
    if (c.link.base_commit && branch === c.link.branch) {
      const cmp = await gitlabRequest<{ commits?: GlCommit[] }>(c.ep, { path: `${P(gid)}/repository/compare`, auth: c.auth, query: { from: c.link.base_commit, to: head } }, 'the change list');
      out.commits = (cmp.data?.commits ?? []).map((x) => ({ id: x.id, title: x.title ?? '', author: x.author_name ?? '', at: x.committed_date ?? x.authored_date ?? '', webUrl: x.web_url ?? null }));
    } else {
      const cl = await gitlabRequest<GlCommit[]>(c.ep, { path: `${P(gid)}/repository/commits`, auth: c.auth, query: { ref_name: head, per_page: 20 } }, 'the commits');
      out.commits = (cl.data ?? []).map((x) => ({ id: x.id, title: x.title ?? '', author: x.author_name ?? '', at: x.committed_date ?? x.authored_date ?? '', webUrl: x.web_url ?? null }));
    }
  } catch { /* the summary of files is what matters; the commit list is a courtesy */ }
  const paths = new Set([...remote.keys(), ...base.keys()]);
  for (const p of [...paths].sort()) {
    const b = base.get(p) ?? null; const r = remote.get(p) ?? null;
    const lb = local.get(p); const l = lb ? blobSha(lb) : null;
    if (r === b) continue;                                             // GitLab did not change it
    const change: PullItem['change'] = !r ? 'deleted' : !b ? 'added' : 'modified';
    const localChanged = l !== b;
    if (l === r) { out.items.push({ path: p, change, action: 'same', localChanged }); continue; }
    if (!localChanged) { out.items.push({ path: p, change, action: 'apply', localChanged }); continue; }
    // both sides changed
    if (b && r && lb && isText(p) && p !== SETTINGS_PATH) {
      try {
        const [bt, rt] = await Promise.all([blob(c, gid, b), blob(c, gid, r)]);
        const m = merge3(bt.toString('utf8'), lb.toString('utf8'), rt.toString('utf8'));
        if (m.clean && m.text !== null) { out.merged.set(p, Buffer.from(m.text, 'utf8')); out.items.push({ path: p, change, action: 'merge', localChanged, reason: 'changed here and in GitLab; the changes do not overlap and are combined' }); continue; }
        out.items.push({ path: p, change, action: 'conflict', localChanged, reason: `changed here and in GitLab in the same place (${m.conflicts} region${m.conflicts === 1 ? '' : 's'})` });
        continue;
      } catch (e) { out.items.push({ path: p, change, action: 'conflict', localChanged, reason: `changed on both sides; the three-way merge could not run (${(e as Error).message})` }); continue; }
    }
    out.items.push({ path: p, change, action: 'conflict', localChanged, reason: !r ? 'deleted in GitLab but changed here' : !l ? 'changed in GitLab but deleted here' : !b ? 'added here and in GitLab with different content' : 'changed here and in GitLab (not a text file: choose one)' });
  }
  return out;
}

export async function pullPreview(projectId: string, user: Who) {
  const c = await ctxFor(projectId, user);
  const p = await plan(c, projectId, c.link.branch);
  return { branch: p.branch, head: p.head, base: p.base, upToDate: !p.head || p.head === p.base, items: p.items, commits: p.commits, conflicts: p.items.filter((i) => i.action === 'conflict').map((i) => i.path), localChanges: localChanges(projectId, shasOf(p.local)) };
}

/** project.json from GitLab: the keys only the platform sets (id, name, format, input...) stay as they are here. */
function adoptProjectJson(projectId: string, remote: Buffer): Buffer {
  let theirs: Record<string, unknown>;
  try { theirs = JSON.parse(remote.toString('utf8')); } catch { throw bad('project.json in GitLab is not valid JSON; it was not applied.', 'GITLAB_BAD_PROJECT_JSON'); }
  const mine = readProjectJson(projectId);
  const out: Record<string, unknown> = { ...theirs };
  for (const k of PROTECTED_PROJECT_KEYS) { if (mine[k] === undefined) delete out[k]; else out[k] = mine[k]; }
  if (out.input !== undefined) out.input = cleanInput(out.input);
  return Buffer.from(`${JSON.stringify(out, null, 2)}\n`, 'utf8');
}

interface Applied { files: ExternalFileChange[]; notes: string[]; blocked: Array<{ path: string; reason: string }> }

async function writeOne(projectId: string, rel: string, data: Buffer | null, user: Who, applied: Applied): Promise<void> {
  const actor = { id: user.id, username: user.username, role: user.role };
  await withDocumentLock(`${projectId}:${rel}`, async () => {
    const exists = content.exists(projectId, rel);
    const before = exists ? sha256(content.readBuffer(projectId, rel)) : null;
    try { await assertNotLeasedByOther(projectId, rel, actor); } catch (e) { applied.blocked.push({ path: rel, reason: (e as Error).message }); return; }
    if (data === null) {
      if (!exists) return;
      if (isText(rel)) await recordBeforeDelete(projectId, rel, actor);
      content.remove(projectId, rel);
      applied.files.push({ path: rel, change: 'deleted', before, after: null });
    } else {
      if (/\.xml$/i.test(rel)) { const g = checkXmlSafety(data.toString('utf8')); if (!g.ok) { applied.blocked.push({ path: rel, reason: `unsafe XML refused: ${g.error}` }); return; } }
      if (isText(rel)) await saveRevisioned(projectId, rel, data.toString('utf8'), actor, 'gitlab-pull');
      else { content.mkdir(projectId, path.posix.dirname(rel) || '.'); content.writeBuffer(projectId, rel, data); }
      applied.files.push({ path: rel, change: exists ? 'modified' : 'added', before, after: sha256(data) });
    }
    const csdb = csdbRel(readProjectJson(projectId));
    const file = rel.slice(csdb.length + 1);
    if (rel.startsWith(`${csdb}/`) && !file.includes('/') && DM_FILE_RE.test(file)) noteDmWritten(projectId, file, data ? data.toString('utf8') : null);
  });
}

export interface PullResult { head: string | null; branch: string; applied: ExternalFileChange[]; kept: string[]; blocked: Array<{ path: string; reason: string }>; notes: string[]; upToDate: boolean }

/** Apply what GitLab has. `resolutions[path]` = 'mine' | 'theirs' for each conflict; an unresolved conflict refuses the whole pull (409). */
async function applyPlan(c: Ctx, projectId: string, user: Who, p: Plan, resolutions: Record<string, string>, operation: 'pull' | 'branch' | 'merge'): Promise<PullResult> {
  const open = p.items.filter((i) => i.action === 'conflict' && resolutions[i.path] !== 'mine' && resolutions[i.path] !== 'theirs');
  if (open.length) throw conflict(`${open.length} file${open.length === 1 ? ' was' : 's were'} changed both here and in GitLab. Choose which version to keep for each; nothing was changed.`, 'GITLAB_PULL_CONFLICTS', { conflicts: open });
  const applied: Applied = { files: [], notes: [], blocked: [] };
  const kept: string[] = [];
  const gid = c.link.gitlab_project_id;
  const newBase = new Map(p.remote);
  for (const it of p.items) {
    const choice = it.action === 'conflict' ? resolutions[it.path] : it.action === 'apply' ? 'theirs' : it.action === 'merge' ? 'merged' : 'same';
    if (choice === 'same') continue;
    if (choice === 'mine') { kept.push(it.path); continue; }
    const r = p.remote.get(it.path) ?? null;
    let data: Buffer | null = choice === 'merged' ? p.merged.get(it.path)! : r ? await blob(c, gid, r) : null;
    if (it.path === SETTINGS_PATH) {
      if (data) {
        try {
          const rep = restoreSettings(projectId, user.id, JSON.parse(data.toString('utf8')));
          applied.notes.push(...rep.notes, ...(rep.restored.length ? [`Project configuration from GitLab applied: ${rep.restored.join(', ')}.`] : []));
          applied.files.push({ path: it.path, change: 'modified', before: null, after: sha256(data) });
        } catch (e) { applied.blocked.push({ path: it.path, reason: `the project configuration in GitLab could not be applied: ${(e as Error).message}` }); }
      }
      continue;
    }
    if (it.path === 'project.json' && data) data = adoptProjectJson(projectId, data);
    const n = applied.blocked.length;
    await writeOne(projectId, it.path, data, user, applied);
    if (applied.blocked.length > n) { const b = repos.gitlab.syncFiles(projectId).get(it.path); if (b) newBase.set(it.path, b); else newBase.delete(it.path); }
  }
  repos.gitlab.replaceSyncFiles(projectId, newBase);
  repos.gitlab.setLinkSync(projectId, { branch: p.branch, baseCommit: p.head, at: nowIso(), kind: operation === 'branch' ? 'branch' : 'pull' });
  if (applied.files.length) {
    try { await docIndex.syncProject(projectId, projectDirFor(projectId), nowIso()); } catch (e) { applied.notes.push(`The document index will catch up on the next open (${(e as Error).message}).`); }
    emitFilesChangedExternally({ projectId, source: 'gitlab', actor: { id: user.id, username: user.username }, files: applied.files, detail: { commit: p.head, branch: p.branch, operation }, at: nowIso() });
    try { broadcast(projectId, { type: 'reload', kind: 'external' }); } catch { /* no sockets in this process */ }
  }
  return { head: p.head, branch: p.branch, applied: applied.files, kept, blocked: applied.blocked, notes: applied.notes, upToDate: !p.items.length };
}

export async function pullApply(projectId: string, user: Who, body: { expectHead?: unknown; resolutions?: unknown }, operation: 'pull' | 'merge' = 'pull'): Promise<PullResult> {
  return exclusive(projectId, async () => {
    const c = await ctxFor(projectId, user);
    const p = await plan(c, projectId, c.link.branch);
    if (body.expectHead && p.head && body.expectHead !== p.head) throw conflict('GitLab changed again since the summary was shown. Look at the new summary and pull again.', 'GITLAB_HEAD_MOVED', { head: p.head });
    if (!p.head) return { head: null, branch: p.branch, applied: [], kept: [], blocked: [], notes: ['The branch has no commits yet.'], upToDate: true };
    const res = (body.resolutions && typeof body.resolutions === 'object') ? body.resolutions as Record<string, string> : {};
    return applyPlan(c, projectId, user, p, res, operation);
  });
}

// ── branches and history ────────────────────────────────────────────────────────────────────────────────────────────────────────

export async function branches(projectId: string, user: Who) {
  const c = await ctxFor(projectId, user, 'read');
  const list = await gitlabAll<GlBranch>(c.ep, { path: `${P(c.link.gitlab_project_id)}/repository/branches`, auth: c.auth }, 'the branches', 10);
  return { current: c.link.branch, branches: list.map((b) => ({ name: b.name, commit: b.commit?.id ?? null, title: b.commit?.message?.split('\n')[0] ?? '', at: b.commit?.committed_date ?? null, default: !!b.default, protected: !!b.protected })) };
}

export async function createBranch(projectId: string, user: Who, name: string, from?: string): Promise<{ name: string; commit: string | null }> {
  const c = await ctxFor(projectId, user);
  const b = assertBranchName(String(name ?? '').trim());
  const ref = from ? assertBranchName(String(from)) : c.link.branch;
  const r = await gitlabRequest<GlBranch>(c.ep, { method: 'POST', path: `${P(c.link.gitlab_project_id)}/repository/branches`, auth: c.auth, query: { branch: b, ref } }, 'creating the branch');
  return { name: r.data.name, commit: r.data.commit?.id ?? null };
}

/** Switch the project to another branch: refused while there are unpushed changes; then the other branch is applied like a pull. */
export async function switchBranch(projectId: string, user: Who, name: string): Promise<PullResult> {
  return exclusive(projectId, async () => {
    const c = await ctxFor(projectId, user);
    const b = assertBranchName(String(name ?? '').trim());
    if (b === c.link.branch) throw bad(`The project is already on ${b}.`, 'GITLAB_SAME_BRANCH');
    const changes = localChanges(projectId);
    if (changes.length) throw conflict(`This project has ${changes.length} change${changes.length === 1 ? '' : 's'} not pushed to ${c.link.branch}. Push them first; nothing was switched.`, 'GITLAB_LOCAL_CHANGES', { changes });
    const head = await branchHead(c, c.link.gitlab_project_id, b);
    if (!head) throw new HttpError(404, `GitLab has no branch ${b}.`, 'GITLAB_NOT_FOUND');
    if (c.link.base_commit && head !== c.link.base_commit) {
      const p = await plan(c, projectId, b);
      return applyPlan(c, projectId, user, p, {}, 'branch');
    }
    repos.gitlab.setLinkSync(projectId, { branch: b, baseCommit: head, at: nowIso(), kind: 'branch' });
    return { head, branch: b, applied: [], kept: [], blocked: [], notes: [], upToDate: true };
  });
}

export async function commits(projectId: string, user: Who, ref?: string) {
  const c = await ctxFor(projectId, user, 'read');
  const r = await gitlabRequest<GlCommit[]>(c.ep, { path: `${P(c.link.gitlab_project_id)}/repository/commits`, auth: c.auth, query: { ref_name: ref ? assertBranchName(ref) : c.link.branch, per_page: 50 } }, 'the history');
  return { branch: ref ?? c.link.branch, base: c.link.base_commit, commits: (r.data ?? []).map((x) => ({ id: x.id, shortId: x.short_id ?? x.id.slice(0, 8), title: x.title ?? '', author: x.author_name ?? '', email: x.author_email ?? '', at: x.committed_date ?? x.authored_date ?? '', webUrl: x.web_url ?? null })) };
}

/** Push the project's content to a NEW branch (for a review) without moving the project's own branch. */
export async function pushToReviewBranch(projectId: string, user: Who, branch: string, message: string): Promise<{ commit: GlCommit; changes: LocalChange[] }> {
  return exclusive(projectId, async () => {
    const c = await ctxFor(projectId, user);
    const gid = c.link.gitlab_project_id;
    const head = await branchHead(c, gid, c.link.branch);
    if (head && head !== c.link.base_commit) throw conflict(`GitLab has commits on ${c.link.branch} that this project has not pulled yet. Pull first.`, 'GITLAB_REMOTE_AHEAD', { head });
    const local = localFiles(projectId);
    const remote = head ? await remoteTree(c, gid, head) : new Map<string, string>();
    const { actions, sizes, changed } = actionsFor(local, remote, c.cfg);
    if (!actions.length) throw conflict(`The project has no changes against ${c.link.branch} to review. Edit it first (a merge request needs a difference).`, 'GITLAB_NOTHING_TO_REVIEW');
    if (!head) throw conflict(`The branch ${c.link.branch} has no commits yet: push the project once before starting a review.`, 'GITLAB_NO_BRANCH');
    await gitlabRequest(c.ep, { method: 'POST', path: `${P(gid)}/repository/branches`, auth: c.auth, query: { branch: assertBranchName(branch), ref: head } }, 'creating the review branch');
    const commit = await commitActions(c, branch, null, message, actions, sizes, user);
    return { commit: commit!, changes: changed };
  });
}
