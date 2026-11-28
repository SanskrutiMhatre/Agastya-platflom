// Phase 3 (P3-5): the intranet GitLab integration (backend/src/routes/gitlab.ts). Until an administrator saved a tested configuration
// every route except the administrator's answers 404 FEATURE_OFF, and the screens below show nothing of GitLab.
// No token ever reaches the browser: the server makes every GitLab call.

import { ApiError, del, get, post } from './client';

export interface GitlabCheck { id: string; label: string; ok: boolean | null; detail: string; required: boolean }
export interface GitlabTestReport { ok: boolean; checks: GitlabCheck[]; version: string | null; ms: number }
export interface GitlabCertInfo { subject: string; issuer: string; validTo: string; fingerprint256: string; ca: boolean }
export interface GitlabConfigView { baseUrl: string; caPem: string | null; appUrl: string; oauthAppId: string | null; allowPat: boolean; timeoutMs: number; retries: number; maxFileBytes: number; maxCommitBytes: number }
export interface GitlabAdminView {
  configured: boolean; enabled: boolean; verifiedAt: string | null; verifiedVersion: string | null; updatedAt: string | null;
  config: GitlabConfigView; ca: GitlabCertInfo[]; hasClientSecret: boolean; hasServiceToken: boolean; secretProblem: string | null; redirectUri: string; accounts: number;
}
export interface GitlabConfigInput {
  baseUrl: string; caPem?: string | null; appUrl?: string; oauthAppId?: string | null; clientSecret?: string; clearClientSecret?: boolean;
  serviceToken?: string; clearServiceToken?: boolean; allowPat?: boolean; timeoutMs?: number; retries?: number; testToken?: string;
}
export interface GitlabAccount { method: 'oauth' | 'pat'; gitlabUserId: number; username: string; name: string | null; email: string | null; connectedAt: string; expiresAt: string | null; scopes: string | null }
export interface GitlabMe { enabled: true; baseUrl: string; methods: { oauth: boolean; pat: boolean }; account: GitlabAccount | null }
export interface GitlabLink { gitlabProjectId: number; path: string; webUrl: string | null; branch: string; baseCommit: string | null; options: { countApprovals: boolean; releaseOnApproval: boolean }; linkedAt: string; lastPushAt: string | null; lastPullAt: string | null }
export interface GitlabLocalChange { path: string; change: 'added' | 'modified' | 'deleted' }
export interface GitlabRelease { id: string; tag: string; name: string | null; kind: string; webUrl: string | null; assets: Array<{ name: string; url: string }>; metadata: Record<string, unknown>; at: string; by: string | null }
export interface GitlabMrApprovals { approved: boolean; required: number | null; left: number | null; by: Array<{ username: string; name: string; agastyaUser: string | null }>; reviewers: Array<{ username: string; name: string; state: string | null }> }
export interface GitlabMr { iid: number; title: string; state: string; webUrl: string | null; sourceBranch: string; targetBranch: string; releaseId: string | null; createdAt: string; syncedAt: string | null; by: string | null; approvals: GitlabMrApprovals | null }
export interface GitlabStatus {
  link: GitlabLink | null; local: GitlabLocalChange[]; remote: null | { head: string | null; behind: boolean; error?: string; code?: string };
  account: GitlabAccount | null; releases: GitlabRelease[]; mrs: GitlabMr[]; hasPdf: boolean;
}
export type GitlabPullAction = 'apply' | 'merge' | 'conflict' | 'same' | 'blocked';
export interface GitlabIncoming {
  branch: string; head: string | null; base: string | null; upToDate: boolean; conflicts: string[]; localChanges: GitlabLocalChange[];
  items: Array<{ path: string; change: 'added' | 'modified' | 'deleted'; action: GitlabPullAction; reason?: string; localChanged: boolean }>;
  commits: Array<{ id: string; title: string; author: string; at: string; webUrl: string | null }>;
}
export interface GitlabPullResult { head: string | null; branch: string; applied: Array<{ path: string; change: string }>; kept: string[]; blocked: Array<{ path: string; reason: string }>; notes: string[]; upToDate: boolean }
export interface GitlabCommit { id: string; shortId: string; title: string; author: string; email: string; at: string; webUrl: string | null }
export interface GitlabBranch { name: string; commit: string | null; title: string; at: string | null; default: boolean; protected: boolean }
export interface GitlabReviewer { userId: string; username: string; fullName: string; role: string; gitlab: { username: string; id: number } | null }
export interface GitlabSync { mr: GitlabMr; imported: number; approvedRelease: null | { releaseId: string; by: string }; approvalNote: string | null; pulled: null | { applied: number; kept: number }; pullError: string | null;
  discussions: Array<{ id: string; notes: Array<{ author: string; body: string; at: string | null; resolved: boolean | null; file: string | null }> }> }

/** null when GitLab is off (404 FEATURE_OFF), so a screen can simply render nothing. */
async function orOff<T>(p: Promise<T>): Promise<T | null> {
  try { return await p; } catch (e) { if (e instanceof ApiError && e.status === 404 && e.code === 'FEATURE_OFF') return null; throw e; }
}

const A = '/api/admin/gitlab';
const P = (id: string) => `/api/projects/${encodeURIComponent(id)}/gitlab`;

export const gitlabAdminApi = {
  get: () => get<GitlabAdminView>(A, { fresh: true }),
  test: (b: GitlabConfigInput) => post<{ report: GitlabTestReport }>(`${A}/test`, b).then((r) => r.report),
  save: (b: GitlabConfigInput) => post<{ report: GitlabTestReport; settings: GitlabAdminView }>(A, b),
  remove: () => del<{ ok: true; accountsRemoved: number }>(A),
  accounts: () => get<{ accounts: Array<GitlabAccount & { userId: string; user: string | null; fullName: string | null }> }>(`${A}/accounts`, { fresh: true }).then((r) => r.accounts),
  revoke: (userId: string) => del<{ removed: boolean; revokedAtGitlab: boolean }>(`${A}/accounts/${encodeURIComponent(userId)}`),
};

export const gitlabApi = {
  /** null: GitLab is not switched on. */
  me: () => orOff(get<GitlabMe>('/api/gitlab/me', { fresh: true })),
  /** Is GitLab switched on? (a recent answer is enough: the project rail asks on every project it opens) */
  enabled: () => orOff(get<GitlabMe>('/api/gitlab/me', { ttl: 30_000 })).then((r) => !!r).catch(() => false),
  startOauth: (returnTo: string) => post<{ authorizeUrl: string }>('/api/gitlab/connect/oauth', { returnTo }),
  connectToken: (token: string) => post<{ account: GitlabAccount }>('/api/gitlab/connect/token', { token }).then((r) => r.account),
  disconnect: () => del<{ removed: boolean; revokedAtGitlab: boolean }>('/api/gitlab/me'),

  status: (id: string) => orOff(get<GitlabStatus>(P(id), { fresh: true })),
  remoteProjects: (id: string, search: string) => get<{ projects: Array<{ id: number; path: string; name: string; webUrl: string | null; defaultBranch: string | null }> }>(`${P(id)}/remote-projects?search=${encodeURIComponent(search)}`, { fresh: true }).then((r) => r.projects),
  namespaces: (id: string, search = '') => get<{ namespaces: Array<{ id: number; path: string; kind: string; name: string }> }>(`${P(id)}/namespaces?search=${encodeURIComponent(search)}`, { fresh: true }).then((r) => r.namespaces),
  link: (id: string, b: { mode: 'create'; namespaceId?: number; name?: string; path?: string; branch?: string } | { mode: 'existing'; gitlabProjectId: number; branch?: string }) => post<{ link: GitlabLink }>(`${P(id)}/link`, b).then((r) => r.link),
  unlink: (id: string) => del<{ ok: true }>(`${P(id)}/link`),
  options: (id: string, b: { countApprovals?: boolean; releaseOnApproval?: boolean }) => post<{ options: GitlabLink['options'] }>(`${P(id)}/options`, b).then((r) => r.options),
  push: (id: string, message: string) => post<{ commit: { id: string; webUrl: string | null } | null; changes: GitlabLocalChange[]; branch: string }>(`${P(id)}/push`, { message }),
  incoming: (id: string) => get<GitlabIncoming>(`${P(id)}/incoming`, { fresh: true }),
  pull: (id: string, b: { expectHead?: string | null; resolutions?: Record<string, 'mine' | 'theirs'> }) => post<GitlabPullResult>(`${P(id)}/pull`, b),
  branches: (id: string) => get<{ current: string; branches: GitlabBranch[] }>(`${P(id)}/branches`, { fresh: true }),
  createBranch: (id: string, name: string, from?: string) => post<{ branch: { name: string; commit: string | null } }>(`${P(id)}/branches`, { name, from }),
  switchBranch: (id: string, name: string) => post<GitlabPullResult>(`${P(id)}/branch`, { name }),
  commits: (id: string, ref?: string) => get<{ branch: string; base: string | null; commits: GitlabCommit[] }>(`${P(id)}/commits${ref ? `?ref=${encodeURIComponent(ref)}` : ''}`, { fresh: true }),
  releases: (id: string) => get<{ releases: GitlabRelease[]; hasPdf: boolean }>(`${P(id)}/releases`, { fresh: true }),
  uploadRelease: (id: string, b: { kind: 'release' | 'build'; tag?: string; includeArchive?: boolean }) => post<{ release: GitlabRelease }>(`${P(id)}/releases`, b).then((r) => r.release),
  reviewers: (id: string) => get<{ reviewers: GitlabReviewer[] }>(`${P(id)}/reviewers`, { fresh: true }).then((r) => r.reviewers),
  mrs: (id: string) => orOff(get<{ mrs: GitlabMr[] }>(`${P(id)}/mrs`, { fresh: true }).then((r) => r.mrs)),
  openMr: (id: string, b: { title: string; description?: string; reviewers: string[] }) => post<{ mr: GitlabMr; unmappedReviewers: string[]; commit: string | null }>(`${P(id)}/mrs`, b),
  syncMr: (id: string, iid: number) => post<GitlabSync>(`${P(id)}/mrs/${iid}/sync`, {}),
  approveMr: (id: string, iid: number) => post<{ ok: true }>(`${P(id)}/mrs/${iid}/approve`, {}),
  mergeMr: (id: string, iid: number) => post<GitlabSync>(`${P(id)}/mrs/${iid}/merge`, {}),
};
