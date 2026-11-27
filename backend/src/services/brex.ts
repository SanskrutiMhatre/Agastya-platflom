// =============================================================================
// Brex - Business Rules EXchange checking, following S1000D Chap 4.10.
//
// WHAT BREX IS
// ------------
// An XSD says what S1000D permits. A BREX data module says what THIS PROJECT permits, which is always narrower: no `<internalRef>` inside a
// warning, only these four values for `sparePartClassCode`, and so on. A module that satisfies the schema can still be rejected on delivery for
// breaking business rules, so BREX is the second validation layer, and publication needs it as much as it needs the schema.
//
// WHAT IS CHECKED (the same layers, with the same meaning, as the Studio's browser-side check in frontend/src/studio/validation/brex.ts)
// ------------------------------------------------------------------------------------------------------------------------------
//  - context rules: `structureObjectRule` = objectPath (XPath 1.0) + allowedObjectFlag + objectValue, applied only when the rule group's
//    `rulesContext` names the schema of the module being checked
//      flag 0  the object MUST NOT appear: every node the path selects is a breach
//      flag 2  the object is allowed but its VALUE is restricted to the listed objectValues; each has a `valueForm`:
//                single   one value, or several separated by `|`
//                range    `lo~hi` (decimal bounds compare as numbers; code-like bounds such as A01~A09 or 001~999 by their number part)
//                pattern  an XML Schema regular expression
//      flag 1  allowed: nothing to enforce (the XSD gives no other meaning; the official default BREX contains no flag-1 rule)
//  - SNS rules: the module's system / sub-system / sub-sub-system / assembly code must exist in the BREX's SNS
//  - notation rules: NOTATIONs the BREX forbids may not be declared by a module's entities
//  - severity: `brSeverityLevel` brsl01 is an error, brsl02..brsl09 a warning (as in the Studio); only errors block publication
//  - layering: a project BREX normally references another BREX (usually the S1000D default); the whole chain applies
//
// WHICH BREX APPLIES TO A MODULE
// ------------------------------
// The module's own `brexDmRef`: the project's data module with that code if there is one, else the bundled official default for the issue
// (backend/brex/, the same files the Studio bundles). A module that names no BREX gets the default of its issue. A module that names a BREX that
// is neither in the project nor an official default is a PROBLEM, reported as such: its rules cannot be enforced, so it must not be published.
//
// ONLY WHAT CAN BE JUDGED IS CALLED A RESULT
// ------------------------------------------
// A rule this implementation cannot evaluate (XPath 2.0, a pattern it cannot translate) is counted and reported as not enforced; it is never
// silently dropped and never blamed on the document. A rule in the PROJECT'S OWN BREX whose XPath is simply invalid is an error in the BREX
// itself (see lintBrex), because a business rule that cannot run is a rule that silently does nothing.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { DOMParser } from '@xmldom/xmldom';
import * as xpath from 'xpath';
import { xsdRegex } from '../shared/xsdRegex';
import { valueMatches, contextApplies, isXPath2 } from '../shared/brexValues';
import { headOf } from './xmlHead';

export interface BrexValue {
  /** The permitted value(s), from `@valueAllowed`. */
  allowed: string;
  /** Human-readable gloss, the element's text. */
  label: string;
  /** single | range | pattern */
  form: string;
}

export interface BrexRule {
  /** `brDecisionIdentNumber` of the rule's `brDecisionRef`, else its `id`, else `rule-N`. */
  id: string;
  /** The XPath the rule applies to. */
  objectPath: string;
  /** 0 = must not appear, 1 = unrestricted, 2 = value restricted. */
  flag: '0' | '1' | '2';
  /** The rule's own words, cited verbatim in findings. */
  objectUse: string;
  values: BrexValue[];
  /** `brSeverityLevel` of the rule (brsl01..), when it has one. */
  severity?: string;
  /** `rulesContext` of the rule group, e.g. `descript.xsd`; null = every schema. */
  context: string | null;
}

export interface SnsNode { code: string; title: string; children: SnsNode[] }

export interface BrexModel {
  /** DMC string of this BREX data module, e.g. `DMC-S1000D-G-04-10-0301-00A-022A-D`. */
  dmc: string;
  /** Where it came from: the file name, or the label of the bundled default. */
  label: string;
  /** True for the project's own BREX, false for a bundled official default. */
  projectOwn: boolean;
  rules: BrexRule[];
  sns: SnsNode[];
  snsCheck: boolean;
  notations: Array<{ name: string; allowed: string; use: string }>;
  /** DMC of the BREX this one itself references, when it is a different one. */
  parent: string | null;
}

export interface BrexFinding {
  severity: 'error' | 'warning';
  ruleId: string;
  /** The rule's `objectUse`, unedited, plus the offending value for a restricted-value breach. */
  message: string;
  objectPath: string;
  /** Where in the document, as an element path. */
  where: string;
  /** For a flag-2 breach: what was found and what was permitted. */
  found?: string;
  allowed?: string[];
  /** Label of the BREX the rule comes from. */
  brexSource: string;
}

/** Something wrong with the BREX itself, or with finding it: not a breach by the document. */
export interface BrexProblem {
  severity: 'error' | 'warning';
  kind: 'missing-brex' | 'not-a-brex' | 'invalid-rule' | 'unenforced-rule' | 'cycle';
  brex: string;
  message: string;
  ruleId?: string;
}

export interface BrexCheckResult {
  valid: boolean;
  findings: BrexFinding[];
  /** Rules actually enforced against this module. A check that silently ran zero rules looks identical to a clean document. */
  rulesEvaluated: number;
  /** Rules whose XPath this implementation could not evaluate (XPath 2.0 or invalid). */
  rulesSkipped: number;
  skippedRules: Array<{ id: string; path: string; reason: string; brex: string }>;
  /** Value-restricting rules that do not enumerate the permitted values (prose only): real rules that are NOT enforced. */
  rulesAdvisory: number;
  /** Labels of every BREX that applied, in order. */
  brexSource: string;
}

// ── Parsing a BREX data module ───────────────────────────────────────────────

const NS: Record<string, string> = {
  xlink: 'http://www.w3.org/1999/xlink',
  xsi: 'http://www.w3.org/2001/XMLSchema-instance',
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  dc: 'http://www.purl.org/dc/elements/1.1/',
  xml: 'http://www.w3.org/XML/1998/namespace',
};
/**
 * Every XPath here goes through the PARSED-expression API with an explicit namespace map.
 *
 * Not `xpath.select(...)` / `xpath.useNamespaces(...)`: those legacy entry points ask `document.implementation.hasFeature("HTML", "2.0")`, which is
 * true for these documents, and then match element and attribute names CASE-INSENSITIVELY. XPath on XML is case-sensitive: with the legacy path
 * `@inwork` matches `inWork` (rule BREX-S1-00032 of the 5.0 default BREX literally says `attribute::inwork`), so rules fire on documents they must not
 * fire on and could just as well miss. The parsed API leaves `caseInsensitive` off unless `isHtml` is set. (Found by comparing every rule with libxml2.)
 */
interface Parsed { select(o: { node: Node; namespaces: Record<string, string> }): Node[]; select1(o: { node: Node; namespaces: Record<string, string> }): Node | undefined }
const compiled = new Map<string, Parsed>();
const compile = (expr: string): Parsed => {
  let p = compiled.get(expr);
  if (!p) { p = (xpath as unknown as { parse: (e: string) => Parsed }).parse(expr); compiled.set(expr, p); }
  return p;
};
/** Evaluate an XPath 1.0 expression and return the selected nodes (an expression that does not select nodes yields none). */
export function evaluateXPath(expr: string, node: Node): Node[] {
  const res = compile(expr).select({ node, namespaces: NS });
  return Array.isArray(res) ? res : [];
}
const select = (expr: string, ctx: Node, single?: boolean): Node | Node[] | undefined => (single ? compile(expr).select1({ node: ctx, namespaces: NS }) : evaluateXPath(expr, ctx));

const parseDoc = (xml: string): Document => new DOMParser({ onError: () => {} }).parseFromString(xml, 'text/xml') as unknown as Document;
const text = (n: Node | null | undefined): string => (n?.textContent ?? '').replace(/\s+/g, ' ').trim();
const kids = (el: Element, name: string): Element[] => Array.from(el.childNodes as unknown as ArrayLike<Node>).filter((c) => c.nodeType === 1 && (c as Element).nodeName === name) as Element[];
const one = (expr: string, ctx: Node): Element | null => (select(expr, ctx, true) as Element | undefined) ?? null;
const many = (expr: string, ctx: Node): Element[] => { const r = select(expr, ctx); return Array.isArray(r) ? (r as Element[]) : []; };

/** `DMC-S1000D-G-04-10-0301-00A-022A-D` from a dmCode element. */
export function dmcOf(code: Element | null | undefined): string | null {
  if (!code) return null;
  const a = (n: string) => code.getAttribute(n) ?? '';
  if (!a('modelIdentCode')) return null;
  return `DMC-${[a('modelIdentCode'), a('systemDiffCode'), a('systemCode'), `${a('subSystemCode')}${a('subSubSystemCode')}`, a('assyCode'), `${a('disassyCode')}${a('disassyCodeVariant')}`, `${a('infoCode')}${a('infoCodeVariant')}`, a('itemLocationCode')].join('-')}`.toUpperCase();
}

/** The BREX data module a document declares, as a DMC string. */
export function declaredBrexDmc(xml: string): string | null {
  const ref = /<brexDmRef>[\s\S]*?<\/brexDmRef>/.exec(headOf(xml, 'dmodule', 20000));
  if (!ref) return null;
  const code = /<dmCode\b[^>]*>/.exec(ref[0]);
  if (!code) return null;
  const el = parseDoc(`<r>${code[0].endsWith('/>') ? code[0] : code[0] + '</dmCode>'}</r>`).documentElement.firstChild as Element | null;
  return dmcOf(el);
}

/** The issue a document declares through its schema reference, as the wizard writes it (`4-2`, `5-0`, `6`, `7`), or null. */
export function declaredIssue(xml: string): string | null {
  const m = /S1000D[_-]?(\d+)(?:-(\d+))?\//i.exec(xml.slice(0, 4000));
  if (!m) return null;
  return m[2] === undefined || m[2] === '0' ? (m[1] === '5' ? '5-0' : m[1]) : `${m[1]}-${m[2]}`;
}

/** The schema file name a document declares (`descript`), or null. */
export function declaredSchemaName(xml: string): string | null {
  const m = /noNamespaceSchemaLocation\s*=\s*"[^"]*\/([a-zA-Z]+)\.xsd"/.exec(xml.slice(0, 4000));
  return m ? m[1] : null;
}

/**
 * Parse a BREX data module. Throws when it is not one (no `<brex>` element).
 *
 * `<nonContextRules>` are not read: they are rules about BREX data modules themselves, and applying them to an ordinary module would produce
 * findings that make no sense against it.
 */
export function parseBrexModel(brexXml: string, label: string, projectOwn: boolean): BrexModel {
  const doc = parseDoc(brexXml);
  const root = doc.documentElement as unknown as Element;
  const brexEl = root ? one('//brex', root) : null;
  if (!root || !brexEl) throw new Error('not a BREX data module (no <brex> element)');
  const rules: BrexRule[] = [];
  let n = 0;
  for (const ctx of many('.//contextRules', brexEl)) {
    const rc = ctx.getAttribute('rulesContext');
    for (const r of many('.//structureObjectRule', ctx)) {
      n++;
      const op = kids(r, 'objectPath')[0];
      const objectPath = text(op);
      if (!objectPath) { rules.push({ id: r.getAttribute('id') ?? `rule-${n}`, objectPath: '', flag: '1', objectUse: text(kids(r, 'objectUse')[0]), values: [], context: rc }); continue; }
      const flagRaw = op.getAttribute('allowedObjectFlag') ?? '2';
      const dec = kids(r, 'brDecisionRef')[0];
      rules.push({
        id: dec?.getAttribute('brDecisionIdentNumber') ?? r.getAttribute('id') ?? `rule-${n}`,
        objectPath,
        flag: (flagRaw === '0' || flagRaw === '1' || flagRaw === '2' ? flagRaw : '2') as BrexRule['flag'],
        objectUse: text(kids(r, 'objectUse')[0]),
        values: kids(r, 'objectValue').map((v) => ({ allowed: v.getAttribute('valueAllowed') ?? '', label: text(v), form: v.getAttribute('valueForm') ?? 'single' })),
        severity: r.getAttribute('brSeverityLevel') ?? undefined,
        context: rc,
      });
    }
  }

  const sns: SnsNode[] = [];
  const snsRules = one('.//snsRules', brexEl);
  const mk = (el: Element, level: string[]): SnsNode => ({
    code: text(kids(el, 'snsCode')[0]),
    title: text(kids(el, 'snsTitle')[0]),
    children: level.length ? kids(el, level[0]).map((c) => mk(c, level.slice(1))) : [],
  });
  if (snsRules) {
    const descr = one('.//snsDescr', snsRules);
    if (descr) for (const s of kids(descr, 'snsSystem')) sns.push(mk(s, ['snsSubSystem', 'snsSubSubSystem', 'snsAssy']));
  }

  const notations: BrexModel['notations'] = [];
  for (const nr of many('.//notationRule', brexEl)) {
    const nn = kids(nr, 'notationName')[0];
    if (nn) notations.push({ name: text(nn), allowed: nn.getAttribute('allowedNotationFlag') ?? '1', use: text(kids(nr, 'objectUse')[0]) });
  }

  const self = dmcOf(one('.//dmIdent/dmCode', root)) ?? '';
  const parentRef = one('.//dmStatus/brexDmRef//dmCode', root);
  const parent = dmcOf(parentRef);
  return { dmc: self, label, projectOwn, rules, sns, snsCheck: !!snsRules && sns.length > 0, notations, parent: parent && parent !== self ? parent : null };
}

/** The rules of a BREX data module (kept for callers and tests that only want the rules). */
export function parseBrex(brexXml: string): BrexRule[] {
  return parseBrexModel(brexXml, 'BREX', true).rules;
}

const modelCache = new Map<string, BrexModel>();
/** `parseBrexModel`, memoised on the CONTENT (parsing the official BREX is ~0.5 s and gives the same answer every time; an edited project BREX must not be served stale). */
export function parseBrexCached(brexXml: string, label: string, projectOwn = true): BrexModel {
  const key = `${crypto.createHash('sha1').update(brexXml).digest('hex')}:${label}:${projectOwn ? 'p' : 'd'}`;
  const hit = modelCache.get(key);
  if (hit) return hit;
  const model = parseBrexModel(brexXml, label, projectOwn);
  modelCache.set(key, model);
  return model;
}

// ── Making a BREX's XPath evaluable ──────────────────────────────────────────

const XPATH_FUNCTIONS = [
  'last', 'position', 'count', 'id', 'local-name', 'namespace-uri', 'name', 'string', 'concat', 'starts-with', 'contains', 'substring-before',
  'substring-after', 'substring', 'string-length', 'normalize-space', 'translate', 'boolean', 'not', 'true', 'false', 'lang', 'number', 'sum',
  'floor', 'ceiling', 'round',
];
const FUNCTION_SPACE = new RegExp(`\\b(${XPATH_FUNCTIONS.join('|')})\\s+\\(`, 'g');

/**
 * Close the gap between a function name and its opening parenthesis. The official BREX contains `and not (attribute::internalRefId = ...)`
 * (rule BREX-S1-00049): XPath 1.0 permits the space, the `xpath` package's parser does not and would reject the whole rule. The repair is limited
 * to the 27 XPath 1.0 function names because collapsing whitespace before ANY `(` turns the operators `and (` / `or (` into invented function calls.
 */
export function repairXPath(expr: string): string {
  return expr.replace(FUNCTION_SPACE, '$1(');
}

/** XPath 2.0 constructs this XPath 1.0 engine does not have (shared with the Studio: backend/src/shared/brexValues.ts, WP-16). */
export { isXPath2 };

// ── Value forms ──────────────────────────────────────────────────────────────

// valueMatches is shared with the Studio (backend/src/shared/brexValues.ts, WP-16 ARC-008): one definition for both engines.
export { valueMatches };

// ── Checking a document ──────────────────────────────────────────────────────

/** A readable location for a node, e.g. `dmodule/content/description/para[2]`. */
function locate(node: Node): string {
  const parts: string[] = [];
  let cur: Node | null = node;
  while (cur && cur.nodeType !== 9) {
    if (cur.nodeType === 2) {
      const attr = cur as Attr;
      parts.unshift(`@${attr.name}`);
      const owner: Node | null = attr.ownerElement as Node | null;
      cur = owner;
      continue;
    }
    if (cur.nodeType === 1) {
      const el = cur as Element;
      const parent = el.parentNode as Element | null;
      let index = 0, count = 0;
      if (parent?.childNodes) {
        for (let i = 0; i < parent.childNodes.length; i++) {
          const sib = parent.childNodes[i] as Element;
          if (sib.nodeType === 1 && sib.nodeName === el.nodeName) { count++; if (sib === el) index = count; }
        }
      }
      parts.unshift(count > 1 ? `${el.nodeName}[${index}]` : el.nodeName);
    }
    cur = cur.parentNode;
  }
  return parts.join('/');
}

const valueOf = (node: Node): string => (node.nodeType === 2 ? (node as Attr).value : (node.textContent ?? '')).trim();

/** How many nodes a rule's objectPath selects in a document, or null when it cannot be evaluated here (XPath 2.0, a parse error). For tests and diagnostics. */
export function matchCount(documentXml: string, objectPath: string): number | null {
  if (isXPath2(objectPath)) return null;
  try {
    return evaluateXPath(repairXPath(objectPath), parseDoc(documentXml) as unknown as Node).length;
  } catch { return null; }
}

const CAP = 100; // findings reported per rule: a rule that selects thousands of nodes does not need thousands of lines

/** Evaluate every BREX of the chain against one data module. `models` are in order (the module's BREX first, then its parents). */
export function checkBrexModels(documentXml: string, models: BrexModel[]): BrexCheckResult {
  const doc = parseDoc(documentXml) as unknown as Node;
  const schema = declaredSchemaName(documentXml);
  const findings: BrexFinding[] = [];
  const skippedRules: BrexCheckResult['skippedRules'] = [];
  let evaluated = 0;
  let advisory = 0;
  const code = (select('//dmIdent/dmCode', doc, true) as Element | undefined) ?? null;
  const entityNotations = new Set<string>();
  for (const m of documentXml.slice(0, 200000).matchAll(/<!ENTITY\s+\S+\s+(?:SYSTEM|PUBLIC)\s+(?:"[^"]*"|'[^']*')(?:\s+(?:"[^"]*"|'[^']*'))?\s+NDATA\s+([^\s>]+)/g)) entityNotations.add(m[1]);

  for (const b of models) {
    for (const rule of b.rules) {
      if (!rule.objectPath || !contextApplies(rule.context, schema)) continue;
      if (rule.flag === '1') continue;                                   // nothing to enforce (see the header)
      if (isXPath2(rule.objectPath)) { skippedRules.push({ id: rule.id, path: rule.objectPath, reason: 'XPath 2.0 expression', brex: b.label }); continue; }
      let nodes: Node[];
      try {
        nodes = evaluateXPath(repairXPath(rule.objectPath), doc);
      } catch (e) {
        skippedRules.push({ id: rule.id, path: rule.objectPath, reason: (e as Error).message, brex: b.label });
        continue;
      }
      evaluated++;
      const sev: BrexFinding['severity'] = rule.severity && /^brsl0[2-9]$/.test(rule.severity) ? 'warning' : 'error';
      const use = rule.objectUse || `BREX rule ${rule.id}`;
      if (nodes.length === 0) continue;

      if (rule.flag === '0') {
        for (const node of nodes.slice(0, CAP)) findings.push({ severity: sev, ruleId: rule.id, message: use, objectPath: rule.objectPath, where: locate(node), brexSource: b.label });
        continue;
      }
      // flag 2: present is fine, the VALUE is what is constrained
      if (rule.values.length === 0) { advisory++; continue; }
      const unevaluable = rule.values.filter((ov) => ov.form === 'pattern' && !xsdRegex(ov.allowed));
      if (unevaluable.length) {
        // a value we cannot test might be the one that allows it: report the gap instead of passing or failing silently
        skippedRules.push({ id: rule.id, path: rule.objectPath, reason: `Value pattern cannot be evaluated here: ${unevaluable.map((u) => u.allowed).join(' | ')}`, brex: b.label });
        continue;
      }
      let count = 0;
      for (const node of nodes) {
        const actual = valueOf(node);
        if (rule.values.some((ov) => valueMatches(actual, ov))) continue;
        if (count++ >= CAP) break;
        const gloss = rule.values.slice(0, 12).map((v) => (v.label ? `${v.allowed} (${v.label})` : v.allowed)).join(', ') + (rule.values.length > 12 ? ', ...' : '');
        findings.push({
          severity: sev, ruleId: rule.id,
          message: `${use} - "${actual}" is not one of the permitted values: ${gloss}`,
          objectPath: rule.objectPath, where: locate(node), found: actual, allowed: rule.values.map((v) => v.allowed), brexSource: b.label,
        });
      }
    }

    // SNS rules
    if (b.snsCheck && code) {
      const c = (n: string) => code.getAttribute(n) ?? '';
      const fail = (what: string) => findings.push({ severity: 'error', ruleId: 'SNS', message: `SNS ${what} is not defined in the BREX SNS rules (${b.dmc}).`, objectPath: '//dmIdent/dmCode', where: locate(code), brexSource: b.label });
      const sys = b.sns.find((s) => s.code === c('systemCode'));
      if (!sys) fail(`system code "${c('systemCode')}"`);
      else {
        const sub = sys.children.find((s) => s.code === c('subSystemCode'));
        if (sys.children.length && !sub) fail(`subsystem "${c('systemCode')}-${c('subSystemCode')}"`);
        else if (sub) {
          const subsub = sub.children.find((s) => s.code === c('subSubSystemCode'));
          if (sub.children.length && !subsub) fail(`sub-subsystem "${c('systemCode')}-${c('subSystemCode')}${c('subSubSystemCode')}"`);
          else if (subsub && subsub.children.length && !subsub.children.find((s) => s.code === c('assyCode'))) fail(`assembly "${c('systemCode')}-${c('subSystemCode')}${c('subSubSystemCode')}-${c('assyCode')}"`);
        }
      }
    }
    // notation rules
    for (const nr of b.notations) {
      if (nr.allowed === '0' && entityNotations.has(nr.name)) {
        findings.push({ severity: 'error', ruleId: 'NOTATION', message: `Notation "${nr.name}" is not allowed. ${nr.use}`.trim(), objectPath: '//notationRule', where: 'dmodule', brexSource: b.label });
      }
    }
  }

  return {
    valid: !findings.some((f) => f.severity === 'error'),
    findings,
    rulesEvaluated: evaluated - advisory,
    rulesSkipped: skippedRules.length,
    skippedRules,
    rulesAdvisory: advisory,
    brexSource: models.map((m) => m.label).join(' + '),
  };
}

/** One BREX, one module: the previous entry point, kept for callers and tests that already hold a single model. */
export function checkBrex(documentXml: string, model: BrexModel | BrexRule[], brexSource = 'BREX'): BrexCheckResult {
  const m: BrexModel = Array.isArray(model) ? { dmc: '', label: brexSource, projectOwn: true, rules: model, sns: [], snsCheck: false, notations: [], parent: null } : model;
  return checkBrexModels(documentXml, [m]);
}

// ── Is the BREX itself usable? ───────────────────────────────────────────────

/**
 * Problems in a BREX's own rules. A business rule that cannot run is a rule that silently does nothing, so for the PROJECT'S OWN BREX:
 *   error    a rule without an objectPath, or whose XPath is not valid XPath at all
 *   warning  an XPath 2.0 rule, a value pattern this engine cannot translate, a restriction that names no values: real rules that are not enforced
 * The bundled official defaults are not linted: they are not the project's to fix (their unenforceable rules are counted in each check result).
 */
export function lintBrex(model: BrexModel): BrexProblem[] {
  const out: BrexProblem[] = [];
  for (const r of model.rules) {
    const where = { brex: model.label, ruleId: r.id };
    if (!r.objectPath) { out.push({ severity: 'error', kind: 'invalid-rule', ...where, message: `BREX rule ${r.id} has no objectPath, so it can never apply.` }); continue; }
    if (r.flag === '1') continue;
    if (isXPath2(r.objectPath)) { out.push({ severity: 'warning', kind: 'unenforced-rule', ...where, message: `BREX rule ${r.id} uses XPath 2.0 (${r.objectPath}), which is not evaluated here: it is NOT enforced.` }); continue; }
    try { (xpath as unknown as { parse: (e: string) => unknown }).parse(repairXPath(r.objectPath)); }
    catch (e) { out.push({ severity: 'error', kind: 'invalid-rule', ...where, message: `BREX rule ${r.id} has an invalid XPath (${r.objectPath}): ${(e as Error).message.replace(/\s+/g, ' ').slice(0, 160)}` }); continue; }
    if (r.flag === '2') {
      if (r.values.length === 0) out.push({ severity: 'warning', kind: 'unenforced-rule', ...where, message: `BREX rule ${r.id} restricts values (${r.objectPath}) but lists none: it is NOT enforced.` });
      for (const v of r.values) {
        if (v.form === 'pattern' && !xsdRegex(v.allowed)) out.push({ severity: 'warning', kind: 'unenforced-rule', ...where, message: `BREX rule ${r.id} has a value pattern that cannot be evaluated here (${v.allowed}): it is NOT enforced.` });
      }
    }
  }
  return out;
}

// ── Choosing which BREX applies ──────────────────────────────────────────────

const brexDir = () => path.join(__dirname, '..', '..', 'brex');

/** The issue each bundled default belongs to, keyed by the systemDiffCode of its DMC (S1000D-<letter>-04-10-0301-00A-022A-D). */
const DEFAULT_BY_LETTER: Record<string, string> = { F: '4-2', G: '5-0', H: '6', J: '7' };
const DEFAULT_LETTER_FOR_ISSUE: Record<string, string> = { '4-2': 'F', '5-0': 'G', '6': 'H', '7': 'J' };
const defaultFile = (letter: string): string => path.join(brexDir(), `DMC-S1000D-${letter}-04-10-0301-00A-022A-D_001-00_EN-US.XML`);
const DEFAULT_DMC = /^DMC-S1000D-([A-Z])-04-10-0301-00A-022A-D$/;

/** The default BREX letter for an issue; an unknown or older issue falls back to the oldest supported default. */
export function defaultLetterFor(issue: string | null): string { return (issue && DEFAULT_LETTER_FOR_ISSUE[issue]) || 'F'; }
/** The bundled default's letter for an issue as the project setting writes it ("4.2", "5.0", "6.0", "7.0"; also "4-2", "6"), or null for auto / unknown. */
export function letterForIssueSetting(setting: string | null | undefined): string | null {
  if (!setting || setting === 'auto') return null;
  const k = String(setting).replace('.', '-').replace(/^(6|7)-0$/, '$1');
  // no default BREX is bundled before 4.2: the oldest one stands in (the note on the result says so)
  return DEFAULT_LETTER_FOR_ISSUE[k] ?? (/^(3|4)-\d$/.test(k) ? 'F' : null);
}
export const bundledDefaultIssues = (): string[] => Object.values(DEFAULT_BY_LETTER);

export interface BrexResolution {
  /** In application order: the module's own BREX, then the BREX that one references, and so on. */
  models: BrexModel[];
  problems: BrexProblem[];
  /** Plain-language remarks (a default was substituted, ...). */
  notes: string[];
}

function findProjectBrex(csdbDir: string | undefined, dmc: string): { xml: string; label: string } | null {
  if (!csdbDir || !fs.existsSync(csdbDir)) return null;
  const wanted = dmc.toUpperCase();
  const hits = fs.readdirSync(csdbDir).filter((f) => /\.xml$/i.test(f) && f.toUpperCase().startsWith(wanted)).sort();
  if (!hits.length) return null;
  const f = hits[hits.length - 1];                                       // several issues of the same BREX: the latest
  try { return { xml: fs.readFileSync(path.join(csdbDir, f), 'utf8'), label: f }; } catch { return null; }
}

/**
 * Resolve the chain of BREX data modules that apply to a document.
 *
 * For each BREX named (the module's, then the parent each BREX names in its own `brexDmRef`): the project's data module with that code; else
 * the bundled official default of that code; else, for an unknown S1000D default letter, the default of the module's issue (with a note);
 * else (a custom code that is not in the project) a PROBLEM: the project's rules cannot be enforced.
 */
export function resolveBrexChain(documentXml: string, csdbDir?: string, forceIssue?: string | null): BrexResolution {
  const issue = declaredIssue(documentXml);
  // The project can fix the S1000D issue its checks use (Validation page). It replaces the S1000D DEFAULT business rules only:
  // a BREX data module the project itself holds is always used as it is.
  const forced = letterForIssueSetting(forceIssue);
  const letter = forced ?? defaultLetterFor(issue);
  const res: BrexResolution = { models: [], problems: [], notes: [] };
  const declared = declaredBrexDmc(documentXml);
  const seen = new Set<string>();

  const loadDefault = (l: string, why?: string): BrexModel | null => {
    const file = defaultFile(l);
    if (!fs.existsSync(file)) { res.problems.push({ severity: 'error', kind: 'missing-brex', brex: `S1000D default BREX (${l})`, message: `The bundled S1000D default BREX (${path.basename(file)}) is missing from this installation.` }); return null; }
    if (why) res.notes.push(why);
    return parseBrexCached(fs.readFileSync(file, 'utf8'), `S1000D default BREX (issue ${(DEFAULT_BY_LETTER[l] ?? issue ?? '?').replace('-', '.')})`, false);
  };

  let next: string | null = declared;
  let first = true;
  for (let depth = 0; depth < 6; depth++) {
    let model: BrexModel | null = null;
    if (next === null) {
      if (!first) break;
      model = loadDefault(letter, 'This module names no BREX, so the S1000D default business rules of its issue were used.');
    } else {
      if (seen.has(next)) { res.problems.push({ severity: 'error', kind: 'cycle', brex: next, message: `The BREX chain loops back to ${next}.` }); break; }
      seen.add(next);
      const own = findProjectBrex(csdbDir, next);
      if (own) {
        try { model = parseBrexCached(own.xml, own.label, true); }
        catch (e) { res.problems.push({ severity: 'error', kind: 'not-a-brex', brex: own.label, message: `${own.label} is named as a BREX but is not one: ${(e as Error).message}.` }); break; }
      } else {
        const d = DEFAULT_DMC.exec(next);
        if (d && forced) model = loadDefault(forced, `The S1000D default BREX of the project's chosen issue (${forceIssue}) was used instead of the one the module names (${next})${DEFAULT_BY_LETTER[forced].replace('-', '.') !== String(forceIssue) ? `; no default BREX is bundled for that issue, so the ${DEFAULT_BY_LETTER[forced].replace('-', '.')} default stands in` : ''}.`);
        else if (d && fs.existsSync(defaultFile(d[1]))) model = loadDefault(d[1]);
        else if (d) model = loadDefault(letter, `The BREX ${next} is an older S1000D default that is not bundled; the default of this module's issue was used instead.`);
        else {
          res.problems.push({ severity: 'error', kind: 'missing-brex', brex: next, message: `The BREX data module ${next} named by this ${first ? 'module' : 'BREX'} is not in the project, so the project's business rules cannot be enforced.` });
          break;
        }
      }
    }
    if (!model) break;
    res.models.push(model);
    first = false;
    next = model.parent;
    if (!next) break;
  }
  return res;
}

export interface BrexSource { xml: string; label: string; projectOwn: boolean; note?: string }

/**
 * The single BREX the document names (project's own, else the bundled default of its issue): the original entry point, kept for callers that
 * want one source. New code uses `resolveBrexChain`, which also follows the BREX's own parents.
 */
export function resolveBrex(documentXml: string, csdbDirPath?: string): BrexSource | null {
  const chain = resolveBrexChain(documentXml, csdbDirPath);
  const m = chain.models[0];
  if (!m) return null;
  const file = m.projectOwn ? path.join(csdbDirPath ?? '', m.label) : defaultFile(defaultLetterFor(declaredIssue(documentXml)));
  try { return { xml: fs.readFileSync(file, 'utf8'), label: m.label, projectOwn: m.projectOwn, note: chain.notes[0] }; } catch { return null; }
}

/** Everything about checking ONE data module: the BREX chain, problems with it, and the module's own findings. */
export interface ModuleBrexReport {
  /** The BREX data modules that applied, in order. */
  models: BrexModel[];
  result: BrexCheckResult;
  problems: BrexProblem[];
  notes: string[];
}

const lintCache = new Map<string, BrexProblem[]>();

export function checkModuleBrex(documentXml: string, csdbDir?: string, forceIssue?: string | null): ModuleBrexReport {
  const chain = resolveBrexChain(documentXml, csdbDir, forceIssue);
  const problems = [...chain.problems];
  for (const m of chain.models) {
    if (!m.projectOwn) continue;
    const key = crypto.createHash('sha1').update(m.label + JSON.stringify(m.rules)).digest('hex');
    let lint = lintCache.get(key);
    if (!lint) { lint = lintBrex(m); lintCache.set(key, lint); }
    problems.push(...lint);
  }
  const result = chain.models.length ? checkBrexModels(documentXml, chain.models) : { valid: true, findings: [], rulesEvaluated: 0, rulesSkipped: 0, skippedRules: [], rulesAdvisory: 0, brexSource: '' };
  return { models: chain.models, result, problems, notes: chain.notes };
}
