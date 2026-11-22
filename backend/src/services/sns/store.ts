// =============================================================================
// Where SNS rows live, and how they change.
//
//   organisation defaults   config_items, collection `sns-defaults` (the same table the Administrator's reference data uses)
//   one project             <project>/.sns.json   (travels with a copy of the project; a dot-file, so the document index ignores it)
//
// Both hold the same rows, so the rules - validation, duplicate detection, cascade, merge-never-overwrite - are written once over a
// small `Repo` and used for either. The Administrator's older two-column `sns` table (code, name) is left exactly as it was; the
// first time the organisation defaults are read they are seeded from it, once, so what an administrator already typed is not lost.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso } from '../../config';
import { projectDirFor, store } from '../../context';
import { bad, conflict, notFound, HttpError } from '../http';
import type { OrderConfig } from './codes';
import { displayCode, levelOf, normalizeRow, rowKey, sortRows, validateRowSet, type SnsProblem, type SnsRow, type SnsRowData } from './model';

const { newId } = require('../../core/auth/crypto');

export interface Repo {
  list(): SnsRow[];
  put(row: SnsRow): void;
  remove(id: string): void;
}

// ── backends ────────────────────────────────────────────────────────────────

const ORG = 'sns-defaults';
const ORG_SEEDED = 'seeded:sns-defaults';

/** The organisation defaults as stored, without the one-off seeding below (which itself needs to read and write them). */
const rawOrg: Repo = {
  list: () => sortRows(store.configList(ORG).map((r: any) => toRow(r.id, r))),
  put(row) { store.configPut(ORG, row.id, rowData(row), nowIso()); },
  remove(id) { store.configDelete(ORG, id); },
};

/** The organisation-wide default SNS: one config_items record per row. */
export const orgRepo: Repo = {
  list() {
    seedOrgFromLegacy();
    return rawOrg.list();
  },
  put: rawOrg.put,
  remove: rawOrg.remove,
};

/**
 * The Administrator's older two-column SNS table (code, name) as rows: system-level, which is all it can express.
 * That table is no longer an Administrator screen (the SNS presets replaced it, and bootReference carries what an administrator had typed into a preset),
 * so there is no collection to ask: the rows an upgraded database may still hold are read straight from the store, as bootReference does. Nothing is seeded.
 */
export const legacyRows = (): SnsRowData[] => (store.configList('sns') as any[]).map((r) => ({ systemCode: String(r.code ?? ''), title: String(r.name ?? '') } as SnsRowData));

/**
 * First read only: the older table is merged into the defaults (never overwriting a title that is already there). It used to be copied only when the
 * defaults were still empty; a row typed in the older table before the defaults existed, next to defaults someone had already entered, was lost.
 */
function seedOrgFromLegacy(): void {
  if (store.configGet('app-state', ORG_SEEDED)) return;
  mergeRows(rawOrg, legacyRows());
  store.configPut('app-state', ORG_SEEDED, { done: true }, nowIso());
}

/**
 * Merge the older table into the defaults again, on request: that table stays editable (it feeds the editor's reference lists) and can gain rows after the
 * one-off seeding. `apply: false` only reports what would happen.
 */
export function mergeLegacyIntoDefaults(opts: { apply: boolean; overwrite?: boolean }): MergeResult & { legacy: number } {
  const rows = legacyRows();
  const repo = opts.apply ? rawOrg : memoryRepo(rawOrg.list());
  return { ...mergeRows(repo, rows, { overwrite: opts.overwrite }), legacy: rows.length };
}

const rowData = (r: SnsRow): SnsRowData => ({
  systemDiffCode: r.systemDiffCode, systemCode: r.systemCode, subSystemCode: r.subSystemCode, subSubSystemCode: r.subSubSystemCode, assyCode: r.assyCode, title: r.title,
});
const toRow = (id: string, d: Partial<SnsRowData>): SnsRow => ({
  id, systemDiffCode: String(d.systemDiffCode ?? ''), systemCode: String(d.systemCode ?? ''), subSystemCode: String(d.subSystemCode ?? ''),
  subSubSystemCode: String(d.subSubSystemCode ?? ''), assyCode: String(d.assyCode ?? ''), title: String(d.title ?? ''),
});

interface ProjectSnsFile { schemaVersion: 1; rows: SnsRow[]; order?: OrderConfig; updatedAt: string }

const fileOf = (projectId: string): string => path.join(projectDirFor(projectId), '.sns.json');

function readFile(projectId: string): ProjectSnsFile {
  try {
    const j = JSON.parse(fs.readFileSync(fileOf(projectId), 'utf8'));
    return { schemaVersion: 1, rows: Array.isArray(j.rows) ? j.rows.map((r: any) => toRow(String(r.id), r)) : [], order: j.order, updatedAt: String(j.updatedAt ?? '') };
  } catch { return { schemaVersion: 1, rows: [], updatedAt: '' }; }
}

function writeFile(projectId: string, doc: ProjectSnsFile): void {
  const abs = fileOf(projectId);
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify({ ...doc, updatedAt: nowIso() }, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, abs);
}

/** One project's SNS (`.sns.json`). */
export const projectRepo = (projectId: string): Repo => ({
  list: () => sortRows(readFile(projectId).rows),
  put(row) {
    const doc = readFile(projectId);
    const i = doc.rows.findIndex((r) => r.id === row.id);
    if (i >= 0) doc.rows[i] = row; else doc.rows.push(row);
    writeFile(projectId, doc);
  },
  remove(id) {
    const doc = readFile(projectId);
    doc.rows = doc.rows.filter((r) => r.id !== id);
    writeFile(projectId, doc);
  },
});

/** The project's saved ordering overrides for `deriveStructure` (info-code groups, pins, ranks), if any. */
export const readProjectOrder = (projectId: string): OrderConfig | undefined => readFile(projectId).order;
export function writeProjectOrder(projectId: string, order: OrderConfig | undefined): void {
  const doc = readFile(projectId);
  if (order) doc.order = order; else delete doc.order;
  writeFile(projectId, doc);
}

// ── operations (the same for either backend) ────────────────────────────────

const invalid = (errors: string[]): HttpError => new HttpError(400, errors[0], 'SNS_INVALID', { errors });

/** The rows below `r` (its descendants), whichever difference code they carry as long as it is the row's own. */
function descendants(rows: SnsRow[], r: SnsRowData): SnsRow[] {
  const lvl = levelOf(r);
  if (lvl === 'assy') return [];
  return rows.filter((d) => d.systemDiffCode === r.systemDiffCode && d.systemCode === r.systemCode
    && (lvl === 'system' ? levelOf(d) !== 'system'
      : d.subSystemCode === r.subSystemCode && (lvl === 'subsystem' ? levelOf(d) !== 'subsystem' : d.subSubSystemCode === r.subSubSystemCode && levelOf(d) === 'assy')));
}

export function createRow(repo: Repo, body: unknown): { row: SnsRow; warnings: string[] } {
  const n = normalizeRow(body);
  if (!n.row) throw invalid(n.errors);
  const rows = repo.list();
  const twin = rows.find((r) => rowKey(r) === rowKey(n.row!));
  if (twin) throw conflict(`${displayCode(n.row)}${n.row.systemDiffCode ? ` (difference code ${n.row.systemDiffCode})` : ''} is already defined as "${twin.title}".`, 'SNS_DUPLICATE', { existing: twin });
  const row: SnsRow = { id: newId(), ...n.row };
  repo.put(row);
  return { row, warnings: warningsFor(rows, row) };
}

/** A parent that is not defined is a warning, not a refusal: rows can be entered in any order. */
function warningsFor(before: SnsRow[], row: SnsRow): string[] {
  return validateRowSet([...before, row]).filter((p) => p.severity === 'warn' && p.rowIds.includes(row.id)).map((p) => p.message);
}

export function updateRow(repo: Repo, id: string, body: unknown, cascade = false): { row: SnsRow; changedChildren: number; warnings: string[] } {
  const rows = repo.list();
  const cur = rows.find((r) => r.id === id);
  if (!cur) throw notFound('No such SNS row.');
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const merged = { ...rowData(cur), ...Object.fromEntries(Object.entries(b).filter(([k]) => k in cur && k !== 'id')) };
  const n = normalizeRow(merged);
  if (!n.row) throw invalid(n.errors);
  const twin = rows.find((r) => r.id !== id && rowKey(r) === rowKey(n.row!));
  if (twin) throw conflict(`${displayCode(n.row)} is already defined as "${twin.title}".`, 'SNS_DUPLICATE', { existing: twin });

  let changed = 0;
  if (rowKey(n.row) !== rowKey(cur)) {
    const kids = descendants(rows, cur);
    if (kids.length && !cascade) throw conflict(`${kids.length} row${kids.length === 1 ? '' : 's'} sit below ${displayCode(cur)}. Change their codes too (cascade) or move them first.`, 'SNS_HAS_CHILDREN', { children: kids.length });
    for (const k of kids) {
      const moved: SnsRow = { ...k, systemDiffCode: n.row.systemDiffCode, systemCode: n.row.systemCode };
      const lvl = levelOf(cur);
      if (lvl !== 'system') moved.subSystemCode = n.row.subSystemCode;
      if (lvl === 'subsubsystem') moved.subSubSystemCode = n.row.subSubSystemCode;
      repo.put(moved);
      changed++;
    }
  }
  const row: SnsRow = { id, ...n.row };
  repo.put(row);
  return { row, changedChildren: changed, warnings: warningsFor(rows.filter((r) => r.id !== id), row) };
}

export function deleteRow(repo: Repo, id: string, cascade = false): { removed: number } {
  const rows = repo.list();
  const cur = rows.find((r) => r.id === id);
  if (!cur) throw notFound('No such SNS row.');
  const kids = descendants(rows, cur);
  if (kids.length && !cascade) throw conflict(`${kids.length} row${kids.length === 1 ? '' : 's'} sit below ${displayCode(cur)}. Delete them too (cascade) or move them first.`, 'SNS_HAS_CHILDREN', { children: kids.length });
  for (const k of kids) repo.remove(k.id);
  repo.remove(id);
  return { removed: kids.length + 1 };
}

export interface MergeResult {
  added: SnsRow[];
  /** Already defined with exactly the same title: nothing to do. */
  same: number;
  /** The rows behind `same`, so a preview can show what is already there. */
  present: Array<{ key: string; code: string; title: string }>;
  /**
   * Already defined with another title. Kept as it is unless `overwrite`. `caseOnly`: the two titles differ only in capital letters - listed rather than
   * hidden, because "Hydraulic system" and "HYDRAULIC SYSTEM" print differently in a book.
   */
  conflicts: Array<{ key: string; code: string; existing: string; incoming: string; overwritten: boolean; caseOnly?: boolean }>;
  /** Input that was not a valid row. */
  rejected: Array<{ index: number; code: string; errors: string[] }>;
}

/**
 * Bring rows in. A row that is new is added; one that is already there is left alone and reported, unless the caller
 * explicitly asks to `overwrite` titles - there is no silent path that replaces what an author wrote.
 */
export function mergeRows(repo: Repo, incoming: ReadonlyArray<unknown>, opts: { overwrite?: boolean } = {}): MergeResult {
  const rows = repo.list();
  const byKey = new Map(rows.map((r) => [rowKey(r), r]));
  const out: MergeResult = { added: [], same: 0, present: [], conflicts: [], rejected: [] };
  incoming.forEach((raw, index) => {
    const n = normalizeRow(raw);
    if (!n.row) { out.rejected.push({ index, code: displayCode((raw ?? {}) as SnsRowData), errors: n.errors }); return; }
    const k = rowKey(n.row);
    const have = byKey.get(k);
    if (!have) {
      const row: SnsRow = { id: newId(), ...n.row };
      repo.put(row); byKey.set(k, row); out.added.push(row);
    } else if (have.title === n.row.title) {
      out.same++; out.present.push({ key: k, code: displayCode(n.row), title: have.title });
    } else {
      const over = !!opts.overwrite;
      if (over) { const row = { ...have, title: n.row.title }; repo.put(row); byKey.set(k, row); }
      const caseOnly = have.title.toLowerCase() === n.row.title.toLowerCase();
      out.conflicts.push({ key: k, code: displayCode(n.row), existing: have.title, incoming: n.row.title, overwritten: over, ...(caseOnly ? { caseOnly: true } : {}) });
    }
  });
  return out;
}

export function problemsOf(repo: Repo): SnsProblem[] {
  return validateRowSet(repo.list());
}

/** An in-memory repository: what a merge WOULD do, without writing it (previews). */
export function memoryRepo(initial: readonly SnsRow[]): Repo {
  let rows = [...initial];
  return {
    list: () => sortRows(rows),
    put(row) { const i = rows.findIndex((r) => r.id === row.id); if (i >= 0) rows[i] = row; else rows.push(row); },
    remove(id) { rows = rows.filter((r) => r.id !== id); },
  };
}
