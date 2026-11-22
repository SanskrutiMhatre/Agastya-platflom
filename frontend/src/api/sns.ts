// Typed calls to the Standard Numbering System (SNS) routes (backend/src/routes/sns.ts). The shapes mirror
// backend/src/services/sns/{model,store,learn,derive,service,codes}.ts.
//
//   a project's SNS      /api/projects/:id/sns-rows ...   rows, validation, ordering, BREX / defaults import, learning, structure derivation
//   organisation defaults /api/sns/defaults ...       any signed-in user reads; an administrator writes
//
// Imports and learning never replace a title on their own: they add what is new and REPORT what differs.

import { del, get, post, put } from './client';

export type SnsLevel = 'system' | 'subsystem' | 'subsubsystem' | 'assy';
export type SnsCodeKey = 'systemDiffCode' | 'systemCode' | 'subSystemCode' | 'subSubSystemCode' | 'assyCode';

export interface SnsRow {
  id: string;
  /** '' = every difference code */
  systemDiffCode: string;
  systemCode: string;
  subSystemCode: string;
  subSubSystemCode: string;
  assyCode: string;
  title: string;
}
export type SnsRowData = Omit<SnsRow, 'id'>;

export interface SnsProblem { severity: 'error' | 'warn'; code: 'DUPLICATE' | 'ORPHAN' | 'INVALID'; message: string; rowIds: string[] }
export interface SnsRules { levels: SnsLevel[]; codes: Record<SnsCodeKey, string>; note: string }
export interface SnsNodeView { row: SnsRow; level: SnsLevel; children: SnsNodeView[] }
export interface InfoGroup { id: string; label: string; from: string; to: string }

/** GET /api/projects/:id/sns-rows (with `tree`) and GET /api/sns/defaults (with `infoCodeGroups`). */
export interface SnsData { rows: SnsRow[]; tree?: SnsNodeView[]; problems: SnsProblem[]; rules: SnsRules; infoCodeGroups?: InfoGroup[] }

// ── ordering ─────────────────────────────────────────────────────────────────

export type OrderKey = 'sns' | 'info' | 'infoVariant' | 'disassy' | 'location' | 'language' | 'issue' | 'file';
export interface OrderConfig { groups?: InfoGroup[]; rank?: Record<string, number>; pinFirst?: string[]; pinLast?: string[]; keys?: OrderKey[] }
export interface OrderingInfo { groups: InfoGroup[]; keys: OrderKey[]; override: OrderConfig | null; note: string }

// ── importing and learning ───────────────────────────────────────────────────

/** `caseOnly`: the two titles differ only in capital letters (they print differently, so they are listed, and marked). */
export interface SnsConflict { key: string; code: string; existing: string; incoming: string; overwritten: boolean; caseOnly?: boolean }
/** A row that is already there with exactly the incoming title. */
export interface SnsPresent { key: string; code: string; title: string }
export interface SnsRejected { index: number; code: string; errors: string[] }
/** What a merge did, or would do (a preview). `same` counts the rows already present; `present` lists them (an older server sends only the count). */
export interface MergeSummary {
  added: SnsRow[]; same: number; present?: SnsPresent[]; conflicts: SnsConflict[]; rejected: SnsRejected[];
  counts: { added: number; same: number; conflicts: number; rejected: number };
}
export interface ImportResult extends MergeSummary { applied: boolean; sources?: string[]; notes?: string[]; unreadable?: Array<{ path: string; errors: string[] }> }
export interface ImportBody { apply: boolean; overwrite: boolean }

export type ProposalStatus = 'new' | 'exists' | 'conflict';
export interface LearnProposal {
  key: string; level: SnsLevel; row: SnsRowData;
  /** 0..1 */
  confidence: number;
  /** why this title, in words */
  basis: string;
  candidates: Array<{ title: string; count: number }>;
  sources: string[]; moduleCount: number; status: ProposalStatus;
  existing?: { id: string; title: string };
}
export interface LearnResult {
  proposals: LearnProposal[];
  summary: { nodes: number; new: number; exists: number; conflict: number; modules: number; skipped: number; lowConfidence: number };
  applied: MergeSummary | null;
}
export interface LearnBody { apply: boolean; accept?: string[]; minConfidence?: number }

// ── deriving the publication structure ───────────────────────────────────────

export type DeriveSource = 'project' | 'defaults' | 'merged';
export type DerivePlacement = 'replace' | 'unplaced';
export interface DeriveBody {
  sns: DeriveSource; apply: boolean; collapseZero: boolean; unmatched: 'deepest' | 'unclassified'; excludeFrontMatter: boolean; placement: DerivePlacement;
  unclassifiedTitle?: string; titleFormat?: 'code-title'; pmTitle?: string;
}
export interface StructDm {
  kind: 'dm'; file: string; dmc: string; techName: string; infoName: string; title: string; infoCode: string; infoGroup: string;
  match: 'full' | 'partial'; missing?: string[];
}
export interface StructModule {
  kind: 'module'; id: string; level: SnsLevel | 'unclassified'; code: string; title: string; titleSource: 'sns' | 'fixed'; systemDiffCode: string; rowId?: string;
  children: Array<StructModule | StructDm>;
}
export interface Structure {
  roots: StructModule[];
  counts: { dms: number; modules: number; full: number; partial: number; unclassified: number; superseded: number; skipped: number };
  superseded: Array<{ file: string; supersededBy: string }>;
  skipped: Array<{ file: string; reason: string }>;
  warnings: string[];
}
export interface DeriveResult {
  applied: boolean;
  /** only when applied */
  counts?: { folders: number; dms: number; total: number };
  backup?: string | null;
  snsRows: number; structure: Structure;
  pm: { entries: number; headerFrom: 'existing' | 'generated'; placement: DerivePlacement };
  hints: string[];
}

// ── the calls ────────────────────────────────────────────────────────────────

const P = (id: string) => `/api/projects/${id}/sns-rows`;
const cascadeQuery = (cascade: boolean) => (cascade ? '?cascade=true' : '');

export const snsApi = {
  get: (id: string) => get<SnsData>(P(id)),
  create: (id: string, row: SnsRowData) => post<{ row: SnsRow; warnings: string[] }>(P(id), row),
  update: (id: string, rowId: string, row: SnsRowData, cascade = false) => put<{ row: SnsRow; changedChildren: number; warnings: string[] }>(`${P(id)}/${encodeURIComponent(rowId)}${cascadeQuery(cascade)}`, row),
  remove: (id: string, rowId: string, cascade = false) => del<{ removed: number }>(`${P(id)}/${encodeURIComponent(rowId)}${cascadeQuery(cascade)}`),
  ordering: (id: string) => get<OrderingInfo>(`${P(id)}/ordering`),
  /** `null` removes the project's override (the defaults apply again). */
  setOrdering: (id: string, order: OrderConfig | null) => put<OrderingInfo>(`${P(id)}/ordering`, { order }),
  importBrex: (id: string, b: ImportBody) => post<ImportResult>(`${P(id)}/import-brex`, b),
  importDefaults: (id: string, b: ImportBody) => post<ImportResult>(`${P(id)}/import-defaults`, b),
  learn: (id: string, b: LearnBody) => post<LearnResult>(`${P(id)}/learn`, b),
  derive: (id: string, b: DeriveBody) => post<DeriveResult>(`${P(id)}/derive`, b),
};

export const snsDefaultsApi = {
  get: () => get<SnsData>('/api/sns/defaults'),
  create: (row: SnsRowData) => post<{ row: SnsRow; warnings: string[] }>('/api/sns/defaults', row),
  update: (rowId: string, row: SnsRowData, cascade = false) => put<{ row: SnsRow; changedChildren: number; warnings: string[] }>(`/api/sns/defaults/${encodeURIComponent(rowId)}${cascadeQuery(cascade)}`, row),
  remove: (rowId: string, cascade = false) => del<{ removed: number }>(`/api/sns/defaults/${encodeURIComponent(rowId)}${cascadeQuery(cascade)}`),
  /** Merge the Administrator's older two-column SNS table into the defaults. `apply: false` writes nothing. */
  mergeLegacy: (b: ImportBody) => post<ImportResult & { legacy: number }>('/api/sns/defaults/merge-legacy', b),
};

/** The two backends of the row editor, so one component serves a project's SNS and the organisation defaults. */
export interface SnsRowsApi {
  create(row: SnsRowData): Promise<{ row: SnsRow; warnings: string[] }>;
  update(rowId: string, row: SnsRowData, cascade: boolean): Promise<{ row: SnsRow; changedChildren: number; warnings: string[] }>;
  remove(rowId: string, cascade: boolean): Promise<{ removed: number }>;
}
export const projectRowsApi = (id: string): SnsRowsApi => ({
  create: (row) => snsApi.create(id, row),
  update: (rowId, row, cascade) => snsApi.update(id, rowId, row, cascade),
  remove: (rowId, cascade) => snsApi.remove(id, rowId, cascade),
});
export const defaultsRowsApi: SnsRowsApi = {
  create: (row) => snsDefaultsApi.create(row),
  update: (rowId, row, cascade) => snsDefaultsApi.update(rowId, row, cascade),
  remove: (rowId, cascade) => snsDefaultsApi.remove(rowId, cascade),
};
