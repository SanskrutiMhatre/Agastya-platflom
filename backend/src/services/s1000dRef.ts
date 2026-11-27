// =============================================================================
// S1000D reference catalogues: information codes, learn codes, learn event codes, item location codes.
//
// WHERE THE DATA COMES FROM
//   The master catalogue is the OFFICIAL default BREX of each supported issue (backend/brex/DMC-S1000D-<F|G|H|J>-...):
//     BREX-S1-00180  allowed information codes (and their titles)
//     BREX-S1-00139  allowed learn codes          BREX-S1-00141  allowed learn event codes
//     BREX-S1-00138  allowed item location codes
//   Each row records the file, its SHA-256, the rule and the issue it was read from (table ref_sources / ref_codes), so any
//   code can be traced to the document that allows it. Nothing here is typed in from memory.
//
// WHAT IS NOT IN BREX (and therefore not claimed)
//   Which codes suit which DM type is NOT stated by BREX. The platform keeps two pieces of advice, both labelled as advice:
//     - the type's own default code (the dm-types table; six defaults are UNRESOLVED - see UNRESOLVED_DEFAULTS), and
//     - the code->schema map of s1kd-newdm (backend/reference/dmtype-recommendations.json), which is not S1000D text.
//   Advice never restricts a choice. BREX stays the validation authority (services/brex.ts, publishGate.ts).
//
// ISSUES
//   4.2 / 5.0 / 6 / 7 - the four the wizard offers. Only the 4.2 specification text is available to this project; the other
//   issues are covered by their default BREX alone (documented in docs/S1000D_REFERENCE_CONFIG.md).
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { nowIso } from '../config';
import { repos } from '../context';
import { bad, conflict, notFound } from './http';
import { parseBrexModel } from './brex';

export type CodeKind = 'infoCode' | 'learnCode' | 'learnEventCode' | 'itemLocationCode';
export const CODE_KINDS: CodeKind[] = ['infoCode', 'learnCode', 'learnEventCode', 'itemLocationCode'];

/** The issue keys the platform uses everywhere ("4-2" is S1000D 4.2, "6" is 6.0). */
export const ISSUE_KEYS = ['4-2', '5-0', '6', '7'] as const;
export type IssueKey = typeof ISSUE_KEYS[number];
export const ISSUE_LABEL: Record<IssueKey, string> = { '4-2': '4.2', '5-0': '5.0', '6': '6.0', '7': '7.0' };
const LETTER: Record<IssueKey, string> = { '4-2': 'F', '5-0': 'G', '6': 'H', '7': 'J' };

/** The BREX decision rule each catalogue kind is read from. */
export const KIND_RULE: Record<CodeKind, { rule: string; path: string; label: string; pattern: RegExp; hint: string }> = {
  infoCode: { rule: 'BREX-S1-00180', path: '//dmIdent/dmCode/@infoCode', label: 'Information codes', pattern: /^[A-Z0-9]{3}$/, hint: '3 letters or digits, e.g. 040' },
  learnCode: { rule: 'BREX-S1-00139', path: '//@learnCode', label: 'Learn codes', pattern: /^[TH][A-Z0-9]{2}$/, hint: 'T or H followed by 2 letters or digits, e.g. H10' },
  learnEventCode: { rule: 'BREX-S1-00141', path: '//@learnEventCode', label: 'Learn event codes', pattern: /^[A-Z]$/, hint: 'one letter, e.g. A' },
  itemLocationCode: { rule: 'BREX-S1-00138', path: '//@itemLocationCode', label: 'Item location codes', pattern: /^[A-Z]$/, hint: 'one letter, e.g. A' },
};

export interface DefaultEvidence { status: 'confirmed' | 'supported' | 'corrected' | 'multiple' | 'unresolved'; default: string | null; previousDefault?: string; note: string; refs: string[]; codes: string[] }

/**
 * What the S1000D specification says about the default information code of the six types that used to be "unresolved"
 * (backend/reference/dmtype-spec-evidence.json: each entry cites the chapters it was read from; Issue 4.2 text only).
 */
const EVIDENCE_FILE = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'reference', 'dmtype-spec-evidence.json'), 'utf8'));
export const SPEC_EVIDENCE: Record<string, DefaultEvidence> = EVIDENCE_FILE.types;
export const EVIDENCE_STATUSES: Record<string, string> = EVIDENCE_FILE.statuses;
export const EVIDENCE_PROVENANCE: { document: string; method: string; limitation: string } = EVIDENCE_FILE.provenance;

/**
 * Defaults that are STILL not settled after reading the specification: the ones with several codes by content (wrngdata) or none (scocontent).
 * They stay flagged wherever they are shown and stay author-editable; nothing was invented or silently replaced.
 */
export const UNRESOLVED_DEFAULTS: Record<string, string> = Object.fromEntries(
  Object.entries(SPEC_EVIDENCE).filter(([, e]) => e.status === 'multiple' || e.status === 'unresolved').map(([k, e]) => [k, e.note]),
);

// WP-10 (PRD-002): every statement is in repositories/referenceRepository.ts; this file holds the rules.
const R = () => repos.reference;
const brexDir = () => path.join(__dirname, '..', '..', 'brex');
const refDir = () => path.join(__dirname, '..', '..', 'reference');
const brexFile = (issue: IssueKey) => path.join(brexDir(), `DMC-S1000D-${LETTER[issue]}-04-10-0301-00A-022A-D_001-00_EN-US.XML`);

export const isIssueKey = (v: unknown): v is IssueKey => (ISSUE_KEYS as readonly string[]).includes(String(v));
export const isKind = (v: unknown): v is CodeKind => (CODE_KINDS as readonly string[]).includes(String(v));

/** "4.2" / "5.0" / "6.0" / "7.0" / "4-2" / "6" -> the platform's issue key, or null. */
export function issueKeyOf(v: unknown): IssueKey | null {
  const s = String(v ?? '').trim().replace('.', '-');
  const k = s === '6-0' ? '6' : s === '7-0' ? '7' : s;
  return isIssueKey(k) ? k : null;
}

export interface CodeRow {
  kind: CodeKind; issue: IssueKey; code: string; title: string; origin: 'brex' | 'custom';
  sourceId: string | null; ruleId: string | null; sourceLabel: string | null;
  /** For a custom row: does the default BREX accept this code anyway (it falls in a "project available" range)? Always true for BREX rows. */
  brexAccepts: boolean;
}

// ── Seeding (idempotent) ─────────────────────────────────────────────────────

let seeded = false;
/**
 * Read the four default BREX files into ref_codes / ref_sources, and the DM-type advice into ref_dmtype_codes. Safe to run on every
 * start: rows that exist are refreshed from the file (it is the authority for origin 'brex'); the administrator's custom rows are never
 * touched; nothing is deleted.
 */
export function seedReference(): { codes: number; issues: number } {
  const now = nowIso();
  let codes = 0;
  repos.transaction(() => {
    for (const issue of ISSUE_KEYS) {
      const file = brexFile(issue);
      const raw = fs.readFileSync(file);
      const sha = crypto.createHash('sha256').update(raw).digest('hex');
      const sid = `brex:${issue}`;
      // unchanged file already read in: nothing to parse (start-up cost)
      if (R().sourceSha(sid) === sha && R().brexCodeCount(issue) > 0) continue;
      const xml = raw.toString('utf8');
      R().upsertBrexSource({
        id: sid, label: `S1000D Issue ${ISSUE_LABEL[issue]} default BREX`, file: path.basename(file), sha256: sha, issue,
        limitation: issue === '4-2' ? 'The Issue 4.2 specification text is also available to this project.'
          : 'Only this default BREX is available for this issue: the Issue 4.2 specification text is the only specification text on hand, so titles and code lists for this issue are as the BREX states them.',
        now,
      });
      const model = parseBrexModel(xml, `default ${ISSUE_LABEL[issue]}`, false);
      for (const kind of CODE_KINDS) {
        const rule = model.rules.find((r) => r.id === KIND_RULE[kind].rule && r.objectPath === KIND_RULE[kind].path);
        if (!rule) throw new Error(`The Issue ${ISSUE_LABEL[issue]} default BREX has no ${KIND_RULE[kind].rule}`);
        for (const v of rule.values) {
          if (v.form === 'pattern') {
            // "project available" ranges: BREX accepts ANY code matching the pattern, and leaves its meaning to the project
            R().upsertRange({ kind, issue, pattern: v.allowed.trim(), title: v.label.trim().replace(/\s+/g, ' '), sourceId: sid, ruleId: rule.id });
            continue;
          }
          if (v.form !== 'single') continue;
          const code = v.allowed.trim().toUpperCase();
          R().upsertBrexCode({ kind, issue, code, title: v.label.trim().replace(/\s+/g, ' '), sourceId: sid, ruleId: rule.id, now });
          codes++;
        }
      }
    }
    // DM-type advice
    const recFile = path.join(refDir(), 'dmtype-recommendations.json');
    const rec = JSON.parse(fs.readFileSync(recFile, 'utf8'));
    R().upsertAdviceSource({ id: 's1kd-dmtypes', label: rec.provenance.source, file: path.basename(recFile), sha256: crypto.createHash('sha256').update(fs.readFileSync(recFile)).digest('hex'), limitation: rec.provenance.limitation, now });
    for (const [schema, list] of Object.entries<string[]>(rec.bySchema)) {
      for (const code of list) R().addDmTypeAdvice(schema, code, 's1kd-dmtypes');
    }
  });
  seeded = true;
  return { codes, issues: ISSUE_KEYS.length };
}

export function ensureSeeded(): void { if (!seeded) seedReference(); }

// ── Reading ──────────────────────────────────────────────────────────────────

export interface CodeRange { kind: CodeKind; issue: IssueKey; pattern: string; title: string; sourceId: string | null; ruleId: string | null }

export function listRanges(kind: CodeKind, issue: IssueKey): CodeRange[] {
  ensureSeeded();
  return (R().listRanges(kind, issue) as any[])
    .map((r) => ({ kind: r.kind, issue: r.issue, pattern: r.pattern, title: r.title, sourceId: r.source_id ?? null, ruleId: r.rule_id ?? null }));
}

/** True when the default BREX accepts this code because it falls in a "project available" range (not because it is listed). */
export function inProjectRange(kind: CodeKind, issue: IssueKey, code: string): boolean {
  return listRanges(kind, issue).some((r) => { try { return new RegExp(`^(?:${r.pattern})$`).test(String(code).toUpperCase()); } catch { return false; } });
}

const rowOf = (r: any): CodeRow => ({
  kind: r.kind, issue: r.issue, code: r.code, title: r.title, origin: r.origin, sourceId: r.source_id ?? null, ruleId: r.rule_id ?? null, sourceLabel: r.source_label ?? null,
  brexAccepts: r.origin === 'brex' || inProjectRange(r.kind, r.issue, r.code),
});

export function listCodes(kind: CodeKind, issue: IssueKey): CodeRow[] {
  ensureSeeded();
  return R().listCodes(kind, issue).map(rowOf);
}

export function getCode(kind: CodeKind, issue: IssueKey, code: string): CodeRow | null {
  ensureSeeded();
  const r = R().getCode(kind, issue, String(code).toUpperCase());
  return r ? rowOf(r) : null;
}

export function listSources(): Array<{ id: string; kind: string; label: string; file: string | null; sha256: string | null; issue: string | null; limitation: string | null; loadedAt: string }> {
  ensureSeeded();
  return R().listSources().map((r: any) => ({
    id: r.id, kind: r.kind, label: r.label, file: r.file, sha256: r.sha256, issue: r.issue, limitation: r.limitation, loadedAt: r.loaded_at,
  }));
}

/** Per-issue summary: how many rows of each kind, and how many are the administrator's own. */
export function catalogueSummary() {
  ensureSeeded();
  return ISSUE_KEYS.map((issue) => ({
    issue, label: ISSUE_LABEL[issue],
    kinds: Object.fromEntries(CODE_KINDS.map((k) => {
      const r = R().countCodes(k, issue);
      return [k, { count: r.n, custom: r.custom, ranges: listRanges(k, issue).length }];
    })),
  }));
}

export interface TypeAdvice {
  schema: string; name: string;
  /** The type's default information code (the dm-types table), or '' when none. */
  defaultCode: string;
  /** Set when the default is one the platform could not confirm; the text says why. */
  unresolved: string | null;
  /** Codes suggested for this type, limited to this issue's catalogue: first what the specification pairs with the schema, then the s1kd-newdm reference (advice only). */
  recommended: string[];
  /** What the specification says about this type's default (only for the six that had been unresolved). */
  evidence: DefaultEvidence | null;
  /** True when the default is in this issue's catalogue. */
  defaultInCatalogue: boolean;
}

/** What each DM type suggests for an issue. Advice, never a restriction. */
export function typeAdvice(issue: IssueKey, dmTypes: Array<{ schema: string; name: string; infoCode?: string }>): TypeAdvice[] {
  ensureSeeded();
  const allowed = new Set(listCodes('infoCode', issue).map((c) => c.code));
  const recs = new Map<string, string[]>();
  for (const r of R().dmTypeAdvice()) {
    if (!allowed.has(r.code)) continue;
    (recs.get(r.schema) ?? recs.set(r.schema, []).get(r.schema)!).push(r.code);
  }
  return dmTypes.map((t) => {
    const defaultCode = String(t.infoCode ?? '').toUpperCase();
    const ev = SPEC_EVIDENCE[t.schema] ?? null;
    const fromSpec = (ev?.codes ?? []).filter((c) => allowed.has(c));
    const recommended = [...new Set([...fromSpec, ...(recs.get(t.schema) ?? [])])];
    return {
      schema: t.schema, name: t.name, defaultCode, unresolved: UNRESOLVED_DEFAULTS[t.schema] ?? null,
      recommended, evidence: ev, defaultInCatalogue: !defaultCode || allowed.has(defaultCode),
    };
  });
}

// ── Administrator's own (custom) rows ────────────────────────────────────────

export const RANGE_NOTE = 'This code falls in a range the default BREX leaves "project available", so the default BREX accepts it; its meaning is the project\'s to define.';
const CUSTOM_NOTE = 'A custom code is not in the default BREX: a data module that uses it fails BREX-S1-00180 (information codes) or its learn/item-location rule unless the project\'s own BREX allows it.';
export { CUSTOM_NOTE };

function cleanCode(kind: CodeKind, raw: unknown): string {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!KIND_RULE[kind].pattern.test(code)) throw bad(`${KIND_RULE[kind].label.replace(/s$/, '')}: ${KIND_RULE[kind].hint}.`, 'BAD_CODE');
  return code;
}
function cleanTitle(raw: unknown): string {
  const t = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!t) throw bad('A title is required.', 'FIELD_REQUIRED');
  if (t.length > 300) throw bad('That title is too long.');
  return t;
}

export function addCustomCode(kind: CodeKind, issue: IssueKey, rawCode: unknown, rawTitle: unknown): CodeRow {
  ensureSeeded();
  const code = cleanCode(kind, rawCode); const title = cleanTitle(rawTitle);
  if (getCode(kind, issue, code)) throw conflict(`${code} is already in the Issue ${ISSUE_LABEL[issue]} catalogue.`, 'DUPLICATE');
  const now = nowIso();
  R().insertCustomCode({ kind, issue, code, title, now });
  return getCode(kind, issue, code)!;
}

/** Add one custom code to several issues in one transaction. */
export function addCustomCodes(kind: CodeKind, issues: IssueKey[], rawCode: unknown, rawTitle: unknown): CodeRow[] {
  return repos.transaction(() => issues.map((i) => addCustomCode(kind, i, rawCode, rawTitle)));
}

export function updateCustomCode(kind: CodeKind, issue: IssueKey, code: string, rawTitle: unknown): CodeRow {
  const row = getCode(kind, issue, code);
  if (!row) throw notFound('No such code.');
  if (row.origin === 'brex') throw conflict('A code from the default BREX is read-only: the BREX is its source. Add a custom code instead.', 'READ_ONLY');
  R().setCodeTitle(kind, issue, row.code, cleanTitle(rawTitle), nowIso());
  return getCode(kind, issue, code)!;
}

export function deleteCustomCode(kind: CodeKind, issue: IssueKey, code: string): void {
  const row = getCode(kind, issue, code);
  if (!row) throw notFound('No such code.');
  if (row.origin === 'brex') throw conflict('A code from the default BREX is read-only: the BREX is its source.', 'READ_ONLY');
  // A project that had selected it no longer lists it; its data modules are untouched.
  R().deleteCode(kind, issue, row.code);
}
