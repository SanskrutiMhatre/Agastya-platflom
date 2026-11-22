/**
 * Validation orchestration: well-formedness, XSD (xmllint wasm worker),
 * BREX (layered: project BREX -> S1000D default BREX) and editor checks
 * (ICN entity declarations required by xs:ENTITY attributes).
 */
import { browserRunner, browserSchemaLoader, validateXsd } from '../validation/xsd';
import { BUNDLED_BREX, BrexDoc, checkBrex, isDefaultBrex, parseBrex, referencedBrex } from '../validation/brex';
import type { ValidationIssue, ValidationReport } from '../validation/types';
import { DEFAULT_BREX, DmCodeParts, formatDmc } from '../core/s1000d';
import { parseXml } from '../core/xml';
import type { EditorDocument } from '../core/document';
import { storage, StoredBrex } from './storage';

export class ValidationService {
  private loader = browserSchemaLoader('/schemas');
  private runner = browserRunner('/vendor/xmllint/xmllint-browser.mjs');
  private brexCache = new Map<string, BrexDoc | null>();

  async validate(doc: EditorDocument, opts: { xsd: boolean; brex: boolean }): Promise<ValidationReport> {
    const t0 = performance.now();
    const issues: ValidationIssue[] = [];
    const report: ValidationReport = { issues, time: 0 };
    const text = doc.toString();
    issues.push(...entityIssues(doc));
    const ref = doc.schemaRef;
    if (opts.xsd) {
      if (!ref) {
        issues.push({ severity: 'warning', source: 'xsd', message: 'No S1000D schema reference (xsi:noNamespaceSchemaLocation) — XSD validation skipped.' });
        report.xsd = { ran: false, valid: false, schema: '', issue: '', ms: 0 };
      } else {
        try {
          const r = await validateXsd(text, ref.issue, ref.schema, this.loader, this.runner);
          issues.push(...r.issues);
          report.xsd = { ran: true, valid: r.valid, schema: ref.schema, issue: ref.issue, ms: r.ms };
        } catch (e) {
          const msg = (e as Error).message;
          issues.push({ severity: 'warning', source: 'xsd', message: `XSD validation unavailable: ${msg}` });
          report.xsd = { ran: false, valid: false, schema: ref.schema, issue: ref.issue, ms: 0, error: msg };
        }
      }
    }
    if (opts.brex) {
      const b0 = performance.now();
      const notes: string[] = [];
      const chain = await this.brexChain(doc, notes);
      if (chain.length) {
        const r = checkBrex(doc.xml, chain, { schema: ref?.schema ?? null, doctype: doc.doctype });
        issues.push(...r.issues);
        if (r.skipped) notes.push(`${r.skipped} rule(s) skipped (XPath 2.0, unsupported expressions or value patterns that cannot be evaluated here).`);
        report.brex = { ran: true, brexDmc: chain.map((c) => c.dmc), rules: r.rules, skipped: r.skipped, ms: performance.now() - b0, notes };
      } else {
        report.brex = { ran: false, brexDmc: [], rules: 0, skipped: 0, ms: 0, notes };
        issues.push({ severity: 'warning', source: 'brex', message: notes[0] ?? 'No BREX available for this data module.' });
      }
      for (const n of notes) if (/not loaded|not found|fallback/i.test(n)) issues.push({ severity: 'info', source: 'brex', message: n });
    }
    report.time = performance.now() - t0;
    return report;
  }

  /** Resolves the BREX chain referenced by the document (with default-BREX fallback). */
  async brexChain(doc: EditorDocument, notes: string[]): Promise<BrexDoc[]> {
    const chain: BrexDoc[] = [];
    const seen = new Set<string>();
    let code = referencedBrex(doc.xml);
    if (!code) {
      const k = DEFAULT_BREX[doc.schemaRef?.issue ?? '5-0'] ?? 'G';
      code = defaultCode(k);
      notes.push(`The data module has no BREX reference; using the S1000D default BREX (${formatDmc(code)}).`);
    }
    let guard = 0;
    while (code && guard++ < 10) {
      const dmc = formatDmc(code);
      if (seen.has(dmc)) break;
      seen.add(dmc);
      const b = await this.loadBrex(code);
      if (!b) {
        notes.push(`Referenced BREX ${dmc} is not loaded in the BREX library — fallback to the S1000D default BREX. Add it with Review › BREX library….`);
        if (!isDefaultBrex(code)) {
          code = defaultCode(DEFAULT_BREX[doc.schemaRef?.issue ?? '5-0'] ?? 'G');
          continue;
        }
        break;
      }
      chain.push(b);
      code = b.parent;
    }
    return chain;
  }

  async loadBrex(code: DmCodeParts): Promise<BrexDoc | null> {
    const dmc = formatDmc(code);
    if (this.brexCache.has(dmc)) return this.brexCache.get(dmc)!;
    let doc: BrexDoc | null = null;
    const stored = await storage.get<StoredBrex>('brex', dmc);
    if (stored) {
      try {
        doc = parseBrex(parseXml(stored.text).doc);
      } catch {
        doc = null;
      }
    }
    if (!doc && isDefaultBrex(code) && BUNDLED_BREX[code.systemDiffCode]) {
      try {
        const r = await fetch('/brex/' + BUNDLED_BREX[code.systemDiffCode]);
        if (r.ok) doc = parseBrex(parseXml(await r.text()).doc);
      } catch {
        doc = null;
      }
    }
    this.brexCache.set(dmc, doc);
    return doc;
  }

  async addBrex(text: string, fileName: string): Promise<BrexDoc> {
    const b = parseBrex(parseXml(text).doc);
    if (!b.dmc) throw new Error('The BREX data module has no data module code');
    await storage.put('brex', b.dmc, { dmc: b.dmc, fileName, text, addedAt: Date.now() } satisfies StoredBrex);
    this.brexCache.delete(b.dmc);
    return b;
  }

  async listBrex(): Promise<StoredBrex[]> {
    return ((await storage.all<StoredBrex>('brex')) ?? []).sort((a, b) => a.dmc.localeCompare(b.dmc));
  }

  async removeBrex(dmc: string) {
    await storage.del('brex', dmc);
    this.brexCache.delete(dmc);
  }
}

function defaultCode(k: string): DmCodeParts {
  return {
    modelIdentCode: 'S1000D', systemDiffCode: k, systemCode: '04', subSystemCode: '1', subSubSystemCode: '0', assyCode: '0301',
    disassyCode: '00', disassyCodeVariant: 'A', infoCode: '022', infoCodeVariant: 'A', itemLocationCode: 'D',
  };
}

/** Attributes typed xs:ENTITY must name an unparsed entity declared in the DOCTYPE. */
export function entityIssues(doc: EditorDocument): ValidationIssue[] {
  const g = doc.grammar;
  if (!g) return [];
  const declared = new Set((doc.doctype?.decls ?? []).filter((d) => d.kind === 'entity').map((d) => d.name));
  const out: ValidationIssue[] = [];
  for (const el of Array.from(doc.xml.getElementsByTagName('*'))) {
    if (!g.has(el.nodeName)) continue;
    for (const a of g.attributes(el.nodeName)) {
      if (a.base !== 'ENTITY' && a.base !== 'ENTITIES') continue;
      const v = el.getAttribute(a.name);
      if (!v) continue;
      for (const name of v.split(/\s+/)) {
        if (!declared.has(name)) {
          out.push({ severity: 'error', source: 'editor', message: `ICN "${name}" (${el.nodeName}/@${a.name}) is not declared as an unparsed entity in the DOCTYPE.`, node: el, detail: 'Use Tools › Declare ICN entities to add the declarations.', ruleId: 'ENTITY' });
        }
      }
    }
  }
  return out;
}

/** ENTITY-typed attribute values used in the document. */
export function usedEntities(doc: EditorDocument): { name: string; el: Element }[] {
  const g = doc.grammar;
  const out: { name: string; el: Element }[] = [];
  for (const el of Array.from(doc.xml.getElementsByTagName('*'))) {
    const attrs = g?.has(el.nodeName) ? g.attributes(el.nodeName).filter((a) => a.base === 'ENTITY' || a.base === 'ENTITIES').map((a) => a.name) : el.hasAttribute('infoEntityIdent') ? ['infoEntityIdent'] : [];
    for (const a of attrs) {
      const v = el.getAttribute(a);
      if (v) for (const n of v.split(/\s+/)) out.push({ name: n, el });
    }
  }
  return out;
}
