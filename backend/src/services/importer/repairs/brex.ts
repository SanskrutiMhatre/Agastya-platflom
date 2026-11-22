// =============================================================================
// Repair rule `brex-remap`: the business-rules module a file names is not the one its issue uses.
//
// The Vektra plugin stamps every module with `brexDmRef -> S1000D-H-04-10-0301-00A-022A-D` (the issue 6
// default) while the modules declare the 4.2 schema, whose default BREX is `S1000D-F-...`. The platform
// resolves a BREX from the module's own reference (services/brex.ts): the wrong letter means the wrong
// rule set is applied, and a letter with no bundled counterpart is a hard "BREX missing" refusal at publish.
//
// The rule re-points ONLY an S1000D default-BREX reference whose letter belongs to another issue, and does it
// for every module (and the publication module) alike, so the package stays consistent. It edits one attribute
// (`systemDiffCode`) and logs the before/after - the reference is never removed.
//
// A reference to a CUSTOM BREX (a project's own, `MM-A-00-0-0-00-00A-000A-A`) that the package does not ship
// cannot be "fixed" - the rules it stood for are simply not here. That is reported (warning) and left alone,
// unless the caller opts in with `neutraliseMissingBrex`, which swaps it for the issue's default BREX and says so.
// =============================================================================

import { scanTags, parseAttrs, setAttrs, lineAt } from '../xmlScan';
import { dmcFromAttrs } from '../identity';
import { defaultLetterFor } from '../../brex';
import type { ChangeEntry, Finding } from '../types';

export const BREX_DEFAULT_RE = /^S1000D-([A-Z])-04-10-0301-00A-022A-D$/;

/** `4.2` -> `4-2`, `6.0` -> `6`: the keys services/brex.ts uses. */
export function brexIssueKey(issue: string | undefined | null): string | null {
  if (!issue) return null;
  const m = /^(\d+)(?:[.-](\d+))?$/.exec(issue.trim());
  if (!m) return null;
  return m[2] === undefined || m[2] === '0' ? (m[1] === '5' ? '5-0' : m[1]) : `${m[1]}-${m[2]}`;
}

export const expectedBrexLetter = (issue: string | undefined | null): string => defaultLetterFor(brexIssueKey(issue));

interface BrexRef { start: number; end: number; rawAttrs: string; attrs: Record<string, string>; dmc: string }

/** The dmCode tags inside `<brexDmRef>` blocks. */
export function brexRefs(text: string): BrexRef[] {
  const out: BrexRef[] = [];
  let inside = 0;
  for (const t of scanTags(text)) {
    if (t.name === 'brexDmRef') { inside += t.kind === 'open' ? 1 : t.kind === 'close' ? -1 : 0; continue; }
    if (inside > 0 && t.name === 'dmCode' && t.kind !== 'close') {
      const attrs = parseAttrs(t.rawAttrs);
      out.push({ start: t.start, end: t.end, rawAttrs: t.rawAttrs, attrs, dmc: dmcFromAttrs(attrs) });
    }
  }
  return out;
}

export interface BrexCtx {
  /** The issue the file belongs to (`4.2`), from its own schema declaration unless the caller pins one. */
  issue: string | undefined;
  /** DM codes of BREX modules the package ships (`S1000D-F-...` form, no `DMC-`). */
  shipped: Set<string>;
  neutraliseMissing?: boolean;
}

export interface BrexIssue { kind: 'wrong-default' | 'missing-custom'; dmc: string; expected?: string; line: number }

export function brexIssues(text: string, ctx: BrexCtx): BrexIssue[] {
  // A module that declares no schema issue gives no basis to call its BREX letter wrong.
  const letter = brexIssueKey(ctx.issue) ? expectedBrexLetter(ctx.issue) : null;
  const out: BrexIssue[] = [];
  for (const r of brexRefs(text)) {
    const d = BREX_DEFAULT_RE.exec(r.dmc);
    if (d) {
      if (letter && d[1] !== letter && !ctx.shipped.has(r.dmc)) out.push({ kind: 'wrong-default', dmc: r.dmc, expected: r.dmc.replace(`S1000D-${d[1]}-`, `S1000D-${letter}-`), line: lineAt(text, r.start) });
    } else if (!ctx.shipped.has(r.dmc)) out.push({ kind: 'missing-custom', dmc: r.dmc, line: lineAt(text, r.start) });
  }
  return out;
}

export function brexFindings(file: string, text: string, ctx: BrexCtx): Finding[] {
  return brexIssues(text, ctx).map((i): Finding => i.kind === 'wrong-default'
    ? { id: 'brex-wrong-default', severity: 'warning', rule: 'brex-remap', file, repairable: true, message: `Names BREX ${i.dmc}, which belongs to another S1000D issue; the issue ${ctx.issue ?? '?'} default is ${i.expected}.`, data: { dmc: i.dmc, expected: i.expected, line: i.line } }
    : { id: 'brex-missing-custom', severity: 'warning', rule: 'brex-remap', file, repairable: !!ctx.neutraliseMissing, message: `Names BREX ${i.dmc}, which is not in the package: the project's business rules cannot be enforced.`, data: { dmc: i.dmc, line: i.line } });
}

export interface BrexRepairResult { text: string; changes: Array<Omit<ChangeEntry, 'seq' | 'file'>> }

export function repairBrex(text: string, ctx: BrexCtx): BrexRepairResult {
  const known = !!brexIssueKey(ctx.issue);
  const letter = expectedBrexLetter(ctx.issue);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const changes: BrexRepairResult['changes'] = [];
  for (const r of brexRefs(text)) {
    const d = BREX_DEFAULT_RE.exec(r.dmc);
    let want: Record<string, string> | null = null;
    let why = '';
    if (d && known && d[1] !== letter && !ctx.shipped.has(r.dmc)) { want = { systemDiffCode: letter }; why = 'default BREX of another issue'; }
    else if (!d && ctx.neutraliseMissing && !ctx.shipped.has(r.dmc)) {
      want = { modelIdentCode: 'S1000D', systemDiffCode: letter, systemCode: '04', subSystemCode: '1', subSubSystemCode: '0', assyCode: '0301', disassyCode: '00', disassyCodeVariant: 'A', infoCode: '022', infoCodeVariant: 'A', itemLocationCode: 'D' };
      why = 'custom BREX not in the package';
    }
    if (!want) continue;
    const next = setAttrs(r.rawAttrs, want);
    const selfClosing = text.slice(r.start, r.end).endsWith('/>');
    const replacement = `<dmCode${next}${selfClosing ? '/>' : '>'}`;
    edits.push({ start: r.start, end: r.end, replacement });
    const after = dmcFromAttrs({ ...r.attrs, ...want });
    changes.push({ rule: 'brex-remap', kind: 'edit', where: 'brexDmRef', line: lineAt(text, r.start), before: r.dmc, after: `${after} (${why})`, synthetic: !d });
  }
  if (!edits.length) return { text, changes: [] };
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return { text: out, changes };
}
