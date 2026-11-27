// S1000D reference configuration: catalogues, SNS, project configuration, applicability.
import { del, get, patch, post, put } from './client';

export type IssueKey = '4-2' | '5-0' | '6' | '7';
export type CodeKind = 'infoCode' | 'learnCode' | 'learnEventCode' | 'itemLocationCode';
export interface ModelCodePlan { from: string; to: string; applied: boolean; renamed: Array<{ from: string; to: string }>; filesChanged: number; codesRewritten: number; untouched: string[]; problems: string[]; backup?: string }
export const ISSUE_OPTIONS: Array<{ key: IssueKey; label: string }> = [{ key: '4-2', label: '4.2' }, { key: '5-0', label: '5.0' }, { key: '6', label: '6.0' }, { key: '7', label: '7.0' }];
export const issueLabel = (k: string | null | undefined): string => ISSUE_OPTIONS.find((i) => i.key === k)?.label ?? '—';
export const KIND_LABEL: Record<CodeKind, string> = { infoCode: 'Information codes', learnCode: 'Learn codes', learnEventCode: 'Learn event codes', itemLocationCode: 'Item location codes' };

export interface CodeRow { kind: CodeKind; issue: IssueKey; code: string; title: string; origin: 'brex' | 'custom'; sourceId: string | null; ruleId: string | null; sourceLabel: string | null; brexAccepts: boolean }
export interface CodeRange { pattern: string; title: string; ruleId: string | null }
export interface RefSource { id: string; kind: string; label: string; file: string | null; sha256: string | null; issue: string | null; limitation: string | null; loadedAt: string }
export interface DefaultEvidence { status: 'confirmed' | 'supported' | 'corrected' | 'multiple' | 'unresolved'; default: string | null; previousDefault?: string; note: string; refs: string[]; codes: string[] }
export interface Advice { schema: string; name: string; defaultCode: string; unresolved: string | null; recommended: string[]; evidence: DefaultEvidence | null; defaultInCatalogue: boolean }
export interface ImpactProject { id: string; name: string; selected: boolean; dmsUsing: number }
export interface Impact { code: string; projects: ImpactProject[]; dmsUsing: number; selectedIn: number }
export interface SnsNode { path: string; level: number; code: string; title: string; used?: number; children?: SnsNode[] }
export interface PresetSummary { id: string; name: string; source: string; limitation: string | null; readOnly: boolean; systems: number; entries: number; model: string | null }
export interface PresetNode { path: string; level: number; code: string; title: string; definition: string; note?: Record<string, unknown> }
export interface ImportReport { added: number; unchanged: number; conflicts: Array<{ path: string; existing: string; incoming: string }>; skipped: Array<{ path: string; reason: string }>; errors: Array<{ line: number | string; message: string }> }

export interface Enterprise { code: string; name: string }
export interface ProjectConfig {
  mic: string; issue: IssueKey | null; language: string; country: string; responsiblePartner: Enterprise; originator: Enterprise; security: string;
  brex: { mode: 'default' | 'project'; dmc: string | null }; codeMode: 'all' | 'selected'; snsEnforced: boolean; pmTemplate: string;
  applicability: { act: string | null; cct: string | null; pct: string | null }; origin: { by: string; notes: string[] };
}
export interface ProjectBundle {
  config: ProjectConfig; version: number; lock: { locked: boolean; fields: string[]; dmCount: number; explanation: string };
  issue: IssueKey; issueLabel: string; issueAssumed: boolean;
  dmTypes: Array<{ schema: string; name: string; infoCode?: string; enabled: boolean; advice?: Advice }>;
  codes: Record<CodeKind, Array<{ code: string; title: string; origin: string }>>; selected: Record<CodeKind, string[]>;
  sns: Array<{ path: string; level: number; code: string; title: string }>; dmCount: number;
}
/** What the New project wizard sends (s1000d). */
export interface NewProjectConfig {
  mic?: string; issue?: string; language?: string; country?: string; responsiblePartner?: Enterprise; originator?: Enterprise; security?: string;
  brex?: { mode: 'default' | 'project'; dmc?: string | null }; codeMode?: 'all' | 'selected'; enabledCodes?: string[]; snsEnforced?: boolean;
  snsPreset?: string; snsSystems?: string[]; dmTypes?: string[]; pmTemplate?: string;
}


export const s1000dApi = {
  catalogue: (issue: string, kind: CodeKind) => get<{ codes: CodeRow[]; ranges: CodeRange[]; sources: RefSource[]; rule: string; label: string; customNote: string }>(`/api/s1000d/catalogue?issue=${issue}&kind=${kind}`),
  presets: () => get<{ presets: PresetSummary[] }>('/api/s1000d/presets').then((r) => r.presets),
  preset: (id: string) => get<{ preset: PresetSummary; nodes: PresetNode[] }>(`/api/s1000d/presets/${id}`),
  validateConfig: (s1000d: NewProjectConfig) => post<{ ok: boolean; notes: string[] }>('/api/s1000d/validate-config', { s1000d }),

  overview: () => get<{ summary: Array<{ issue: IssueKey; label: string; kinds: Record<CodeKind, { count: number; custom: number; ranges: number }> }>; sources: RefSource[]; unresolved: Record<string, string>; evidence: { types: Record<string, DefaultEvidence>; statuses: Record<string, string>; document: string; method: string; limitation: string }; customNote: string; advice: Record<string, Advice[]>; kinds: Array<{ kind: CodeKind; rule: string; label: string; hint: string }>; issues: Array<{ key: IssueKey; label: string }> }>('/api/admin/s1000d/overview'),
  impact: (kind: CodeKind, issue: IssueKey, code: string) => post<{ impact: Impact }>('/api/admin/s1000d/codes/impact', { kind, issue, code }).then((r) => r.impact),
  addCode: (b: { kind: CodeKind; issue?: IssueKey; issues?: IssueKey[]; code: string; title: string }) => post<{ note: string; brexAccepts: boolean }>('/api/admin/s1000d/codes', b),
  editCode: (b: { kind: CodeKind; issue: IssueKey; code: string; title: string; confirmImpact?: boolean }) => put<{ impact: Impact }>('/api/admin/s1000d/codes', b),
  deleteCode: (kind: CodeKind, issue: IssueKey, code: string, confirmImpact = false) => del<{ impact: Impact }>(`/api/admin/s1000d/codes?kind=${kind}&issue=${issue}&code=${encodeURIComponent(code)}${confirmImpact ? '&confirmImpact=true' : ''}`),
  createPreset: (name: string, model?: string) => post<{ preset: PresetSummary }>('/api/admin/s1000d/presets', { name, ...(model ? { model } : {}) }),
  setPresetModel: (id: string, model: string) => put<{ preset: PresetSummary }>(`/api/admin/s1000d/presets/${id}/model`, { model }),
  duplicatePreset: (id: string, name: string) => post<{ preset: PresetSummary }>(`/api/admin/s1000d/presets/${id}/duplicate`, { name }),
  deletePreset: (id: string) => del(`/api/admin/s1000d/presets/${id}`),
  putPresetNode: (id: string, path: string, title: string) => put(`/api/admin/s1000d/presets/${id}/nodes`, { path, title }),
  deletePresetNode: (id: string, path: string, cascade: boolean) => del<{ removed: number }>(`/api/admin/s1000d/presets/${id}/nodes?path=${encodeURIComponent(path)}&cascade=${cascade}`),
  presetExportUrl: (id: string, format: 'csv' | 'json') => `/api/admin/s1000d/presets/${id}/export?format=${format}`,

  project: (id: string) => get<ProjectBundle>(`/api/projects/${id}/s1000d`),
  /** Change the model code of a project that has data modules: apply false = a preview of what would change. */
  modelCode: (id: string, mic: string, apply: boolean) => post<ModelCodePlan>(`/api/projects/${id}/model-code`, { mic, apply }),
  saveProject: (id: string, config: Partial<NewProjectConfig>, expectedVersion?: number) => put<ProjectBundle>(`/api/projects/${id}/s1000d`, { config, expectedVersion }),
  saveCodes: (id: string, kind: CodeKind, codes: string[], codeMode?: 'all' | 'selected') => put<ProjectBundle>(`/api/projects/${id}/s1000d/codes`, { kind, codes, codeMode }),
  saveTypes: (id: string, enabled: string[]) => put<ProjectBundle>(`/api/projects/${id}/s1000d/dm-types`, { enabled }),

  sns: (id: string, q = '') => get<{ nodes: SnsNode[]; tree: SnsNode[]; total: number; levels: Array<{ level: number; name: string; hint: string }>; enforced: boolean }>(`/api/projects/${id}/sns?q=${encodeURIComponent(q)}`),
  addSns: (id: string, path: string, title: string) => post(`/api/projects/${id}/sns`, { path, title }),
  editSns: (id: string, path: string, p: { title?: string; code?: string }) => patch(`/api/projects/${id}/sns`, { path, ...p }),
  deleteSns: (id: string, path: string, cascade: boolean) => del<{ removed: number }>(`/api/projects/${id}/sns?path=${encodeURIComponent(path)}&cascade=${cascade}`),
  applyPreset: (id: string, presetId: string, dryRun: boolean, systems?: string[]) => post<{ report: ImportReport }>(`/api/projects/${id}/sns/preset`, { presetId, dryRun, systems }).then((r) => r.report),
  importSns: (id: string, format: 'csv' | 'json', text: string, dryRun: boolean, overwriteTitles = false) => post<{ report: ImportReport }>(`/api/projects/${id}/sns/import`, { format, text, dryRun, overwriteTitles }).then((r) => r.report),
  snsExportUrl: (id: string, format: 'csv' | 'json') => `/api/projects/${id}/sns/export?format=${format}`,


};
