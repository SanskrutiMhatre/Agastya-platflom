// Client for the CSDB-object, package, lifecycle, extension, CIR-link and findings endpoints (Phase 17).
import { del, get, post, put, request } from './client';

export type ObjectKind = 'dml' | 'ddn' | 'comment' | 'update' | 'scorm' | 'imf';
export interface CsdbObject { file: string; kind: ObjectKind; prefix: string; control: string; issueNumber: string; inWork: string; language: string; title: string; schema: string; issue: string; size: number; modified: string }
export interface ImportItem { path: string; as: string; status: 'accepted' | 'unchanged' | 'skipped' | 'rejected'; message: string; schema?: string; xsdErrors?: number; xsdFirst?: string[]; action?: 'create' | 'replace' }
export interface ImportReport { source: string; startedAt: string; finishedAt: string; applied: boolean; counts: Record<ImportItem['status'], number>; items: ImportItem[]; notes: string[]; manifest: { present: boolean; checked: number; mismatches: string[] } }
export interface Finding { module: string; rule: string; severity: 'error' | 'warn' | 'info'; location: string; line: number; message: string; fix: string; source: string }
export interface Revision { file: string; issueNumber: string; inWork: string; issueType: string; modified: string; current: boolean; events: Array<{ action: string; reason: string | null; by: string; at: string }> }
export interface Suggestion { path: string; line: number; type: 'add' | 'modify' | 'delete'; element: string; excerpt: string }
export interface ExtProfile { id: string; name: string; namespace: string; description: string; enabled?: boolean; projects?: number; xsdName?: string }
export interface CirLink { file: string; cirFile: string; linkedIssue: string; cirIssue: string | null; state: string; linkedAt: string; approvedBy: string | null; approvedAt: string | null }
export interface CoverageRow { schema: string; name: string; category: string; filePrefix: string | null; root: Record<string, string | null>; xsd: Record<string, boolean>; authored: boolean }
export interface HtmlBuild { name: string; pages: number; assets: number; missing: string[]; zip: string; index: string; configured?: string; ruleBreaks?: string[]; warnings?: string[] }

const P = (id: string) => `/api/projects/${id}`;
export const csdbApi = {
  objects: (id: string) => get<{ objects: CsdbObject[] }>(`${P(id)}/objects`),
  readObject: (id: string, file: string) => get<{ file: string; xml: string }>(`${P(id)}/objects/${encodeURIComponent(file)}`),
  saveObject: (id: string, file: string, xml: string) => put<{ file: string }>(`${P(id)}/objects/${encodeURIComponent(file)}`, { xml }),
  deleteObject: (id: string, file: string) => del(`${P(id)}/objects/${encodeURIComponent(file)}`),
  newObject: (id: string, kind: 'comment' | 'update' | 'imf', params: Record<string, unknown>) => post<{ file: string }>(`${P(id)}/objects/new`, { kind, params, save: '1' }),
  generateDml: (id: string, body: { type: 'c' | 'p' | 's'; sender?: string; files?: string[] }) => post<{ file: string; entries: number }>(`${P(id)}/dml/generate`, { ...body, save: '1' }),
  objectHtmlUrl: (id: string, file: string) => `${P(id)}/objects/${encodeURIComponent(file)}/html`,
  assets: (id: string) => get<{ assets: Array<{ name: string; dir: string; size: number; cls: string; icn: string | null; sha256: string }>; findings: Array<{ code: string; severity: string; asset: string; message: string; fix: string; module?: string; location?: string }> }>(`${P(id)}/assets`),
  findings: (id: string, run = false) => get<{ ranAt: string | null; findings: Finding[]; counts: Record<string, number> }>(`${P(id)}/findings${run ? '?run=1' : ''}`),
  exportProjectUrl: (id: string) => `${P(id)}/packages/project`,
  importPackage: (id: string, file: File, opts: { overwrite?: boolean; partial?: boolean; skipChecks?: boolean; replacePm?: boolean }) => {
    const fd = new FormData(); fd.append('file', file); for (const [k, v] of Object.entries(opts)) if (v) fd.append(k, '1');
    return request<ImportReport>('POST', `${P(id)}/packages/import`, fd);
  },
  delivery: (id: string, body: Record<string, unknown>) => request<Response>('POST', `${P(id)}/packages/delivery`, body, { raw: true }),
  html: (id: string) => get<{ builds: Array<{ name: string; size: number; builtAt: string }> }>(`${P(id)}/publish/html`),
  buildHtml: (id: string, allowRuleBreaks = false) => post<HtmlBuild>(`${P(id)}/publish/html`, allowRuleBreaks ? { allowRuleBreaks: true } : {}),
  lifecycle: (id: string, file: string) => get<{ revisions: Revision[] }>(`${P(id)}/dms/${encodeURIComponent(file)}/lifecycle`),
  workingRevision: (id: string, file: string, reason?: string) => post<{ file: string }>(`${P(id)}/dms/${encodeURIComponent(file)}/working-revision`, { reason }),
  suggestions: (id: string, file: string) => get<{ against: string | null; suggestions: Suggestion[] }>(`${P(id)}/dms/${encodeURIComponent(file)}/change-suggestions`),
  applyMarks: (id: string, file: string, picks: Array<{ path: string; type: 'add' | 'modify' }>) => post(`${P(id)}/dms/${encodeURIComponent(file)}/change-marks`, { picks }),
  issue: (id: string, file: string, reason?: string) => post<{ file: string }>(`${P(id)}/dms/${encodeURIComponent(file)}/issue`, { reason }),
  obsolete: (id: string, file: string, reason: string) => post<{ file: string }>(`${P(id)}/dms/${encodeURIComponent(file)}/obsolete`, { reason }),
  reinstate: (id: string, file: string, reason: string, kind: 'status' | 'changed' | 'revised') => post<{ file: string; issueType: string }>(`${P(id)}/dms/${encodeURIComponent(file)}/reinstate`, { reason, kind }),
  supersede: (id: string, file: string, reason: string, by: string) => post<{ file: string }>(`${P(id)}/dms/${encodeURIComponent(file)}/supersede`, { reason, by }),
  cirLinks: (id: string) => get<{ links: CirLink[] }>(`${P(id)}/cir-links`),
  approveCir: (id: string, file: string, force = false) => post(`${P(id)}/cir-links/${encodeURIComponent(file)}/update`, { force }),
  detachCir: (id: string, file: string) => del(`${P(id)}/cir-links/${encodeURIComponent(file)}`),
  extensions: (id: string) => get<{ profiles: ExtProfile[] }>(`${P(id)}/extensions`),
  setExtension: (id: string, profileId: string, enabled: boolean) => put(`${P(id)}/extensions/${profileId}`, { enabled }),
  adminExtensions: () => get<{ profiles: ExtProfile[] }>('/api/admin/extensions'),
  registerExtension: (b: { name: string; namespace: string; description?: string; xsd: string; xsdName?: string }) => post<ExtProfile>('/api/admin/extensions', b),
  deleteExtension: (id: string) => del(`/api/admin/extensions/${id}`),
  coverage: () => get<{ rows: CoverageRow[] }>('/api/s1000d/coverage'),
};
