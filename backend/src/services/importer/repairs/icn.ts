// =============================================================================
// Repair rule `icn-placeholder`: artwork a module declares but the package does not contain.
//
// S1000D binds a graphic to a file in two steps: `<graphic infoEntityIdent="ICN-X"/>` names an ENTITY, and
// the DOCTYPE says `<!ENTITY ICN-X SYSTEM "ICN-X.png" NDATA png>`. A package whose DOCTYPE names a file that
// was never exported (13 in the Vektra sample) builds a PDF that stops at the first one. The importer writes
// a small labelled PLACEHOLDER PNG under the declared name and logs every one (synthetic: true) so the
// customer can see exactly which figures still have to be supplied - the build never breaks and nothing
// pretends to be the real figure.
//
// Two shapes are handled:
//   1. declared + file missing   -> placeholder file under the declared name. A declared JPEG/GIF target is
//      re-pointed at a `.png` of the same stem (a PNG carrying a .jpg name is a time bomb), with a notation.
//   2. referenced, never declared, and no file of that name exists in the package in any format
//      -> a declaration is added and the placeholder written. (A referenced ICN whose FILE is present is the
//      engine's fixEntities job and is left alone.)
// =============================================================================

import { doctypeEnd, rootTag, scanTags, parseAttrs, eolOf, lineAt } from '../xmlScan';
import type { ChangeEntry, Finding } from '../types';

export interface EntityDecl {
  name: string;
  target: string;
  notation?: string;
  start: number;
  end: number;
  /** Offsets of the quoted SYSTEM target text (inside the quotes). */
  targetStart: number;
  targetEnd: number;
  ndataStart?: number;
  ndataEnd?: number;
}

const ENTITY_RE = /<!ENTITY\s+([^\s%][^\s]*)\s+SYSTEM\s+("([^"]*)"|'([^']*)')(\s+NDATA\s+([\w.-]+))?\s*>/g;

/** The DOCTYPE region of a document: where it starts/ends, and where the internal subset closes. */
export function doctypeRegion(text: string): { start: number; end: number; subsetClose: number; subsetOpen: number } | null {
  const start = text.search(/<!DOCTYPE/i);
  const root = rootTag(text);
  if (start < 0 || (root && start > root.start)) return null;
  const end = doctypeEnd(text, start);
  const region = text.slice(start, end);
  const open = region.indexOf('[');
  const close = region.lastIndexOf(']');
  return { start, end, subsetOpen: open < 0 ? -1 : start + open, subsetClose: close < 0 ? -1 : start + close };
}

export function entityDecls(text: string): EntityDecl[] {
  const dt = doctypeRegion(text);
  if (!dt) return [];
  const sub = text.slice(dt.start, dt.end);
  const out: EntityDecl[] = [];
  ENTITY_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ENTITY_RE.exec(sub))) {
    const q = m[2];
    const tStart = dt.start + m.index + m[0].indexOf(q) + 1;
    const target = m[3] !== undefined ? m[3] : m[4];
    const nd = m[5] ? { s: dt.start + m.index + m[0].lastIndexOf(m[6]), e: dt.start + m.index + m[0].lastIndexOf(m[6]) + m[6].length } : undefined;
    out.push({ name: m[1], target, notation: m[6], start: dt.start + m.index, end: dt.start + m.index + m[0].length, targetStart: tStart, targetEnd: tStart + target.length, ndataStart: nd?.s, ndataEnd: nd?.e });
  }
  return out;
}

/**
 * A graphic target must be a file that travels WITH the package. A URL, a drive letter, an absolute path or a `..` step
 * points at something on the machine that builds the PDF; the importer refuses those rather than "repairing" them.
 */
export const isExternalTarget = (target: string): boolean =>
  /^[A-Za-z][A-Za-z0-9+.-]*:/.test(target.trim()) || /^[\/]/.test(target.trim()) || /(^|[\/])..([\/]|$)/.test(target);

export function externalTargets(text: string): EntityDecl[] {
  return entityDecls(text).filter((d) => isExternalTarget(d.target));
}

export function externalEntityFindings(file: string, text: string): Finding[] {
  return externalTargets(text).map((d): Finding => ({
    id: 'entity-external-target', severity: 'error', rule: 'package', file,
    message: `Entity ${d.name} points at "${d.target}", outside the package (a URL, an absolute path or a parent folder). The importer will not bring it in.`,
    data: { entity: d.name, target: d.target },
  }));
}

/** Every ICN a module's body refers to (`infoEntityIdent="..."`), in order of first appearance. */
export function graphicRefs(text: string): string[] {
  const root = rootTag(text);
  const body = root ? text.slice(root.start) : text;
  const seen = new Set<string>();
  for (const t of scanTags(body)) {
    if (t.kind === 'close' || !t.rawAttrs.includes('infoEntityIdent')) continue;
    const v = parseAttrs(t.rawAttrs).infoEntityIdent;
    if (v) seen.add(v);
  }
  return [...seen];
}

export const baseOf = (p: string): string => p.replace(/\\/g, '/').slice(p.replace(/\\/g, '/').lastIndexOf('/') + 1);
const stemOf = (b: string): string => b.replace(/\.[A-Za-z0-9]+$/, '');
const extOf = (b: string): string => (/\.([A-Za-z0-9]+)$/.exec(b)?.[1] ?? '').toLowerCase();

export interface FileIndex { names: Set<string>; stems: Set<string> }
/** Lower-cased base names / stems of every image in the package, for case-insensitive presence tests. */
export function fileIndex(imageBaseNames: Iterable<string>): FileIndex {
  const names = new Set<string>(); const stems = new Set<string>();
  for (const n of imageBaseNames) { names.add(n.toLowerCase()); stems.add(stemOf(n).toLowerCase()); }
  return { names, stems };
}

export interface MissingIcn {
  /** The entity / ICN name. */
  icn: string;
  /** The file name the placeholder will carry (always .png). */
  target: string;
  declared: boolean;
  /** The declared target when it differs from `target` (re-pointed). */
  declaredTarget?: string;
}

export function missingIcns(text: string, idx: FileIndex): MissingIcn[] {
  const out: MissingIcn[] = [];
  const decls = entityDecls(text);
  const declaredNames = new Set(decls.map((d) => d.name));
  for (const d of decls) {
    const isGraphic = !!d.notation || /^ICN-/i.test(d.name);
    if (!isGraphic || isExternalTarget(d.target)) continue;
    const base = baseOf(d.target);
    if (idx.names.has(base.toLowerCase())) continue;
    out.push({ icn: d.name, target: extOf(base) === 'png' ? base : `${stemOf(base)}.png`, declared: true, declaredTarget: extOf(base) === 'png' ? undefined : base });
  }
  for (const ref of graphicRefs(text)) {
    if (declaredNames.has(ref)) continue;
    if (idx.stems.has(ref.toLowerCase()) || idx.names.has(ref.toLowerCase())) continue;
    out.push({ icn: ref, target: `${ref}.png`, declared: false });
  }
  return out;
}

export function icnFindings(file: string, text: string, idx: FileIndex): Finding[] {
  return missingIcns(text, idx).map((m): Finding => ({
    id: 'icn-missing', severity: 'warning', rule: 'icn-placeholder', file, repairable: true,
    message: m.declared
      ? `Graphic ${m.icn} is declared as "${m.declaredTarget ?? m.target}" but that file is not in the package.`
      : `Graphic ${m.icn} is referenced but neither declared nor present in the package.`,
    data: { icn: m.icn, target: m.target },
  }));
}

export interface IcnRepairResult {
  text: string;
  changes: Array<Omit<ChangeEntry, 'seq' | 'file'>>;
  /** Placeholder files to create (file name only; the caller picks the folder). */
  placeholders: MissingIcn[];
}

export function repairIcn(text: string, idx: FileIndex): IcnRepairResult {
  const missing = missingIcns(text, idx);
  if (!missing.length) return { text, changes: [], placeholders: [] };
  const eol = eolOf(text);
  const decls = entityDecls(text);
  const dt = doctypeRegion(text);
  const root = rootTag(text);
  const edits: Array<{ start: number; end: number; replacement: string }> = [];
  const changes: IcnRepairResult['changes'] = [];

  // The notation every png entity will use: the module's own (any case), else a new one.
  const notations = dt ? [...text.slice(dt.start, dt.end).matchAll(/<!NOTATION\s+([\w.-]+)/g)].map((m) => m[1]) : [];
  let pngNotation = notations.find((n) => n.toLowerCase() === 'png');
  const needsNotation = !pngNotation && missing.some((m) => !m.declared || m.declaredTarget);
  if (!pngNotation) pngNotation = 'png';

  const added: string[] = [];
  for (const m of missing) {
    if (m.declared) {
      const d = decls.find((x) => x.name === m.icn);
      if (d && m.declaredTarget && d.ndataStart !== undefined && d.ndataEnd !== undefined) {
        edits.push({ start: d.targetStart, end: d.targetEnd, replacement: m.target });
        edits.push({ start: d.ndataStart, end: d.ndataEnd, replacement: pngNotation });
        changes.push({ rule: 'icn-placeholder', kind: 'edit', where: `entity ${m.icn}`, line: lineAt(text, d.start), before: `SYSTEM "${m.declaredTarget}" NDATA ${d.notation}`, after: `SYSTEM "${m.target}" NDATA ${pngNotation}`, synthetic: true });
      }
    } else {
      added.push(`<!ENTITY ${m.icn} SYSTEM "${m.target}" NDATA ${pngNotation}>`);
      changes.push({ rule: 'icn-placeholder', kind: 'edit', where: `entity ${m.icn}`, before: '(no entity declaration)', after: `<!ENTITY ${m.icn} SYSTEM "${m.target}" NDATA ${pngNotation}>`, synthetic: true });
    }
  }

  const decl: string[] = [];
  if (needsNotation) decl.push(`<!NOTATION ${pngNotation} PUBLIC "-//W3C//NOTATION Portable Network Graphics//EN" >`);
  if (decl.length || added.length) {
    if (dt && dt.subsetClose >= 0) {
      // Notation first (a declaration may not be used before it is declared in a strict reader), entities last.
      // (In an empty internal subset both land at one offset; edits at equal offsets apply in array order, so the later insertion ends up FIRST.)
      if (added.length) edits.push({ start: dt.subsetClose, end: dt.subsetClose, replacement: added.join(eol) + eol });
      if (decl.length) edits.push({ start: dt.subsetOpen + 1, end: dt.subsetOpen + 1, replacement: eol + decl.join(eol) });
    } else if (dt) {
      edits.push({ start: dt.end - 1, end: dt.end - 1, replacement: ` [${eol}${[...decl, ...added].join(eol)}${eol}]` });
    } else if (root) {
      edits.push({ start: root.start, end: root.start, replacement: `<!DOCTYPE ${root.name} [${eol}${[...decl, ...added].join(eol)}${eol}]>${eol}` });
    }
    if (decl.length) changes.push({ rule: 'icn-placeholder', kind: 'edit', where: 'DOCTYPE', before: '(no png notation)', after: decl[0], synthetic: true });
  }

  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.replacement + out.slice(e.end);
  return { text: out, changes, placeholders: missing };
}
