// Typed calls to the package importer (backend/src/routes/importer.ts). The shapes mirror
// backend/src/services/importer/{types,apply,state,assign}.ts.
//
//   scan        files and/or a zip -> a report; nothing is written
//   apply       the same upload + options -> writes, answers with the change log
//   unassigned  the modules no publication claimed, the sub-publications, where modules can go
//   assign      move modules from that pool into the publication
//
// Scan and apply send the whole package in one multipart request. fetch cannot report upload progress, so
// they go through XMLHttpRequest; errors are turned into the same ApiError every other call throws.

import { ApiError, post, get, signalUnauthorized } from './client';
import { invalidate } from './query';

export type ImportSeverity = 'error' | 'warning' | 'info';
export type ImportFileKind = 'dm' | 'brex' | 'pmc' | 'icn' | 'image' | 'other' | 'ignored';
export type ImportFlavour = 'xignal-s1000d' | 'xignal-jss' | 'vektra' | 'generic-s1000d';
export type RepairRuleId = 'table-cols' | 'icn-placeholder' | 'brex-remap' | 'pmc-reconstruct' | 'pmc-titles' | 'pmc-dmref-identity';
export type ReportRuleId = RepairRuleId | 'orphans-pool' | 'pmc-missing-dmref' | 'pmc-language' | 'subpub' | 'package';

export interface ImportRule { id: RepairRuleId; title: string; defaultOn: boolean; description: string }

export interface ImportFinding {
  id: string; severity: ImportSeverity; rule: ReportRuleId; file?: string; message: string; repairable?: boolean;
  data?: Record<string, unknown>;
}

export interface ImportChange {
  seq: number; rule: ReportRuleId;
  /** edit = a file's text changed; add = a file was created; note = a decision recorded without changing a file */
  kind: 'edit' | 'add' | 'note';
  file: string; where?: string; line?: number; before: string; after: string;
  /** fabricated (a placeholder image, a reconstructed publication) rather than corrected */
  synthetic?: boolean;
}

export interface ImportPoolItem {
  file: string; dmc: string; techName: string; infoName: string; infoCode: string; group: string;
  reason: 'not-in-any-pmc' | 'sub-publication-not-in-package'; emptyContent: boolean;
}

export interface ImportSubPublication {
  pmCode: string; entryTitle: string; pmTitle: string; referencedFrom: string;
  status: 'nested' | 'anchor-only' | 'unresolved';
  pmcFile?: string; anchorDm?: { file: string; dmc: string; techName: string }; anchorBasis?: 'title-page' | 'any-module';
}

export interface ImportReport {
  version: 1;
  flavour: { id: ImportFlavour; confidence: number; evidence: string[] };
  counts: { files: number; bytes: number; dms: number; brex: number; pmcs: number; icns: number; images: number; other: number; ignored: number };
  files: Array<{ path: string; kind: ImportFileKind; size: number; dmc?: string }>;
  models: Record<string, number>;
  languages: Record<string, number>;
  graphics: { declared: number; present: number; missing: Array<{ icn: string; target: string; declaredIn: string[] }>; unusedFiles: string[] };
  publications: Array<{ file: string; pmCode: string; title: string; language: string; placeholder: boolean; reconstructed: boolean; entries: number; dmRefs: number; referencedFrom?: string }>;
  subPublications: ImportSubPublication[];
  unassigned: ImportPoolItem[];
  reusedDms: Array<{ dmc: string; occurrences: number; file?: string }>;
  missingModules: Array<{ dmc: string; title: string; inPmc: string; generatedFrontMatter: boolean }>;
  findings: ImportFinding[];
  summary: { errors: number; warnings: number; infos: number; repairable: number };
  repairPlan: Array<{ rule: RepairRuleId | 'orphans-pool'; title: string; defaultOn: boolean; items: number; files: number }>;
}

export interface ImportOptions {
  /** Rules to run; omitted = every rule that is on by default. */
  repairs?: RepairRuleId[];
  /** Replace modules that already exist in the project (default: refuse). */
  overwrite?: boolean;
  /** auto: replace the publication only when the project has none; replace: always (the old one is kept as .bak); keep: never. */
  publication?: 'auto' | 'replace' | 'keep';
  /** Also re-point a BREX the package does not ship to the default BREX of its issue. */
  neutraliseMissingBrex?: boolean;
}

export interface ScanResult { report: ImportReport; rules: ImportRule[] }

export interface ImportBatch {
  id: string; at: string; by: string; flavour: string; rules: string[]; assembleUnassigned: boolean;
  counts: { dms: number; media: number; placeholders: number; changes: number; pool: number };
  originals: string; publication: 'replaced' | 'kept' | 'none'; reconstructed: 'full' | 'metadata' | null;
}

export interface ApplyResult {
  ok: true;
  batch: ImportBatch;
  imported: { dms: string[]; overwritten: string[]; media: string[]; mediaKept: string[]; skipped: string[] };
  publication: { mode: 'replaced' | 'kept' | 'none'; counts?: { folders: number; dms: number; total: number }; reconstructed: 'full' | 'metadata' | null; backup?: string };
  changeLog: ImportChange[];
  placeholders: Array<{ file: string; icn: string; declaredIn: string[] }>;
  pool: ImportPoolItem[];
  subPublications: ImportSubPublication[];
  reusedDms: Array<{ dmc: string; occurrences: number; file?: string }>;
  withProblems: Array<{ file: string; problem: string }>;
  flavour: ImportReport['flavour'];
  summary: ImportReport['summary'];
  originals: string;
}

export interface PoolModule {
  file: string; dmc: string; techName: string; infoName: string; infoCode: string;
  reason: string; group: string; anchorOf?: string;
}
export interface AssignTargetNode { path: number[]; title: string; kind: 'folder' | 'pmRef'; modules: number; pmCode?: string; depth: number }
export interface Unassigned {
  count: number; total: number; hasPublication: boolean;
  pool: PoolModule[];
  subPublications: Array<{ pmCode: string; title: string; status: 'nested' | 'anchor-only' | 'unresolved'; anchor?: { file: string; dmc: string; techName: string }; anchorBasis?: string; materialisedAs: string | null }>;
  targets: AssignTargetNode[];
  reconstructed: 'full' | 'metadata' | null;
  lastImport: ImportBatch | null;
}

export interface AssignBody {
  files: string[];
  to: { folderPath?: number[]; subPublication?: string; newFolder?: string; position?: 'start' | 'end' };
  reuse?: boolean;
}
export interface AssignResult {
  placed: string[]; refused: Array<{ file: string; reason: string }>;
  materialised: { pmCode: string; title: string; path: number[] } | null;
  counts: { folders: number; dms: number; total: number }; backup?: string;
}

const P = (id: string) => `/api/projects/${id}/import`;

/** One multipart POST that reports how much of the upload has gone out, and can be cancelled. */
function send<T>(url: string, form: FormData, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    if (onProgress) xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(e.loaded, e.total); };
    invalidate();                                     // a write that does not go through request(): the query layer is told by hand (WP-18)
    xhr.onload = () => {
      invalidate();
      let data: Record<string, unknown> | null = null;
      if ((xhr.getResponseHeader('content-type') ?? '').includes('json')) { try { data = JSON.parse(xhr.responseText) as Record<string, unknown>; } catch { data = null; } }
      if (xhr.status >= 200 && xhr.status < 300) { resolve(data as T); return; }
      if (xhr.status === 401) signalUnauthorized();
      reject(new ApiError(xhr.status, (data && typeof data.error === 'string' && data.error) || `${xhr.status} ${xhr.statusText}`, typeof data?.code === 'string' ? data.code : undefined, data ?? undefined));
    };
    xhr.onerror = () => reject(new ApiError(0, 'The server could not be reached. Nothing was changed. Check the connection and try again.'));
    xhr.onabort = () => reject(new DOMException('Cancelled', 'AbortError'));
    if (signal) { if (signal.aborted) { xhr.abort(); return; } signal.addEventListener('abort', () => xhr.abort(), { once: true }); }
    xhr.send(form);
  });
}

export const importerApi = {
  scan: (id: string, form: FormData, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal) => send<ScanResult>(`${P(id)}/scan`, form, onProgress, signal),
  apply: (id: string, form: FormData, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal) => send<ApplyResult>(`${P(id)}/apply`, form, onProgress, signal),
  unassigned: (id: string) => get<Unassigned>(`${P(id)}/unassigned`),
  assign: (id: string, body: AssignBody) => post<AssignResult>(`${P(id)}/assign`, body),
};
