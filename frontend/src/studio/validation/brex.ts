/**
 * BREX (Business Rules EXchange) checking, following S1000D Chap 4.10:
 *  - context rules (structureObjectRule: objectPath + allowedObjectFlag + objectValue),
 *    applied only when rulesContext matches the checked document's schema;
 *  - SNS rules (systemCode / subSystemCode / subSubSystemCode / assyCode);
 *  - notation rules (allowed NOTATIONs for graphics/multimedia entities);
 *  - layered BREX (project BREX referencing the S1000D default BREX).
 * XPath is evaluated with the browser's XPath 1.0 engine; rules using XPath 2.0
 * syntax are reported as skipped.
 */
import { NS, nodePath } from '../core/xml';
import type { Doctype } from '../core/xml';
import { xsdRegex } from '../core/xsdRegex';
import { DmCodeParts, find, formatDmc, readDmCode } from '../core/s1000d';
import type { ValidationIssue } from './types';

export interface BrexValue { form: string; allowed: string; text: string }

export interface BrexRule {
  id: string;
  path: string;
  flag: string;
  use: string;
  values: BrexValue[];
  severity?: string;
  context: string | null;
}

export interface SnsNode { code: string; title: string; children: SnsNode[] }

export interface BrexDoc {
  dmc: string;
  code: DmCodeParts | null;
  rules: BrexRule[];
  sns: SnsNode[];
  snsCheck: boolean;
  notations: { name: string; allowed: string; use: string }[];
  parent: DmCodeParts | null;
}

function text(el: Element | null | undefined): string {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function kids(el: Element, name: string): Element[] {
  return Array.from(el.children).filter((c) => c.nodeName === name);
}

export function parseBrex(doc: Document): BrexDoc {
  const root = doc.documentElement;
  const ident = find(root, 'dmIdent');
  const code = readDmCode(ident ? find(ident, 'dmCode') : null);
  const brexEl = find(root, 'brex');
  if (!brexEl) throw new Error('The document is not a BREX data module (no <brex> element)');
  const rules: BrexRule[] = [];
  let n = 0;
  for (const ctx of Array.from(brexEl.getElementsByTagName('contextRules'))) {
    const rc = ctx.getAttribute('rulesContext');
    for (const r of Array.from(ctx.getElementsByTagName('structureObjectRule'))) {
      n++;
      const op = kids(r, 'objectPath')[0];
      if (!op) continue;
      const dec = kids(r, 'brDecisionRef')[0];
      rules.push({
        id: dec?.getAttribute('brDecisionIdentNumber') ?? r.getAttribute('id') ?? `rule-${n}`,
        path: text(op),
        flag: op.getAttribute('allowedObjectFlag') ?? '2',
        use: text(kids(r, 'objectUse')[0]),
        values: kids(r, 'objectValue').map((v) => ({ form: v.getAttribute('valueForm') ?? 'single', allowed: v.getAttribute('valueAllowed') ?? '', text: text(v) })),
        severity: r.getAttribute('brSeverityLevel') ?? undefined,
        context: rc,
      });
    }
  }
  const sns: SnsNode[] = [];
  const snsRules = find(brexEl, 'snsRules');
  const mk = (el: Element, level: string[]): SnsNode => {
    const codeEl = kids(el, 'snsCode')[0];
    const child = level.length ? level[0] : null;
    return {
      code: text(codeEl),
      title: text(kids(el, 'snsTitle')[0]),
      children: child ? kids(el, child).map((c) => mk(c, level.slice(1))) : [],
    };
  };
  if (snsRules) {
    const descr = find(snsRules, 'snsDescr');
    if (descr) for (const s of kids(descr, 'snsSystem')) sns.push(mk(s, ['snsSubSystem', 'snsSubSubSystem', 'snsAssy']));
  }
  const notations: BrexDoc['notations'] = [];
  for (const nr of Array.from(brexEl.getElementsByTagName('notationRule'))) {
    const nn = kids(nr, 'notationName')[0];
    if (!nn) continue;
    notations.push({ name: text(nn), allowed: nn.getAttribute('allowedNotationFlag') ?? '1', use: text(kids(nr, 'objectUse')[0]) });
  }
  const status = find(root, 'dmStatus');
  const brexRef = status ? find(status, 'brexDmRef') : null;
  const parent = readDmCode(brexRef ? find(brexRef, 'dmCode') : null);
  const self = code ? formatDmc(code) : '';
  return {
    dmc: self,
    code,
    rules,
    sns,
    snsCheck: !!snsRules && sns.length > 0,
    notations,
    parent: parent && formatDmc(parent) !== self ? parent : null,
  };
}

const NS_MAP: Record<string, string> = { xlink: NS.xlink, xsi: NS.xsi, rdf: NS.rdf, dc: NS.dc, xml: NS.xml };
const resolver = (p: string | null) => (p ? NS_MAP[p] ?? null : null);

function nodeValue(n: Node): string {
  if (n.nodeType === 2) return (n as Attr).value;
  return n.textContent ?? '';
}

function splitNum(s: string): [string, number] | null {
  const m = s.match(/^(.*?)(\d+)$/);
  return m ? [m[1], parseInt(m[2], 10)] : null;
}

const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)$/;

export function valueMatches(value: string, v: BrexValue): boolean {
  switch (v.form) {
    case 'range': {
      const [lo, hi] = v.allowed.split('~');
      if (hi == null) return value === lo;
      // decimal bounds ("0.5~2.5") compare as numbers; the code-like ranges below ("A01~A09", "001~999") compare by their number part
      if (DECIMAL.test(lo) && DECIMAL.test(hi) && (lo.includes('.') || hi.includes('.') || value.includes('.'))) {
        if (!DECIMAL.test(value)) return false;
        const n = parseFloat(value);
        return n >= parseFloat(lo) && n <= parseFloat(hi);
      }
      const a = splitNum(lo);
      const b = splitNum(hi);
      const x = splitNum(value);
      if (a && b && x && a[0] === b[0] && x[0] === a[0]) return x[1] >= a[1] && x[1] <= b[1];
      return value >= lo && value <= hi && value.length === lo.length;
    }
    case 'pattern': {
      const re = xsdRegex(v.allowed);
      return re ? re.test(value) : true; // checkBrex reports the patterns it cannot evaluate; here they cannot reject anything
    }
    default:
      return v.allowed.split('|').some((a) => a === value);
  }
}

function contextApplies(context: string | null, schema: string | null): boolean {
  if (!context) return true;
  const m = context.match(/([a-zA-Z]+)\.xsd\s*$/);
  if (!m || !schema) return true;
  return m[1] === schema;
}

export interface BrexCheckResult {
  issues: ValidationIssue[];
  rules: number;
  skipped: number;
  skippedRules: { id: string; path: string; reason: string }[];
}

function isXPath2(path: string): boolean {
  return /\b(for|some|every)\s+\$|\bif\s*\(|\b(matches|tokenize|replace|ends-with|lower-case|upper-case|exists|empty|distinct-values|string-join|matches)\s*\(|\s(eq|ne|lt|le|gt|ge)\s/.test(path);
}

/** Evaluates an XPath 1.0 expression returning nodes in document order. */
export type XPathEvaluator = (expr: string, doc: Document, resolve: (prefix: string | null) => string | null) => Node[];

export const nativeEvaluator: XPathEvaluator = (expr, doc, resolve) => {
  const res = doc.evaluate(expr, doc, resolve as XPathNSResolver, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
  const nodes: Node[] = [];
  for (let i = 0; i < res.snapshotLength; i++) nodes.push(res.snapshotItem(i)!);
  return nodes;
};

export function checkBrex(target: Document, brexDocs: BrexDoc[], opts: { schema: string | null; doctype: Doctype | null; evaluate?: XPathEvaluator }): BrexCheckResult {
  const issues: ValidationIssue[] = [];
  let rules = 0;
  let skipped = 0;
  const skippedRules: BrexCheckResult['skippedRules'] = [];
  const evaluate: XPathEvaluator | null = opts.evaluate ?? (typeof target.evaluate === "function" ? nativeEvaluator : null);
  for (const b of brexDocs) {
    for (const r of b.rules) {
      if (!contextApplies(r.context, opts.schema)) continue;
      rules++;
      if (isXPath2(r.path) || !evaluate) {
        skipped++;
        skippedRules.push({ id: r.id, path: r.path, reason: 'XPath 2.0 expression' });
        continue;
      }
      let nodes: Node[];
      try {
        nodes = evaluate(r.path, target, resolver);
      } catch (e) {
        skipped++;
        skippedRules.push({ id: r.id, path: r.path, reason: (e as Error).message });
        continue;
      }
      const sev: ValidationIssue['severity'] = r.severity && /brsl0[2-9]/.test(r.severity) ? 'warning' : 'error';
      const msgBase = r.use || `BREX rule ${r.id}`;
      if (r.flag === '0') {
        for (const n of nodes.slice(0, 100)) {
          issues.push({ severity: sev, source: 'brex', message: msgBase, node: n.nodeType === 2 ? (n as Attr).ownerElement : n, path: nodePath(n.nodeType === 2 ? (n as Attr).ownerElement! : n), ruleId: r.id, detail: `Prohibited object: ${r.path}` });
        }
      } else if (r.flag === '1' && nodes.length === 0) {
        issues.push({ severity: sev, source: 'brex', message: msgBase, ruleId: r.id, detail: `Required object missing: ${r.path}`, node: target.documentElement });
      }
      const unevaluable = r.values.filter((ov) => ov.form === 'pattern' && !xsdRegex(ov.allowed));
      if (unevaluable.length && r.flag !== '0' && nodes.length) {
        // a value we cannot test might be the one that allows it: report the gap instead of passing or failing silently
        skipped++;
        skippedRules.push({ id: r.id, path: r.path, reason: `Value pattern cannot be evaluated here: ${unevaluable.map((u) => u.allowed).join(' | ')}` });
      } else if (r.flag !== '0' && r.values.length && nodes.length) {
        let count = 0;
        for (const n of nodes) {
          const v = nodeValue(n);
          if (!r.values.some((ov) => valueMatches(v, ov))) {
            if (count++ > 100) break;
            const el = n.nodeType === 2 ? (n as Attr).ownerElement : (n as Element);
            const name = n.nodeType === 2 ? '@' + (n as Attr).name : n.nodeName;
            const allowed = r.values.map((x) => x.allowed + (x.text ? ` (${x.text})` : '')).slice(0, 12).join(', ');
            issues.push({
              severity: sev,
              source: 'brex',
              message: `${name} value "${v}" is not allowed. ${msgBase}`.trim(),
              node: el,
              path: el ? nodePath(el) + (n.nodeType === 2 ? '/' + name : '') : undefined,
              ruleId: r.id,
              detail: `Allowed: ${allowed}${r.values.length > 12 ? ', …' : ''}`,
            });
          }
        }
      }
    }
    // SNS
    if (b.snsCheck) {
      const code = readDmCode(find(target.documentElement, 'dmIdent') ? find(find(target.documentElement, 'dmIdent'), 'dmCode') : null);
      if (code) {
        const sys = b.sns.find((s) => s.code === code.systemCode);
        const fail = (what: string) =>
          issues.push({ severity: 'error', source: 'brex', message: `SNS ${what} is not defined in the BREX SNS rules (${b.dmc}).`, node: find(target.documentElement, 'dmCode'), ruleId: 'SNS' });
        if (!sys) fail(`system code "${code.systemCode}"`);
        else {
          const sub = sys.children.find((s) => s.code === code.subSystemCode);
          if (sys.children.length && !sub) fail(`subsystem "${code.systemCode}-${code.subSystemCode}"`);
          else if (sub) {
            const subsub = sub.children.find((s) => s.code === code.subSubSystemCode);
            if (sub.children.length && !subsub) fail(`sub-subsystem "${code.systemCode}-${code.subSystemCode}${code.subSubSystemCode}"`);
            else if (subsub && subsub.children.length && !subsub.children.find((s) => s.code === code.assyCode)) fail(`assembly "${code.systemCode}-${code.subSystemCode}${code.subSubSystemCode}-${code.assyCode}"`);
          }
        }
      }
    }
    // notations
    if (b.notations.length && opts.doctype) {
      const used = new Set(opts.doctype.decls.filter((d) => d.kind === 'entity' && d.notation).map((d) => d.notation!));
      for (const nr of b.notations) {
        if (nr.allowed === '0' && used.has(nr.name)) {
          issues.push({ severity: 'error', source: 'brex', message: `Notation "${nr.name}" is not allowed. ${nr.use}`.trim(), ruleId: 'NOTATION', node: target.documentElement });
        }
      }
    }
  }
  return { issues, rules, skipped, skippedRules };
}

/** Bundled S1000D default BREX data modules (one per issue). */
export const BUNDLED_BREX: Record<string, string> = {
  E: 'DMC-S1000D-E-04-10-0301-00A-022A-D_012-00_EN-US.XML',
  F: 'DMC-S1000D-F-04-10-0301-00A-022A-D_001-00_EN-US.XML',
  G: 'DMC-S1000D-G-04-10-0301-00A-022A-D_001-00_EN-US.XML',
  H: 'DMC-S1000D-H-04-10-0301-00A-022A-D_001-00_EN-US.XML',
  J: 'DMC-S1000D-J-04-10-0301-00A-022A-D_001-00_EN-US.XML',
  A: 'DMC-S1000D-A-04-10-0301-00A-022A-D_005-00_EN-US.XML',
  D: 'DMC-S1000D-D-04-10-0301-00A-022A-D_006-00_EN-US.XML',
};

export function isDefaultBrex(code: DmCodeParts): boolean {
  return code.modelIdentCode === 'S1000D' && code.systemCode === '04' && code.subSystemCode === '1' && code.assyCode === '0301' && code.infoCode === '022';
}

export function referencedBrex(doc: Document): DmCodeParts | null {
  const status = find(doc.documentElement, 'dmStatus');
  const ref = status ? find(status, 'brexDmRef') : null;
  return readDmCode(ref ? find(ref, 'dmCode') : null);
}
