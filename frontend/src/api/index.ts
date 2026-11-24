// Typed calls to the platform API. Shapes mirror backend/src/routes and the
// JSS auth routes in backend/src/core/auth/routes.js.

import { get, post, put, patch, del, request } from './client';

// ── Types ─────────────────────────────────────────────────────────────────

export type ProjectRole = 'viewer' | 'reviewer' | 'editor' | 'manager' | 'owner';
export type GlobalRole = 'admin' | 'project_manager' | 'author';
export interface User { id: string; username: string; fullName: string; role: GlobalRole; createdBy?: string | null; disabled?: boolean; onboardingPending?: boolean; mustChangePassword?: boolean; createdAt?: string }
export interface Gates { onboarding: boolean; mustChangePassword: boolean }
export interface AdminQueues { approvals: number; changes: number; folderRequests: number; resets: number; ownerless: number; releases: number }

export interface FormatInfo { id: 's1000d' | 'jss' | 'jsg'; label: string; description: string; ready: boolean; domains: Array<{ id: string; label: string; manualTypes: Array<{ id: string; label: string; ready: boolean; notReady?: string }> }> }
export interface PackageDetection { token: string; name: string; format: 's1000d' | 'unknown'; dataModules: number; publicationModules: number; graphics: number; other: number; entries: number }
export interface ProjectCard {
  id: string; name: string; type: string; pipeline: 's1000dtofo' | 's1000dtojss'; templateRef: string; folder: string; status: string;
  format: 's1000d' | 'jss' | 'jsg'; domain: string | null; manualType: string | null; authoring: 'jss-xml' | null; jssDocType: string | null; autoAddToPublication: boolean; sideText: { enabled: boolean; publisher: string; draftNote: boolean }; headerLogo: boolean;
  role: ProjectRole; accessVia: 'project' | 'folder' | 'admin'; dmCount: number; hasPdf: boolean;
  createdAt: string; updatedAt: string; lastOpened: string | null; owners: string[];
}
export interface FolderView { key: string; name: string; owner: { id: string; username: string; fullName: string } | null; canManage: boolean; accessRole: string | null; projects: ProjectCard[] }
export interface Overview {
  counts: { projects: number; folders: number; dataModules: number; published: number; invitations: number };
  recent: ProjectCard[];
  activity: Array<{ id: number; at: string; actor: string | null; action: string; projectId: string | null; projectName: string | null; meta: unknown }>;
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
  watermark: { enabled: boolean; text: string; style: string }; watermarkStyles: string[]; canSubmit: boolean; canApprove: boolean;
  review: Review;
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
export interface AppSettings { appName: string; organisation: string; accent: string; compact: boolean; theme: 'system' | 'light' | 'dark' }

export interface Summary {
  project: ProjectCard; role: ProjectRole;
  dataModules: { total: number; withIssues: number | null };
  publication: { totals: Explore['totals']; chapters: number; title: string } | null;
  validation: { ranAt: string; error: number; warn: number; info: number } | null;
  release: { released: boolean; stale: boolean; number: number | null; pending: boolean; scheduledAt: string | null } | null;
  build: { builtAt: string; size: number } | null;
  members: number;
}

// ── Auth ──────────────────────────────────────────────────────────────────

export const authApi = {
  setupRequired: () => get<{ setupRequired: boolean }>('/api/auth/setup', { quiet401: true }),
  setup: (b: { username: string; password: string; fullName: string }) => post<{ user: User; gates: Gates }>('/api/auth/setup', b, { quiet401: true }),
  login: (username: string, password: string) => post<{ user: User; gates: Gates }>('/api/auth/login', { username, password }, { quiet401: true }),
  logout: () => post('/api/auth/logout'),
  me: () => get<{ user: User; gates: Gates; pendingInvitations: number; adminQueues?: AdminQueues }>('/api/auth/me', { quiet401: true }),
  onboarding: (b: { username: string; password: string }) => post<{ user: User }>('/api/auth/onboarding', b),
  changePassword: (currentPassword: string, newPassword: string) => post('/api/auth/change-password', { currentPassword, newPassword }),
  forgot: (username: string) => post('/api/auth/forgot', { username }, { quiet401: true }),
};

// ── Workspace / projects ──────────────────────────────────────────────────

export const workspaceApi = {
  overview: () => get<Overview>('/api/overview'),
  workspace: () => get<{ folders: FolderView[]; ungrouped: ProjectCard[] }>('/api/workspace'),
  projects: () => get<{ projects: ProjectCard[] }>('/api/projects').then((r) => r.projects),
  createFolder: (name: string) => post<{ name: string; key: string }>('/api/folders', { name }),
  renameFolder: (key: string, name: string) => patch<{ name: string }>(`/api/folders/${encodeURIComponent(key)}`, { name }),
  deleteFolder: (key: string, withProjects = false) => del<{ removedProjects: number }>(`/api/folders/${encodeURIComponent(key)}?withProjects=${withProjects ? 1 : 0}`),
  folderAccess: (key: string) => get<{ name: string; grants: Array<{ userId: string; username: string; fullName: string; role: string }> }>(`/api/folders/${encodeURIComponent(key)}/access`),
  setFolderAccess: (key: string, grants: Array<{ userId: string; role: string }>) => put(`/api/folders/${encodeURIComponent(key)}/access`, { grants }),
  documentTypes: () => get<{ types: { id: string; label: string; chapters: number }[] }>('/api/document-types').then((r) => r.types),
  formats: () => get<{ formats: FormatInfo[] }>('/api/formats').then((r) => r.formats),
  detectPackage: (file: File) => { const fd = new FormData(); fd.append('file', file); return request<PackageDetection>('POST', '/api/projects/import/detect', fd); },
  importProject: (b: { token: string; name: string; folder?: string; format: string; domain?: string; manualType?: string }) => post<{ project: ProjectCard; report: { counts: Record<string, number> } }>('/api/projects/import', b),
  createProject: (b: { name: string; folder?: string; type?: string; pipeline?: string; templateRef?: string; profile?: string; format?: string; domain?: string; manualType?: string; s1000d?: import('./s1000d').NewProjectConfig }) => post<{ project: ProjectCard }>('/api/projects', b).then((r) => r.project),
  createSample: (folder?: string) => post<{ project: ProjectCard }>('/api/projects/sample', { folder }).then((r) => r.project),
  createJsgSample: (folder?: string, kind: 'uhb' | 'ispl' = 'uhb') => post<{ project: ProjectCard }>('/api/projects/sample-jsg', { folder, kind }).then((r) => r.project),
  copyProject: (id: string, b: { name?: string; folder?: string }) => post<{ project: ProjectCard }>(`/api/projects/${id}/copy`, b).then((r) => r.project),
  updateProject: (id: string, b: { name?: string; folder?: string; pipeline?: string; autoAddToPublication?: boolean; sideText?: { enabled?: boolean; publisher?: string; draftNote?: boolean }; headerLogo?: boolean }) => patch<{ project: ProjectCard }>(`/api/projects/${id}`, b).then((r) => r.project),
  deleteProject: (id: string, confirmName: string) => del(`/api/projects/${id}?confirm=${encodeURIComponent(confirmName)}`),
  open: (id: string) => post(`/api/projects/${id}/open`),
  summary: (id: string) => get<Summary>(`/api/projects/${id}/summary`),
  members: (id: string) => get<{ members: Array<{ userId: string; username: string; fullName: string; role: ProjectRole; disabled: boolean }>; invitations: Array<{ id: string; username: string; fullName: string; role: ProjectRole }>; yourRole: ProjectRole }>(`/api/projects/${id}/members`),
  invite: (id: string, username: string, role: ProjectRole) => post(`/api/projects/${id}/invitations`, { username, role }),
  revokeInvite: (id: string, invId: string) => del(`/api/projects/${id}/invitations/${invId}`),
  setMemberRole: (id: string, userId: string, role: ProjectRole) => patch(`/api/projects/${id}/members/${userId}`, { role }),
  removeMember: (id: string, userId: string) => del(`/api/projects/${id}/members/${userId}`),
  searchUsers: (q: string, role?: GlobalRole) => get<{ users: Array<{ username: string; fullName: string; role: GlobalRole }> }>(`/api/users/search?q=${encodeURIComponent(q)}${role ? `&role=${role}` : ''}`).then((r) => r.users),
  invitations: () => get<{ invitations: Array<{ id: string; projectId: string; projectName: string; role: ProjectRole; invitedBy: string | null; createdAt: string }> }>('/api/invitations').then((r) => r.invitations),
  acceptInvitation: (id: string) => post(`/api/invitations/${id}/accept`),
  declineInvitation: (id: string) => post(`/api/invitations/${id}/decline`),
};

// ── Project content ───────────────────────────────────────────────────────

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
  revision: (id: string, file: string, rev: number) => get<{ xml: string }>(`${P(id)}/dms/${encodeURIComponent(file)}/history/${rev}`).then((r) => r.xml),
  /** One request takes at most IMPORT_MAX_FILES data modules (the server says so too). `skipChecks` = import without the enterprise check. */
  importDms: (id: string, files: File[], overwrite = false, skipChecks = false, otherModel?: 'keep' | 'recode') => {
    const fd = new FormData(); files.forEach((f) => fd.append('files', f)); if (overwrite) fd.append('overwrite', '1'); if (skipChecks) fd.append('skipChecks', '1'); if (otherModel) fd.append('otherModel', otherModel);
    return request<{ imported: string[]; withProblems?: Array<{ file: string; problem: string }> }>('POST', `${P(id)}/dms-import`, fd);
  },
  media: (id: string) => get<{ media: Array<{ name: string; size: number; dir: 'csdb' | 'Media' }> }>(`${P(id)}/media`).then((r) => r.media),
  mediaUrl: (id: string, name: string) => `${P(id)}/media/${encodeURIComponent(name)}`,
  uploadMedia: (id: string, file: File, dir: 'csdb' | 'Media' = 'Media') => { const fd = new FormData(); fd.append('dir', dir); fd.append('file', file); return request<{ name: string; path: string }>('POST', `${P(id)}/media`, fd); },

  explore: (id: string) => get<Explore>(`${P(id)}/explore`),
  pmc: (id: string) => get<{ meta: any; entries: any[]; warnings: string[]; counts: { folders: number; dms: number; total: number }; pool: DmSummary[] }>(`${P(id)}/pmc`),
  savePmc: (id: string, body: { meta: unknown; entries: unknown[] }, allowEmpty = false) => put<{ counts: Explore['counts']; backup: string }>(`${P(id)}/pmc${allowEmpty ? '?allowEmpty=1' : ''}`, body),

  validation: (id: string) => get<{ run: ValidationRun | null; schemaIssues: string[]; issue?: string }>(`${P(id)}/validation`),
  /** Fix the S1000D issue the project's checks use ('auto' = each module's own). Applies to the page AND the build / release checks. */
  missingBrex: (id: string) => get<{ missing: string[] }>(`${P(id)}/brex/missing`),
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
  pdfUrl: (id: string, download = false) => `${P(id)}/publish/pdf${download ? '?download=1' : ''}`,

  settings: (id: string) => get<any>(`${P(id)}/settings`),
  saveSettings: (id: string, body: { house?: unknown; project?: unknown }) => put(`${P(id)}/settings`, body),
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
  projects: Array<{ id: string; name: string; folder: string; status: ReleaseStatus; releaseNumber: number | null; changedSinceRelease: boolean; dataModules: number; lastActivityAt: string | null; owners: string[]; members: number }>;
  team: Array<{ userId: string; username: string; fullName: string; role: GlobalRole; disabled: boolean; createdAt: string; createdByYou: boolean; edits: number; builds: number; lastActiveAt: string | null; projects: Array<{ id: string; name: string; role: ProjectRole }> }>;
  feed: ActivityReport['feed'];
}

export interface Notice { id: number; kind: string; title: string; body: string | null; projectId: string | null; at: string; read: boolean }
export interface Inbox { unread: number; items: Notice[] }
export const notifyApi = {
  list: () => get<Inbox>('/api/notifications'),
  unread: () => get<{ unread: number }>('/api/notifications/unread-count').then((r) => r.unread),
  markRead: (ids?: number[]) => post<Inbox>('/api/notifications/read', ids ? { ids } : {}),
};
export const BACKUP_URL = '/api/backup';

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
  add: (files: File[], note: string) => { const fd = new FormData(); files.forEach((f) => fd.append('files', f)); fd.append('note', note); return request<{ added: CirModule[] }>('POST', '/api/cir', fd); },
  remove: (id: string) => del(`/api/cir/${encodeURIComponent(id)}`),
  copy: (id: string, projectId: string) => post<{ file: string }>(`/api/cir/${encodeURIComponent(id)}/copy`, { projectId }),
};

export const configApi = {
  collections: () => get<{ collections: Array<ConfigSpec & { count: number }> }>('/api/admin/config').then((r) => r.collections),
  list: (c: string) => get<{ spec: ConfigSpec; items: ConfigItem[] }>(`/api/admin/config/${c}`),
  create: (c: string, b: Record<string, unknown>) => post<{ item: ConfigItem }>(`/api/admin/config/${c}`, b).then((r) => r.item),
  update: (c: string, id: string, b: Record<string, unknown>) => put<{ item: ConfigItem }>(`/api/admin/config/${c}/${id}`, b).then((r) => r.item),
  remove: (c: string, id: string) => del(`/api/admin/config/${c}/${id}`),
  roles: () => get<{ roles: Array<{ name: string; description: string; system: boolean }>; projectRoles: Array<{ name: string; description: string }> }>('/api/admin/roles'),
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
};

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
  updateUser: (id: string, b: { role?: string; fullName?: string }) => patch<{ user: User }>(`/api/admin/users/${id}`, b),
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
  audit: (limit = 200, action?: string) => get<{ entries: Array<{ id: number; at: string; actor: string | null; action: string; targetType: string | null; projectId: string | null; ip: string | null; meta: unknown }> }>(`/api/admin/audit?limit=${limit}${action ? `&action=${encodeURIComponent(action)}` : ''}`).then((r) => r.entries),
};
export * from './s1000d';
