// Typed calls to the platform API. Shapes mirror backend/src/routes and the
// JSS auth routes in backend/src/core/auth/routes.js.

import { get, post, put, patch, del, request } from './client';

// ── Types ─────────────────────────────────────────────────────────────────

export type ProjectRole = 'viewer' | 'reviewer' | 'editor' | 'manager' | 'owner';
export type GlobalRole = 'admin' | 'project_manager' | 'author';
export interface User { id: string; username: string; fullName: string; role: GlobalRole; createdBy?: string | null; disabled?: boolean; onboardingPending?: boolean; mustChangePassword?: boolean; createdAt?: string;
  /** WP-27: where the account signs in, why it is disabled ('directory' = offboarded by the directory), the read-only auditor flag. */
  authSource?: 'local' | 'directory'; disabledReason?: string | null; auditor?: boolean;
  /** When the person last signed in (the newest session they started); null = never. Administrators' users list only. */
  lastSignInAt?: string | null }
export interface Gates { onboarding: boolean; mustChangePassword: boolean }
export interface AdminQueues { approvals: number; changes: number; folderRequests: number; resets: number; ownerless: number; releases: number }

export interface FormatInfo { id: 's1000d' | 'jss' | 'jsg'; label: string; description: string; ready: boolean; domains: Array<{ id: string; label: string; manualTypes: Array<{ id: string; label: string; ready: boolean; notReady?: string; note?: string }> }> }
/** The server's first guess at what an upload is; the person confirms or corrects it (components/importSource.ts). */
export interface PackageDetection { token: string; name: string; format: 's1000d' | 'jss' | 'jsg' | 'unknown'; kind: 'package' | 'document'; dataModules: number; publicationModules: number; graphics: number; other: number; entries: number; olderTool: boolean; docType?: string;
  /** The upload is a project archive made by this platform (the Export of a project): its format and what it was (it comes back as the same project, in the same format). */
  archive?: { format: 's1000d' | 'jss' | 'jsg'; domain: string | null; manualType: string | null; name: string } }
export interface ProjectCard {
  id: string; name: string; type: string; pipeline: 's1000dtofo' | 's1000dtojss'; templateRef: string; folder: string; status: string;
  format: 's1000d' | 'jss' | 'jsg'; domain: string | null; manualType: string | null; authoring: 'jss-xml' | null; jssDocType: string | null; autoAddToPublication: boolean; sideText: { enabled: boolean; publisher: string; draftNote: boolean }; headerLogo: boolean;
  role: ProjectRole; accessVia: 'project' | 'folder' | 'admin' | 'group' | 'auditor'; dmCount: number; hasPdf: boolean;
  /** WP-13 (FE-019): what the signed-in person may do here, computed by the server from its route guards (lib/roles.ts may()). */
  can?: Partial<Record<string, boolean>>;
  createdAt: string; updatedAt: string; lastOpened: string | null; owners: string[];
  /** WP-06: the folder was not found at the last start; the project is kept until an administrator restores the folder or deletes it. */
  missingSince?: string | null;
}
export interface FolderView { key: string; name: string; owner: { id: string; username: string; fullName: string } | null; canManage: boolean; accessRole: string | null; projects: ProjectCard[] }
/** UI redesign (screen 1): what the dashboard's Projects table shows of a project beside its card (display only). */
export interface DashboardFacts { release: ReleaseStatus; changedSinceRelease: boolean; validation: { error: number; warn: number; ranAt: string } | null }
export interface Overview {
  counts: { projects: number; folders: number; dataModules: number; published: number; invitations: number };
  recent: Array<ProjectCard & Partial<DashboardFacts>>;
  activity: Array<{ id: number; at: string; actor: string | null; actorName?: string | null; action: string; projectId: string | null; projectName: string | null; meta: unknown }>;
}

export interface DmSummary {
  file: string; dmc: string; techName: string; infoName: string; title: string; issueNumber: string; inWork: string;
  language: string; schema: string; issue: string; security: string; size: number; modified: string; locked?: boolean;
  dmCodeAttrs?: Record<string, string>; identExtension?: Record<string, string>; issueInfoAttrs?: Record<string, string>; languageAttrs?: Record<string, string>;
}
export type ExploreNode =
  | { kind: 'chapter'; title: string; children: ExploreNode[]; dmCount: number }
  | { kind: 'dm'; title: string; file: string; dmc: string; infoName: string; issue: string; found: true; style: 'include' | 'dmRef' }
  | { kind: 'missing'; title: string; ref: string; style: 'include' | 'dmRef' }
  | { kind: 'pmRef'; title: string };
export interface Explore {
  meta: { pmTitle?: string; shortPmTitle?: string; pmCode?: Record<string, string> };
  tree: ExploreNode[]; unplaced: DmSummary[]; missing: string[]; warnings: string[];
  totals: { dms: number; placed: number; unplaced: number; missing: number };
  counts: { folders: number; dms: number; total: number };
}

export interface ValidationIssue { id: string; source: 'xml' | 'xsd' | 'brex' | 'graphics' | 'ids' | 'icn' | 'pm'; sev: 'error' | 'warn' | 'info'; title: string; rel: string; file: string; line: number; loc: string; detail: string }
export interface ValidationRun { ranAt: string; issueUsed: string; checked: number; schemaChecked: number; brexChecked: number; summary: { error: number; warn: number; info: number }; issues: ValidationIssue[]; notes: string[] }

export interface ReleaseOverview {
  release: { number: number; scheduledAt: string; note: string | null } | null;
  staleRelease: { number: number; scheduledAt: string; note: string | null } | null;
  scheduled: { number: number; scheduledAt: string; note: string | null } | null;
  pending: { id: string; scheduledAt: string; note: string | null; requestedAt: string; requestedBy: string | null } | null;
  sources: number; publicationRel: string;
  history: Array<{ id: string; releaseNumber: number | null; scheduledAt: string; status: string; note: string | null; requestedAt: string; requestedBy: string | null; decidedAt: string | null }>;
  watermark: { enabled: boolean; text: string; style: string }; watermarkStyles: string[]; canSubmit: boolean; canApprove: boolean; approveBlocked?: string | null;
  review: Review;
  /** Phase 3 (P3-4): the comments on the generated PDF (blockRelease = release waits for the open required ones) */
  pdfReview?: { open: number; openRequired: number; total: number; blockRelease: boolean };
}

export type ReviewState = 'draft' | 'in_review' | 'changes_requested' | 'approved';
export interface ReviewAnchor { path: string; tag: string; text: string }
export interface ReviewComment { id: number; kind: 'comment' | 'changes'; body: string; dmFile: string | null; anchor: ReviewAnchor | null; releaseId: string | null; by: string | null; byName: string | null; byRole: string | null; at: string; resolved: boolean; resolvedAt: string | null; resolvedBy: string | null }
export interface Review { state: ReviewState; round: number; comments: ReviewComment[]; open: number; canComment: boolean }

export type GraphicKind = 'icn' | 'symbol';
export interface Graphic { name: string; kind: GraphicKind; dir: 'csdb' | 'Media'; size: number; modified: string; usedBy: string[] }
export interface CirModule { id: string; file: string; title: string | null; infoName: string | null; dmc: string | null; infoCode: string | null; kind: string | null; note: string | null; addedBy: string | null; addedByName: string | null; addedAt: string }
export interface ConfigField { key: string; label: string; type?: 'text' | 'boolean'; required?: boolean; mono?: boolean; width?: number | string }
export interface ConfigSpec { id: string; title: string; noun: string; description: string; fields: ConfigField[] }
export interface ConfigItem { id: string; [k: string]: unknown }
export interface AppSettings { appName: string; organisation: string; accent: string; compact: boolean; theme: 'light' | 'dark' }

export interface Summary {
  project: ProjectCard; role: ProjectRole;
  dataModules: { total: number; withIssues: number | null };
  publication: { totals: Explore['totals']; chapters: number; title: string } | null;
  validation: { ranAt: string; error: number; warn: number; info: number } | null;
  release: { released: boolean; stale: boolean; number: number | null; pending: boolean; scheduledAt: string | null } | null;
  /** `pages`: the page count of the last PDF (null when it cannot be read) */
  build: { builtAt: string; size: number; pages?: number | null } | null;
  /** S1000D projects: the issue (4.2, 5.0 ...) and the model identification code, for the Project Home header; null for JSS, JSG and the shared repository */
  s1000d?: { issue: string; mic: string | null } | null;
  members: number;
  /** WP-22: the review loop (state, round, open comments) and how many findings of the last check the team marked reviewed; null when unknown */
  review?: { state: ReviewState; round: number; open: number } | null;
  problems?: { reviewed: number } | null;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export const authApi = {
  setupRequired: () => get<{ setupRequired: boolean }>('/api/auth/setup', { quiet401: true }),
  setup: (b: { username: string; password: string; fullName: string }) => post<{ user: User; gates: Gates }>('/api/auth/setup', b, { quiet401: true }),
  login: (username: string, password: string) => post<{ user: User; gates: Gates }>('/api/auth/login', { username, password }, { quiet401: true }),
  logout: () => post('/api/auth/logout'),
  /** `ttl`: an answer this recent is enough (the refresh on navigation, WP-18); any write since clears it. */
  me: (o?: { ttl?: number }) => get<{ user: User; gates: Gates; pendingInvitations: number; adminQueues?: AdminQueues }>('/api/auth/me', { quiet401: true, ttl: o?.ttl }),
  onboarding: (b: { username: string; password: string }) => post<{ user: User }>('/api/auth/onboarding', b),
  changePassword: (currentPassword: string, newPassword: string) => post('/api/auth/change-password', { currentPassword, newPassword }),
  forgot: (username: string) => post('/api/auth/forgot', { username }, { quiet401: true }),
  /** The person is working (typing, clicking) in a page that has not called the server for a while: keeps the session from going idle. */
  activity: () => post<{ ok: true }>('/api/auth/activity', {}),
  /** The same as me(), sent as a background check: it does not count as activity (FE-003 heartbeat). */
  check: () => get<{ user: User }>('/api/auth/me', { quiet401: true, background: true }),
};

// ── Workspace / projects ──────────────────────────────────────────────────

export const workspaceApi = {
  overview: () => get<Overview>('/api/overview'),
  workspace: () => get<{ folders: FolderView[]; ungrouped: ProjectCard[] }>('/api/workspace'),
  projects: () => get<{ projects: ProjectCard[] }>('/api/projects').then((r) => r.projects),
  /** How many projects the person can open (the count beside Projects in the side navigation): one-row page, background, reused for 30 s. */
  projectCount: () => get<{ total?: number; projects: unknown[] }>('/api/projects?limit=1', { background: true, ttl: 30_000 }).then((r) => r.total ?? r.projects.length),
  createFolder: (name: string) => post<{ name: string; key: string }>('/api/folders', { name }),
  renameFolder: (key: string, name: string) => patch<{ name: string }>(`/api/folders/${encodeURIComponent(key)}`, { name }),
  deleteFolder: (key: string, withProjects = false) => del<{ removedProjects: number }>(`/api/folders/${encodeURIComponent(key)}?withProjects=${withProjects ? 1 : 0}`),
  folderAccess: (key: string) => get<{ name: string; grants: Array<{ userId: string; username: string; fullName: string; role: string }> }>(`/api/folders/${encodeURIComponent(key)}/access`),
  setFolderAccess: (key: string, grants: Array<{ userId: string; role: string }>) => put(`/api/folders/${encodeURIComponent(key)}/access`, { grants }),
  formats: () => get<{ formats: FormatInfo[] }>('/api/formats').then((r) => r.formats),
  detectPackage: (file: File) => { const fd = new FormData(); fd.append('file', file); return request<PackageDetection>('POST', '/api/projects/import/detect', fd); },
  createProject: (b: { name: string; folder?: string; type?: string; pipeline?: string; templateRef?: string; profile?: string; format?: string; domain?: string; manualType?: string; s1000d?: import('./s1000d').NewProjectConfig }) => post<{ project: ProjectCard }>('/api/projects', b).then((r) => r.project),
  createSample: (folder?: string) => post<{ project: ProjectCard }>('/api/projects/sample', { folder }).then((r) => r.project),
  createJssSample: (folder?: string, domain: 'land' | 'naval' = 'land') => post<{ project: ProjectCard }>('/api/projects/sample-jss', { folder, domain }).then((r) => r.project),
  createJsgSample: (folder?: string, kind: 'uhb' | 'ispl' = 'uhb') => post<{ project: ProjectCard }>('/api/projects/sample-jsg', { folder, kind }).then((r) => r.project),
  copyProject: (id: string, b: { name?: string; folder?: string }) => post<{ project: ProjectCard }>(`/api/projects/${id}/copy`, b).then((r) => r.project),
  updateProject: (id: string, b: { name?: string; folder?: string; pipeline?: string; templateRef?: string; autoAddToPublication?: boolean; sideText?: { enabled?: boolean; publisher?: string; draftNote?: boolean }; headerLogo?: boolean }) => patch<{ project: ProjectCard }>(`/api/projects/${id}`, b).then((r) => r.project),
  deleteProject: (id: string, confirmName: string) => del(`/api/projects/${id}?confirm=${encodeURIComponent(confirmName)}`),
  open: (id: string) => post(`/api/projects/${id}/open`),
  summary: (id: string) => get<Summary>(`/api/projects/${id}/summary`),
  members: (id: string) => get<{ members: Array<{ userId: string; username: string; fullName: string; role: ProjectRole; disabled: boolean }>; invitations: Array<{ id: string; username: string; fullName: string; role: ProjectRole }>; yourRole: ProjectRole }>(`/api/projects/${id}/members`),
  revokeInvite: (id: string, invId: string) => del(`/api/projects/${id}/invitations/${invId}`),
  setMemberRole: (id: string, userId: string, role: ProjectRole) => patch(`/api/projects/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => del(`/api/projects/${id}/members/${userId}`),
  searchUsers: (q: string, role?: GlobalRole) => get<{ users: Array<{ username: string; fullName: string; role: GlobalRole }> }>(`/api/users/search?q=${encodeURIComponent(q)}${role ? `&role=${role}` : ''}`).then((r) => r.users),
  invitations: () => get<{ invitations: Array<{ id: string; projectId: string; projectName: string; role: ProjectRole; invitedBy: string | null; createdAt: string }> }>('/api/invitations').then((r) => r.invitations),
  acceptInvitation: (id: string) => post(`/api/invitations/${id}/accept`),
  declineInvitation: (id: string) => post(`/api/invitations/${id}/decline`),
};

// ── Project content ───────────────────────────────────────────────────────

/** WP-14: a job of a project as GET /api/projects/:id/jobs lists it (backend/src/services/jobs JobView) */
export interface JobView {
  id: string; kind: string; projectId: string | null; state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | string; createdAt: string; startedAt: string | null; finishedAt: string | null;
  actor: string | null; position?: number; error?: { message: string; code?: string; status?: number } | null; cached?: boolean;
}

const P = (id: string) => `/api/projects/${id}`;

export const IMPORT_MAX_FILES = 1000;

export const contentApi = {
  dms: (id: string) => get<{ dms: DmSummary[] }>(`${P(id)}/dms`).then((r) => r.dms),
  readDm: (id: string, file: string) => get<{ file: string; xml: string; hash: string; modified: string }>(`${P(id)}/dms/${encodeURIComponent(file)}`),
  saveDm: (id: string, file: string, xml: string, baseHash?: string) => put<{ file: string; hash: string; modified: string; changed: boolean }>(`${P(id)}/dms/${encodeURIComponent(file)}`, { xml, baseHash }),
  createDm: (id: string, file: string, xml: string) => post<{ file: string; hash: string; modified: string }>(`${P(id)}/dms`, { file, xml }),
  deleteDm: (id: string, file: string) => del(`${P(id)}/dms/${encodeURIComponent(file)}`),
  lockDm: (id: string, file: string, lock: boolean) => post(`${P(id)}/dms/${encodeURIComponent(file)}/${lock ? 'lock' : 'unlock'}`),
  history: (id: string, file: string) => get<{ revisions: Array<{ id: number; reason: string; at: string; by: string | null; size: number }> }>(`${P(id)}/dms/${encodeURIComponent(file)}/history`).then((r) => r.revisions),
  /** One request takes at most IMPORT_MAX_FILES data modules (the server says so too). `skipChecks` = import without the enterprise check. */
  importDms: (id: string, files: File[], overwrite = false, skipChecks = false, otherModel?: 'keep' | 'recode') => {
    const fd = new FormData(); files.forEach((f) => fd.append('files', f)); if (overwrite) fd.append('overwrite', '1'); if (skipChecks) fd.append('skipChecks', '1'); if (otherModel) fd.append('otherModel', otherModel);
    return request<{ imported: string[]; withProblems?: Array<{ file: string; problem: string }> }>('POST', `${P(id)}/dms-import`, fd);
  },
  media: (id: string) => get<{ media: Array<{ name: string; size: number; dir: 'csdb' | 'Media' }> }>(`${P(id)}/media`).then((r) => r.media),
  mediaUrl: (id: string, name: string) => `${P(id)}/media/${encodeURIComponent(name)}`,
  uploadMedia: (id: string, file: File, dir: 'csdb' | 'Media' = 'Media') => { const fd = new FormData(); fd.append('dir', dir); fd.append('file', file); return request<{ name: string; path: string }>('POST', `${P(id)}/media`, fd); },

  explore: (id: string) => get<Explore>(`${P(id)}/explore`),
  pmc: (id: string) => get<{ meta: any; entries: any[]; warnings: string[]; counts: { folders: number; dms: number; total: number }; pool: DmSummary[]; hash: string | null }>(`${P(id)}/pmc`),
  // WP-11: every save names the version it was made from (baseHash); the server refuses one that names none (428) or an older one (409)
  savePmc: (id: string, body: { meta: unknown; entries: unknown[]; baseHash: string }, allowEmpty = false) => put<{ counts: Explore['counts']; backup: string; hash: string }>(`${P(id)}/pmc${allowEmpty ? '?allowEmpty=1' : ''}`, body),

  validation: (id: string) => get<{ run: ValidationRun | null; schemaIssues: string[]; issue?: string }>(`${P(id)}/validation`),
  /** Fix the S1000D issue the project's checks use ('auto' = each module's own). Applies to the page AND the build / release checks. */
  missingBrex: (id: string) => get<{ missing: string[] }>(`${P(id)}/brex/missing`, { background: true }),
  createBrex: (id: string) => post<{ created: string[]; notes: string[] }>(`${P(id)}/brex/create`, {}),
  setValidationIssue: (id: string, issue: string) => put<{ issue: string }>(`${P(id)}/validation/issue`, { issue }),
  validate: (id: string, o: { issue?: string; brex?: boolean }) => post<{ run: ValidationRun }>(`${P(id)}/validation`, o).then((r) => r.run),

  release: (id: string) => get<ReleaseOverview>(`${P(id)}/release`),
  requestRelease: (id: string, scheduledAt: string | undefined, note: string) => post(`${P(id)}/release`, { ...(scheduledAt ? { scheduledAt } : {}), note }),
  sendBack: (id: string, relId: string, comment: string) => post(`${P(id)}/release/${relId}/changes`, { comment }),
  addComment: (id: string, body: string, dmFile?: string, anchor?: ReviewAnchor) => post<{ id: number }>(`${P(id)}/review/comments`, { body, ...(dmFile ? { dmFile } : {}), ...(anchor ? { anchor } : {}) }),
  resolveComment: (id: string, commentId: number, resolved: boolean) => post(`${P(id)}/review/comments/${commentId}/resolve`, { resolved }),
  downloadUrl: (id: string) => `${P(id)}/publish/download`,
  withdrawRelease: (id: string, relId: string) => del(`${P(id)}/release/${relId}`),
  decideRelease: (id: string, relId: string, approve: boolean) => post(`${P(id)}/release/${relId}/${approve ? 'approve' : 'reject'}`),
  saveWatermark: (id: string, w: { enabled: boolean; text: string; style: string }) => put<{ watermark: typeof w }>(`${P(id)}/watermark`, w),

  build: (id: string, compression?: number, allowRuleBreaks = false) => post<{ totalMs?: number; releaseLabel: string; pdfUrl: string; ruleBreaks: string[] }>(`${P(id)}/publish`, { ...(compression === undefined ? {} : { compression }), ...(allowRuleBreaks ? { allowRuleBreaks: true } : {}) }),
  previewDmPdf: async (id: string, file: string): Promise<Blob> => {
    const res = await request<Response>('POST', `${P(id)}/publish/preview/${encodeURIComponent(file)}`, {}, { raw: true });
    return res.blob();
  },
  /** Whether the PDF renderer is warm (the project status bar: "Renderer ready"). */
  rendererStatus: (id: string) => get<{ warm: boolean }>(`${P(id)}/publish/status`, { background: true, ttl: 30_000 }),
  pdfUrl: (id: string, download = false) => `${P(id)}/publish/pdf${download ? '?download=1' : ''}`,
  /** WP-14: the project's jobs, newest first (the Publication page lists its builds from them) */
  jobs: (id: string, limit = 50) => get<{ jobs: JobView[] }>(`${P(id)}/jobs?limit=${limit}`).then((r) => r.jobs),

  settings: (id: string) => get<any>(`${P(id)}/settings`),
  saveSettings: (id: string, body: { house?: unknown; project?: unknown; baseHash: string }) => put<{ ok: boolean; templateRef: string; version: string }>(`${P(id)}/settings`, body),
};

// ── Team: accounts, assignment, oversight ─────────────────────────────────

export interface ActivityReport {
  since: string; days: number;
  totals: { projects: number; people: number; edits: number; builds: number; pendingApprovals: number };
  projects: Array<{ id: string; name: string; folder: string; dataModules: number; edits: number; builds: number; validations: number; lastActivityAt: string | null; pendingRelease: boolean;
    members: Array<{ userId: string; username: string; fullName: string; role: ProjectRole; globalRole: GlobalRole; edits: number; lastActiveAt: string | null }> }>;
  people: Array<{ userId: string; username: string; fullName: string; globalRole: GlobalRole; edits: number; builds: number; lastActiveAt: string | null; projects: Array<{ id: string; name: string; role: ProjectRole }> }>;
  feed: Array<{ id: number; at: string; actor: string | null; action: string; projectId: string | null; projectName: string | null; meta: unknown }>;
}

export type ReleaseStatus = 'released' | 'pending' | 'unreleased';
export interface Oversight {
  counts: { projects: number; released: number; pending: number; unreleased: number; people: number; managers: number; authors: number; edits: number; days: number };
  projects: Array<{ id: string; name: string; folder: string; status: ReleaseStatus; releaseNumber: number | null; changedSinceRelease: boolean; dataModules: number; lastActivityAt: string | null; owners: string[]; members: number;
    format?: string; domain?: string | null; manualType?: string | null; validation?: { error: number; warn: number; ranAt: string } | null }>;
  team: Array<{ userId: string; username: string; fullName: string; role: GlobalRole; disabled: boolean; createdAt: string; createdByYou: boolean; edits: number; builds: number; lastActiveAt: string | null; projects: Array<{ id: string; name: string; role: ProjectRole }> }>;
  feed: Array<ActivityReport['feed'][number] & { actorName?: string | null }>;
}

export interface Notice { id: number; kind: string; title: string; body: string | null; projectId: string | null; at: string; read: boolean }
export interface Inbox { unread: number; items: Notice[] }
export const notifyApi = {
  list: () => get<Inbox>('/api/notifications'),
  unread: (o?: { ttl?: number }) => get<{ unread: number }>('/api/notifications/unread-count', { background: true, ttl: o?.ttl }).then((r) => r.unread),
  markRead: (ids?: number[]) => post<Inbox>('/api/notifications/read', ids ? { ids } : {}),
};
export const BACKUP_URL = '/api/backup';

// WP-22 (UX-008, FE-015): the one problems model of a project and the team's "reviewed" marks (backend services/problems.ts)
export type ProblemState = 'open' | 'reviewed' | 'waived';
export interface ReviewMark { key: string; by: string; byName: string | null; at: string; note?: string }
export interface ProblemRow {
  key: string; id: string; source: ValidationIssue['source'] | 'applic'; severity: ValidationIssue['sev']; file: string; line: number; rule: string; message: string; detail: string;
  location: string; state: ProblemState; reviewedBy: string | null; reviewedAt: string | null; reviewNote?: string | null; waivedBy: string | null;
}
export const problemsApi = {
  list: (id: string) => get<{ ranAt: string | null; problems: ProblemRow[]; summary: Record<ProblemState | 'error' | 'warn' | 'info', number> }>(`${P(id)}/problems`),
  marks: (id: string) => get<{ marks: ReviewMark[] }>(`${P(id)}/problems/reviewed`).then((r) => r.marks),
  setReviewed: (id: string, keys: string[], reviewed: boolean, note?: string) => put<{ marks: ReviewMark[] }>(`${P(id)}/problems/reviewed`, note ? { keys, reviewed, note } : { keys, reviewed }).then((r) => r.marks),
};

export const graphicsApi = {
  all: () => get<{ projects: Array<{ id: string; name: string; role: ProjectRole; graphics: Graphic[] }> }>('/api/graphics').then((r) => r.projects),
  list: (id: string) => get<{ graphics: Graphic[] }>(`${P(id)}/graphics`).then((r) => r.graphics),
  upload: (id: string, files: File[], kind?: GraphicKind) => {
    const fd = new FormData(); files.forEach((f) => fd.append('files', f)); if (kind) fd.append('kind', kind);
    return request<{ added: string[]; graphics: Graphic[] }>('POST', `${P(id)}/graphics`, fd);
  },
  remove: (id: string, name: string, force = false) => del<{ graphics: Graphic[] }>(`${P(id)}/graphics/${encodeURIComponent(name)}${force ? '?force=1' : ''}`),
  url: (id: string, name: string) => `${P(id)}/media/${encodeURIComponent(name)}`,
};

export const cirApi = {
  /** The modules, and the id of the shared workspace that opens in the editor. */
  list: () => get<{ modules: CirModule[]; workspace: string }>('/api/cir'),
  read: (id: string) => get<{ file: string; xml: string }>(`/api/cir/${encodeURIComponent(id)}`),
  /** WP-11: replacing a module already in the repository names its current version (`baseHashes`: file name -> hash); without it the answer is CIR_EXISTS listing them. */
  add: (files: File[], note: string, baseHashes: Record<string, string> = {}) => { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); fd.append('note', note); if (Object.keys(baseHashes).length) fd.append('baseHashes', JSON.stringify(baseHashes)); return request<{ added: CirModule[] }>('POST', '/api/cir', fd); },
  remove: (id: string) => del(`/api/cir/${encodeURIComponent(id)}`),
  copy: (id: string, projectId: string) => post<{ file: string }>(`/api/cir/${encodeURIComponent(id)}/copy`, { projectId }),
};

export const configApi = {
  list: (c: string) => get<{ spec: ConfigSpec; items: ConfigItem[] }>(`/api/admin/config/${c}`),
  create: (c: string, b: Record<string, unknown>) => post<{ item: ConfigItem }>(`/api/admin/config/${c}`, b).then((r) => r.item),
  update: (c: string, id: string, b: Record<string, unknown>) => put<{ item: ConfigItem }>(`/api/admin/config/${c}/${id}`, b).then((r) => r.item),
  remove: (c: string, id: string) => del(`/api/admin/config/${c}/${id}`),
  roles: () => get<{ roles: Array<{ name: string; description: string; system: boolean }>; projectRoles: Array<{ name: string; description: string }>; capabilities?: Array<{ capability: string; minRole: ProjectRole; readable: boolean }> }>('/api/admin/roles'),
};

export interface ReferenceLists {
  languages: Array<{ code: string; name: string }>; countries: Array<{ code: string; name: string }>;
  dmTypes: Array<{ schema: string; name: string; infoCode?: string }>; security: Array<{ code: string; name: string }>;
  rpc: Array<{ cage: string; name: string }>; originators: Array<{ cage: string; name: string }>;
}
export const referenceApi = { get: () => get<ReferenceLists>('/api/reference') };

export const platformApi = {
  settings: () => get<{ settings: AppSettings }>('/api/app-settings').then((r) => r.settings),
  saveSettings: (b: Partial<AppSettings>) => put<{ settings: AppSettings }>('/api/admin/app-settings', b).then((r) => r.settings),
  reindex: () => post<{ projects: number }>('/api/admin/maintenance/reindex'),
  checkSchemas: () => post<{ installed: string[]; wizard: string[]; missing: string[] }>('/api/admin/maintenance/check-schemas'),
  clearPreviews: () => post<{ removed: number }>('/api/admin/maintenance/clear-previews'),
  rebuildPdfs: () => post<{ queued: number }>('/api/admin/maintenance/rebuild-pdfs'),
  AUDIT_CSV: '/api/admin/maintenance/audit.csv',
  securityPolicy: () => get<{ policy: SecurityPolicy; defaults: SecurityPolicy }>('/api/admin/security-policy'),
  saveSecurityPolicy: (b: Partial<SecurityPolicy>) => put<{ policy: SecurityPolicy }>('/api/admin/security-policy', b).then((r) => r.policy),
  health: () => get<{ audit: { failures: number; last: { at: string; action: string; error: string } | null; lastVerification?: { at: string; ok: boolean; summary: string } | null } | null;
    /** uptime and the data disk (UI redesign screen 6: the Service tile and the Storage card); null on an older server */
    system?: { uptimeSeconds: number; startedAt: string; disk: { totalBytes: number; freeBytes: number } | null } | null }>('/api/admin/health'),
};

/** WP-29: the audit viewer's and the export's filters (backend/src/routes/audit.ts auditFilterOf). */
export interface AuditQuery { action?: string; actor?: string; project?: string; from?: string; to?: string }
/** The query string of the filters that are set ("" when none), values encoded, in a fixed order. */
export function auditQueryString(q: AuditQuery): string {
  const parts = (['action', 'actor', 'project', 'from', 'to'] as const)
    .filter((k) => (q[k] ?? '').trim() !== '')
    // a date alone as "to" means up to the end of that day (a date input gives 2026-11-27, which would otherwise mean its first instant)
    .map((k) => { const v = (q[k] as string).trim(); return `${k}=${encodeURIComponent(k === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? `${v}T23:59:59.999Z` : v)}`; });
  return parts.join('&');
}
export interface AuditVerifyReport {
  ok: boolean; at: string; keyId: string; chained: number; beforeChain: number; summary: string; problemCount: number;
  head: { seq: number; hash: string };
  anchor: { seq: number; archive: string | null } | null;
  checkpoints: { checked: number; newest: { at: string; seq: number } | null };
  problems: Array<{ kind: string; id?: number; seq?: number; message: string }>;
}
export const auditApi = {
  /** A GET (an auditor, who may not POST, verifies too); `fresh`: every press walks the chain again. */
  verify: () => get<{ report: AuditVerifyReport }>('/api/admin/audit/verify', { fresh: true }).then((r) => r.report),
  checkpoint: () => post<{ checkpoint: { id: number; at: string; seq: number; row_hash: string } }>('/api/admin/audit/checkpoint').then((r) => r.checkpoint),
  /** The streamed export of every row matching the filters (a download link; the export is itself audited). */
  exportUrl: (format: 'csv' | 'jsonl', q: AuditQuery) => { const s = auditQueryString(q); return `/api/admin/audit/export?format=${format}${s ? `&${s}` : ''}`; },
};
/** WP-12: platform backups (backend/src/routes/backups.ts, services/dataProtection.ts). Administrators only. */
export interface BackupItem { name: string; bytes: number; createdAt: string; kind: 'manual' | 'scheduled' | 'pre-update' | 'cli' }
interface BackupJob { at: string; ok: boolean; name?: string; message?: string }
export interface BackupStatus {
  dir: string; intervalHours: number; keep: { daily: number; weekly: number; monthly: number }; restoreTestDays: number; running: boolean;
  backups: BackupItem[]; latest: (BackupItem & { ageDays: number }) | null; stale: boolean;
  state: { lastBackup?: BackupJob; lastScheduledAt?: string; lastRestoreTest?: BackupJob & { files?: number; rows?: number }; lastRetention?: BackupJob & { counts?: Record<string, number> } };
  schema: { applied: number; known: number; latest: string | null };
}
export interface RestoreReport { target: string; createdAt: string; version: string; files: number; bytes: number; tables: number; rows: number; schema: { applied: number; pendingHere: string[] } }
const B = (name: string) => `/api/admin/backups/${encodeURIComponent(name)}`;
export const backupApi = {
  status: () => get<BackupStatus>('/api/admin/backups'),
  create: () => post<{ name: string; bytes: number; files: number; tables: number; createdAt: string }>('/api/admin/backups'),
  verify: (name: string) => post<{ ok: boolean; report: RestoreReport }>(`${B(name)}/verify`),
  copy: (name: string, folder: string) => post<{ file: string; sha256: string }>(`${B(name)}/copy`, { folder }),
  restore: (name: string, target: string) => post<{ report: RestoreReport; next: string[] }>(`${B(name)}/restore`, { target }),
  remove: (name: string) => del<{ ok: boolean }>(B(name)),
  downloadUrl: (name: string) => `${B(name)}/download`,
};

/** Account and session rules (backend/src/core/auth/securityPolicy.js). */
export interface SecurityPolicy { idleMinutes: number; absoluteHours: number; singleSession: boolean; separationOfDuties: boolean; passwordMinLength: number }

export const teamApi = {
  createUser: (b: { username: string; fullName: string; role: GlobalRole }) => post<{ user: User; tempPassword: string }>('/api/team/users', b),
  users: () => get<{ users: User[] }>('/api/team/users').then((r) => r.users),
  assign: (projectId: string, username: string, role: ProjectRole) => post<{ ok: boolean }>(`/api/projects/${projectId}/assign`, { username, role }),
  activity: (days = 7) => get<ActivityReport>(`/api/activity?days=${days}`),
  projectActivity: (projectId: string, days = 7) => get<ActivityReport>(`/api/projects/${projectId}/activity?days=${days}`),
  usernameFor: (name: string) => get<{ username: string }>(`/api/team/username-suggestion?name=${encodeURIComponent(name)}`).then((r) => r.username),
  oversight: () => get<Oversight>('/api/oversight'),
  approvals: () => get<{ approvals: Array<{ id: string; projectId: string; projectName: string; scheduledAt: string; requestedAt: string; note: string | null; requestedBy: string | null }> }>('/api/approvals').then((r) => r.approvals),
};

// ── Administration ────────────────────────────────────────────────────────

export const adminApi = {
  users: () => get<{ users: User[] }>('/api/admin/users').then((r) => r.users),
  createUser: (b: { username: string; fullName: string; role: GlobalRole }) => post<{ user: User; tempPassword: string }>('/api/admin/users', b),
  updateUser: (id: string, b: { role?: string; fullName?: string; auditor?: boolean; authSource?: 'local' | 'directory' }) => patch<{ user: User }>(`/api/admin/users/${id}`, b),
  disable: (id: string) => post(`/api/admin/users/${id}/disable`),
  enable: (id: string) => post(`/api/admin/users/${id}/enable`),
  reset: (id: string) => post<{ tempPassword: string }>(`/api/admin/users/${id}/reset`),
  resets: () => get<{ requests: Array<{ id: string; username: string; fullName: string; requestedAt: string }> }>('/api/admin/resets').then((r) => r.requests ?? []),
  approveReset: (id: string) => post<{ tempPassword: string }>(`/api/admin/resets/${id}/approve`),
  rejectReset: (id: string) => post(`/api/admin/resets/${id}/reject`),
  releases: () => get<{ pending: Array<{ id: string; projectId: string; projectName: string; scheduledAt: string; requestedAt: string; note: string | null; requestedBy: string | null }> }>('/api/admin/releases').then((r) => r.pending),
  approveRelease: (id: string) => post(`/api/admin/releases/${id}/approve`),
  rejectRelease: (id: string) => post(`/api/admin/releases/${id}/reject`),
  sessions: () => get<{ sessions: Array<{ id: string; username: string; fullName: string; role: string; createdAt: string; lastSeenAt: string | null; ip: string | null; userAgent: string | null }> }>('/api/admin/sessions').then((r) => r.sessions),
  revokeSession: (id: string) => post(`/api/admin/sessions/${id}/revoke`),
  /** WP-29: `filter` is an action prefix (as before) or the full set of filters. */
  audit: (limit = 200, filter?: string | AuditQuery) => {
    const s = auditQueryString(typeof filter === 'string' ? { action: filter } : (filter ?? {}));
    return get<{ entries: Array<{ id: number; at: string; actor: string | null; action: string; targetType: string | null; projectId: string | null; ip: string | null; meta: unknown; seq?: number | null }> }>(`/api/admin/audit?limit=${limit}${s ? `&${s}` : ''}`).then((r) => r.entries);
  },
};

// ── Access: directory sign-on, groups, a project's group grants and capability rules (WP-27, backend/src/routes/access.ts) ──
export interface AccessGroup { id: string; name: string; description: string; members?: number }
export interface GroupMember { user_id: string; username: string; full_name: string; source: 'local' | 'directory'; disabled_at: string | null }
export interface DirectoryMapping { id: string; group_dn: string; global_role: string | null; group_id: string | null; group_name?: string | null }
export interface DirectoryStatus {
  configured: boolean; mode: 'local' | 'server'; directoryUsers: number; mappings: DirectoryMapping[];
  settings: null | { urls: string[]; baseDn: string; groupBaseDn: string; bindDn: string; loginAttribute: string; userObjectClass: string; nestedGroups: boolean; caFile: string | null; caFileReadable: boolean | null; bindPasswordFileReadable: boolean; syncHours: number; timeoutMs: number };
  lastSync: null | { at: string; checked: number; offboarded: number; updated: number; failed?: string; by: string | null };
}
export interface ProjectAccess {
  groupGrants: Array<{ groupId: string; name: string; role: ProjectRole; grantedAt: string }>;
  rules: Array<{ id: string; subjectType: 'user' | 'group'; subjectId: string; subject: string; capability: string; effect: 'allow' | 'deny'; createdAt: string }>;
  groups: Array<{ id: string; name: string; members: number }>;
  capabilities: Array<{ capability: string; minRole: ProjectRole }>;
  yourRole?: ProjectRole;
}
const GR = (id: string): string => `/api/admin/groups/${encodeURIComponent(id)}`;
const PA = (pid: string): string => `/api/projects/${encodeURIComponent(pid)}/access`;
export const accessApi = {
  directory: () => get<DirectoryStatus>('/api/admin/directory'),
  testDirectory: (username?: string) => post<{ ok: boolean; url: string; ms: number; found: null | { dn: string | null; groups?: string[]; ambiguous?: boolean } }>('/api/admin/directory/test', { username }),
  syncDirectory: () => post<{ checked: number; offboarded: number; updated: number; failed?: string }>('/api/admin/directory/sync'),
  addMapping: (b: { groupDn: string; globalRole?: string | null; groupId?: string | null }) => post<{ mapping: DirectoryMapping }>('/api/admin/directory/mappings', b),
  removeMapping: (id: string) => del(`/api/admin/directory/mappings/${encodeURIComponent(id)}`),
  groups: () => get<{ groups: AccessGroup[] }>('/api/admin/groups').then((r) => r.groups),
  createGroup: (b: { name: string; description?: string }) => post<{ group: AccessGroup }>('/api/admin/groups', b),
  updateGroup: (id: string, b: { name?: string; description?: string }) => patch<{ group: AccessGroup }>(GR(id), b),
  removeGroup: (id: string) => del(GR(id)),
  members: (id: string) => get<{ members: GroupMember[] }>(`${GR(id)}/members`).then((r) => r.members),
  addMember: (id: string, username: string) => post<{ members: GroupMember[] }>(`${GR(id)}/members`, { username }),
  removeMember: (id: string, userId: string) => del(`${GR(id)}/members/${encodeURIComponent(userId)}`),
  project: (pid: string) => get<ProjectAccess>(PA(pid)),
  grantGroup: (pid: string, groupId: string, role: ProjectRole) => put<ProjectAccess>(`${PA(pid)}/groups/${encodeURIComponent(groupId)}`, { role }),
  revokeGroup: (pid: string, groupId: string) => del<ProjectAccess>(`${PA(pid)}/groups/${encodeURIComponent(groupId)}`),
  addRule: (pid: string, b: { subjectType: 'user' | 'group'; subject: string; capability: string; effect: 'allow' | 'deny' }) => post<ProjectAccess>(`${PA(pid)}/rules`, b),
  removeRule: (pid: string, ruleId: string) => del<ProjectAccess>(`${PA(pid)}/rules/${encodeURIComponent(ruleId)}`),
};
export * from './s1000d';
