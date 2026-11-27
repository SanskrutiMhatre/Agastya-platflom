// Shared helpers for the data-module-type verification suites.
//
// The official XSD is the ONLY authority. It is consulted through the native `xmllint` (libxml2, the same engine family the
// Studio runs as WebAssembly). The editor's compiled grammar (core/grammar.ts) is the thing under test, and the vim
// dictionaries (data/vim-s1000d.json.gz) are an independent second opinion.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { TEMPLATES, buildDataModule, defaultNewDmOptions } from '../../core/templates';
import { grammarFromJson, type Grammar, type GrammarJson, type JsonParticle } from '../../core/grammar';
import { parseXml, serialize, elementChildren, type ParsedXml } from '../../core/xml';

export const PUB = path.resolve(__dirname, '../../../../public');
export const RICH = path.resolve(__dirname, '../rich');
export const DATA = path.resolve(__dirname, 'data');
/** Where the suites write their result files. NOT test-results/: Playwright empties that folder at the start of every run. */
// AGASTYA_TEST_RESULTS (set by scripts/ci/gate.mjs to its evidence folder) wins, so a gate run does not overwrite the developer's results (QA-010).
export const RESULTS = process.env.AGASTYA_TEST_RESULTS || path.resolve(__dirname, '../../../../verification-results');
/** The issues the New data module wizard offers (4.1 is hidden there; see the report). */
export const ISSUES = ['4-2', '5-0', '6', '7'] as const;
export type Issue = (typeof ISSUES)[number];
/** The 21 wizard types, in wizard order. */
export const TYPES = TEMPLATES.map((t) => t.schema);
export const LABEL: Record<string, string> = Object.fromEntries(TEMPLATES.map((t) => [t.schema, t.label]));

// ------------------------------------------------------------------ grammar and dictionaries
const gcache = new Map<string, Grammar>();
export function gram(issue: string, schema: string): Grammar {
  const k = issue + '/' + schema;
  let g = gcache.get(k);
  if (!g) {
    g = grammarFromJson(JSON.parse(fs.readFileSync(path.join(PUB, 'grammar', issue, schema + '.json'), 'utf8')) as GrammarJson);
    gcache.set(k, g);
  }
  return g;
}
/** The compiled JSON behind a Grammar (the field is private in the editor; tests read it). */
export const gj = (g: Grammar): GrammarJson => (g as unknown as { json: GrammarJson }).json;
/** Frees the compiled grammars (their derivative memo tables grow with every sequence probed). */
export const dropGrammarCache = (): void => gcache.clear();
export function gramJson(issue: string, schema: string): GrammarJson {
  return JSON.parse(fs.readFileSync(path.join(PUB, 'grammar', issue, schema + '.json'), 'utf8')) as GrammarJson;
}

export interface VimEl { c: string[]; a: Record<string, string[]> }
let vimAll: Record<string, Record<string, VimEl>> | null = null;
export function vim(issue: string, schema: string): Record<string, VimEl> | undefined {
  vimAll ??= JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(DATA, 'vim-s1000d.json.gz'))).toString('utf8'));
  return vimAll![`${issue}/${schema}`];
}

// ------------------------------------------------------------------ realistic corpus
/** The graphic the figure-carrying modules reference; declared as an ICN entity in the DOCTYPE. */
export const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01';

/** A complete data module of `schema` for `issue`: the wizard's identification section plus the realistic body in rich/. */
export function richDm(schema: string, issue: string, assy?: string): string {
  const variant = path.join(RICH, `${schema}.${issue}.xml`);
  const body = fs.readFileSync(fs.existsSync(variant) ? variant : path.join(RICH, schema + '.xml'), 'utf8').trimEnd();
  const o = defaultNewDmOptions(schema, issue);
  if (assy) o.code.assyCode = assy;
  const base = buildDataModule(o);
  const withBody = base.replace(/<content>[\s\S]*<\/content>/, `<content>\n${body}\n  </content>`);
  return body.includes(ICN)
    ? withBody.replace('<dmodule ', `<!DOCTYPE dmodule [\n  <!NOTATION svg SYSTEM "svg">\n  <!ENTITY ${ICN} SYSTEM "${ICN}.svg" NDATA svg>\n]>\n<dmodule `)
    : withBody;
}

// ------------------------------------------------------------------ the XSD oracle (native xmllint, parallel)
export interface XsdError { line: number; el: string; attr?: string; msg: string }
export interface XsdResult { ok: boolean; errors: XsdError[]; raw: string }

const LIMIT = Math.max(2, Math.min(12, os.cpus().length));
let running = 0;
const waiting: Array<() => void> = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= LIMIT) await new Promise<void>((r) => waiting.push(r));
  running++;
  try { return await fn(); } finally { running--; waiting.shift()?.(); }
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'dmverify-'));
let seq = 0;

export function parseXsdErrors(stderr: string): XsdError[] {
  const out: XsdError[] = [];
  for (const line of stderr.split('\n')) {
    const m = /:(\d+): Schemas validity error : Element '([^']+)'(?:, attribute '([^']+)')?: (.*)$/.exec(line);
    if (m) out.push({ line: Number(m[1]), el: m[2], attr: m[3], msg: m[4] });
  }
  return out;
}

export function xsdValidate(xml: string, issue: string, schema: string): Promise<XsdResult> {
  // xmllint always ends with a verdict line ("<file> validates" / "<file> fails to validate"). A run with neither (killed, out of
  // resources under heavy parallel load) is NO verdict: reading it as "no errors" would turn noise into a false "accepted".
  const once = () =>
    slot(
      () =>
        new Promise<XsdResult & { verdict: boolean }>((resolve, reject) => {
          const f = path.join(TMP, `d${++seq}.xml`);
          fs.writeFileSync(f, xml);
          const p = spawn('xmllint', ['--noout', '--schema', path.join(PUB, 'schemas', issue, schema + '.xsd'), f]);
          let err = '';
          p.stderr.on('data', (d) => (err += d));
          p.on('error', reject);
          p.on('close', (code) => {
            fs.rmSync(f, { force: true });
            resolve({ ok: code === 0, errors: parseXsdErrors(err), raw: err, verdict: / validates\s*$| fails to validate\s*$/m.test(err) });
          });
        }),
    );
  return (async () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const r = await once();
      if (r.verdict) return { ok: r.ok, errors: r.errors, raw: r.raw };
      await new Promise((res) => setTimeout(res, 50 * (attempt + 1)));
    }
    throw new Error(`xmllint gave no verdict for ${schema} ${issue} after 5 attempts`);
  })();
}

// ------------------------------------------------------------------ mutations (through the Studio's own XML layer)
export const parse = (xml: string): ParsedXml => parseXml(xml);
export const emit = (p: ParsedXml): string => serialize(p.doc, { doctype: p.doctype, xmlDecl: p.xmlDecl }).text;
export const allElements = (p: ParsedXml): Element[] => Array.from(p.doc.getElementsByTagName('*'));
export { elementChildren };

export const same = (a: Iterable<string>, b: Iterable<string>): boolean => {
  const x = [...new Set(a)].sort();
  const y = [...new Set(b)].sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
};
export const diff = (a: Iterable<string>, b: Iterable<string>): { onlyA: string[]; onlyB: string[] } => {
  const A = new Set(a);
  const B = new Set(b);
  return { onlyA: [...A].filter((x) => !B.has(x)), onlyB: [...B].filter((x) => !A.has(x)) };
};

// ------------------------------------------------------------------ result bookkeeping
export interface Tally { run: number; inconclusive: number; mismatch: number }
export interface Mismatch { kind: string; parent: string; detail: string }
export interface SuiteResult { tallies: Record<string, Tally>; mismatches: Mismatch[] }
export const newResult = (): SuiteResult => ({ tallies: {}, mismatches: [] });
export function tally(r: SuiteResult, kind: string): Tally {
  return (r.tallies[kind] ??= { run: 0, inconclusive: 0, mismatch: 0 });
}
export function bad(r: SuiteResult, kind: string, parent: string, detail: string): void {
  tally(r, kind).mismatch++;
  r.mismatches.push({ kind, parent, detail });
}

// ------------------------------------------------------------------ probing "may X go here?" against the XSD
/**
 * A document as the editor writes it, with the offset of every node, so a probe element can be spliced in on a line of its own.
 * `accepts` asks the XSD whether X is acceptable as the element at child position j of element #elIndex (document order).
 * `acceptsWhole` asks whether the document stays free of content-model errors with X inserted there (X fits AND everything that
 * already follows it still fits): that is the whole-sequence question an editor's insertion has to answer.
 */
export class ProbeDoc {
  readonly base: ParsedXml;
  readonly els: Element[];
  private ser: { text: string; spans: Map<Node, [number, number]> | null };
  constructor(readonly text: string, readonly issue: string, readonly schema: string, grammar?: Grammar | null) {
    this.base = parse(text);
    this.els = allElements(this.base);
    this.ser = serialize(this.base.doc, { doctype: this.base.doctype, xmlDecl: this.base.xmlDecl, grammar: grammar ?? gram(issue, schema), map: true });
  }
  with(elIndex: number, j: number, X: string): string {
    const el = this.els[elIndex];
    const kids = elementChildren(el);
    const probe = `\n<${X} zzp="1"/>\n`;
    const t = this.ser.text;
    if (kids[j]) {
      const at = this.ser.spans!.get(kids[j])![0];
      return t.slice(0, at) + probe + t.slice(at);
    }
    const [a, b] = this.ser.spans!.get(el)!;
    if (t.slice(a, b).endsWith('/>')) return t.slice(0, b - 2) + '>' + probe + `</${el.nodeName}>` + t.slice(b);
    const at = b - `</${el.nodeName}>`.length;
    return t.slice(0, at) + probe + t.slice(at);
  }
  async accepts(elIndex: number, j: number, X: string): Promise<boolean> {
    const xml = this.with(elIndex, j, X);
    const line = xml.slice(0, xml.indexOf('zzp="1"')).split('\n').length;
    const r = await xsdValidate(xml, this.issue, this.schema);
    return !r.errors.some((e) => e.el === X && e.line === line && /not expected/.test(e.msg));
  }
  async acceptsWhole(elIndex: number, j: number, X: string): Promise<boolean> {
    const r = await xsdValidate(this.with(elIndex, j, X), this.issue, this.schema);
    return !r.errors.some((e) => /not expected/.test(e.msg));
  }
}

// ------------------------------------------------------------------ suite 1: content model (children, order, occurrence, required)
const CM = /not expected|Missing child element/;
const unique = (a: number[]): number[] => [...new Set(a)];
const positions = (n: number, quick: boolean): number[] => unique(quick ? [0, n] : [0, Math.floor(n / 2), n]);

/**
 * For the first instance of every distinct element in the realistic document, applies mutations to its children and compares
 * the XSD's verdict with the editor grammar's:
 *   next   - insert each possible child at a position: accepted by the XSD  <=>  in grammar.expectedNext (strict)
 *   trunc  - keep only the first k children (missing required elements)
 *   dup    - repeat a child (occurrence limits)
 *   swap   - exchange two neighbours of different names (ordering)
 *   drop   - remove the first child
 */
export async function contentModelSuite(schema: string, issue: string, quick = false, grammar?: Grammar): Promise<SuiteResult> {
  const res = newResult();
  const g = grammar ?? gram(issue, schema);
  const text = richDm(schema, issue);
  const base = parse(text);
  const els = allElements(base);
  const firstOf = new Map<string, number>();
  els.forEach((e, i) => { if (!firstOf.has(e.nodeName)) firstOf.set(e.nodeName, i); });

  // sanity: the unmutated round trip through the Studio's serializer is XSD-valid
  const rt = await xsdValidate(emit(parse(text)), issue, schema);
  tally(res, 'roundtrip').run++;
  if (!rt.ok) bad(res, 'roundtrip', 'dmodule', rt.raw.slice(0, 300));

  const pd = new ProbeDoc(text, issue, schema, g);

  // the document as written is valid: the grammar must say so for EVERY element instance, not just the first of each name
  for (const el of els) {
    if (!g.has(el.nodeName)) continue;
    tally(res, 'as-written').run++;
    const kids = elementChildren(el).map((c) => c.nodeName);
    if (!g.isValidContent(el.nodeName, kids)) bad(res, 'as-written', el.nodeName, `[${kids.join(',')}] is valid in the XSD but not in the grammar`);
  }

  const jobs: Array<() => Promise<void>> = [];
  for (const [name, idx] of firstOf) {
    if (!g.has(name)) { bad(res, 'unknown-element', name, `<${name}> in the realistic document is not in the ${schema} ${issue} grammar`); continue; }
    const kidsNow = elementChildren(els[idx]).map((c) => c.nodeName);
    const n = kidsNow.length;

    const mutate = (fn: (parent: Element, kids: Element[], doc: Document) => void): string => {
      const p = parse(text);
      const el = allElements(p)[idx];
      fn(el, elementChildren(el), p.doc);
      return emit(p);
    };
    const verdict = (r: XsdResult): boolean => !r.errors.some((e) => CM.test(e.msg));

    // next: for EVERY element that can ever be a child of this one, may it go here? (exact: the XSD answers per element)
    const universe = g.childCandidates(name).filter((x) => !x.includes(':'));
    for (const j of positions(n, quick)) {
      const nextSet = new Set(g.expectedNext(name, kidsNow.slice(0, j)));
      for (const X of universe) {
        jobs.push(async () => {
          const t = tally(res, 'next');
          t.run++;
          const xsdAccepts = await pd.accepts(idx, j, X);
          if (xsdAccepts !== nextSet.has(X)) {
            bad(res, 'next', name, `<${X}> after [${kidsNow.slice(0, j).join(',')}]: XSD ${xsdAccepts ? 'accepts' : 'rejects'}, grammar ${nextSet.has(X) ? 'accepts' : 'rejects'}`);
          }
        });
      }
    }
    // trunc: missing required elements
    for (const k of unique([0, n - 1]).filter((k) => k >= 0 && k < n)) {
      jobs.push(async () => {
        const t = tally(res, 'missing');
        t.run++;
        const r = await xsdValidate(mutate((_el, kids) => kids.slice(k).forEach((c) => c.parentNode!.removeChild(c))), issue, schema);
        const xsd = verdict(r);
        const mine = g.isValidContent(name, kidsNow.slice(0, k));
        if (xsd !== mine) bad(res, 'missing', name, `keep first ${k} of [${kidsNow.join(',')}]: XSD ${xsd ? 'valid' : 'invalid'}, grammar ${mine ? 'valid' : 'invalid'}`);
      });
    }
    // drop: remove each child in turn (a required one in the middle is as important as the first)
    const idxs = unique([...Array(Math.min(n, 8)).keys(), n - 1]).filter((i) => i >= 0 && i < n);
    for (const i of idxs) {
      jobs.push(async () => {
        const t = tally(res, 'missing');
        t.run++;
        const r = await xsdValidate(mutate((_el, kids) => kids[i].parentNode!.removeChild(kids[i])), issue, schema);
        const xsd = verdict(r);
        const mine = g.isValidContent(name, kidsNow.filter((_c, k) => k !== i));
        if (xsd !== mine) bad(res, 'missing', name, `drop #${i} <${kidsNow[i]}> of [${kidsNow.join(',')}]: XSD ${xsd ? 'valid' : 'invalid'}, grammar ${mine ? 'valid' : 'invalid'}`);
      });
    }
    // dup: repeat each child in turn (occurrence limits)
    for (const i of idxs) {
      jobs.push(async () => {
        const t = tally(res, 'occurrence');
        t.run++;
        const r = await xsdValidate(mutate((_el, kids) => kids[i].parentNode!.insertBefore(kids[i].cloneNode(true), kids[i].nextSibling)), issue, schema);
        const xsd = verdict(r);
        const names = [...kidsNow.slice(0, i + 1), kidsNow[i], ...kidsNow.slice(i + 1)];
        const mine = g.isValidContent(name, names);
        if (xsd !== mine) bad(res, 'occurrence', name, `repeat <${kidsNow[i]}> in [${kidsNow.join(',')}]: XSD ${xsd ? 'valid' : 'invalid'}, grammar ${mine ? 'valid' : 'invalid'}`);
      });
    }
    // swap: exchange each pair of neighbours with different names (ordering)
    for (const sw of idxs.filter((i) => i + 1 < n && kidsNow[i] !== kidsNow[i + 1]).slice(0, 6)) {
      jobs.push(async () => {
        const t = tally(res, 'order');
        t.run++;
        const r = await xsdValidate(mutate((el, kids) => el.insertBefore(kids[sw + 1], kids[sw])), issue, schema);
        const xsd = verdict(r);
        const names = [...kidsNow];
        [names[sw], names[sw + 1]] = [names[sw + 1], names[sw]];
        const mine = g.isValidContent(name, names);
        if (xsd !== mine) bad(res, 'order', name, `swap ${sw}/${sw + 1} in [${kidsNow.join(',')}]: XSD ${xsd ? 'valid' : 'invalid'}, grammar ${mine ? 'valid' : 'invalid'}`);
      });
    }
  }
  await Promise.all(jobs.map((j) => j()));
  return res;
}

// ------------------------------------------------------------------ suite 2: attributes (names, required, enumerations, patterns)
const setOf = (msg: string): string[] | null => {
  const m = /is not an element of the set \{(.*)\}/.exec(msg);
  return m ? [...m[1].matchAll(/'((?:[^']|'')*)'/g)].map((x) => x[1]) : null;
};

export async function attributeSuite(schema: string, issue: string, grammar?: Grammar): Promise<SuiteResult> {
  const res = newResult();
  const g = grammar ?? gram(issue, schema);
  const dict = vim(issue, schema) ?? {};
  const text = richDm(schema, issue);
  const base = parse(text);
  const els = allElements(base);
  const firstOf = new Map<string, number>();
  els.forEach((e, i) => { if (!firstOf.has(e.nodeName)) firstOf.set(e.nodeName, i); });
  const plain = (n: string) => !n.includes(':');

  // --- pass A: every candidate attribute name, with a value no pattern or enumeration can accept (~~~) -------------------------------------------------
  const cands = new Map<string, string[]>();
  const p = parse(text);
  const pe = allElements(p);
  for (const [name, idx] of firstOf) {
    if (!g.has(name)) continue;
    const set = new Set<string>(['zzBogusAttr']);
    g.attributes(name).forEach((a) => plain(a.name) && a.name !== '*' && set.add(a.name));
    Object.keys(dict[name]?.a ?? {}).forEach((a) => plain(a) && set.add(a));
    cands.set(name, [...set]);
    for (const a of set) pe[idx].setAttribute(a, '~~~');
  }
  const ra = await xsdValidate(emit(p), issue, schema);
  const notAllowed = new Set<string>();
  const enumSeen = new Map<string, string[]>();
  const valueErr = new Set<string>();
  for (const e of ra.errors) {
    if (!e.attr) continue;
    const key = `${e.el}@${e.attr}`;
    if (/is not allowed/.test(e.msg)) { notAllowed.add(key); continue; }
    if (/required but missing/.test(e.msg)) continue;
    valueErr.add(key);
    const set = setOf(e.msg);
    if (set) enumSeen.set(key, set);
  }
  const FREE = ['string', 'token', 'normalizedString', 'anyURI', 'ID', 'IDREF', 'IDREFS', 'NMTOKEN', 'NMTOKENS', 'Name', 'NCName', 'language', 'QName', 'anySimpleType'];
  for (const [name, list] of cands) {
    for (const a of list) {
      const key = `${name}@${a}`;
      const t = tally(res, 'attr-name');
      t.run++;
      const xsdDeclared = !notAllowed.has(key);
      const mineDeclared = !!g.attribute(name, a);
      if (xsdDeclared !== mineDeclared) bad(res, 'attr-name', name, `@${a}: XSD ${xsdDeclared ? 'allows' : 'rejects'}, grammar ${mineDeclared ? 'allows' : 'rejects'}`);
      if (!xsdDeclared) continue;
      const info = g.attribute(name, a);
      if (!info) continue;
      // is the value restricted at all (pattern, enumeration, numeric/date type ...)? Name-like types (ID, IDREF ...) are syntax-only.
      const NAMELIKE = ['ID', 'IDREF', 'IDREFS', 'NMTOKEN', 'NMTOKENS', 'Name', 'NCName', 'QName', 'language'];
      const mineRestricted = !!(info.enumValues || info.patterns?.length || Object.keys(info.facets).length || !FREE.includes(info.base));
      const xsdRestricted = valueErr.has(key);
      const tv = tally(res, 'attr-value');
      tv.run++;
      if (mineRestricted && !xsdRestricted) bad(res, 'attr-value', name, `@${a}: grammar restricts the value (base ${info.base}), XSD accepted "~~~"`);
      else if (xsdRestricted && !mineRestricted && !NAMELIKE.includes(info.base)) bad(res, 'attr-value', name, `@${a}: XSD restricts the value, grammar accepts any (base ${info.base})`);
      // when the XSD names the permitted set in its message it must equal the grammar's
      const xsdSet = enumSeen.get(key);
      if (xsdSet) {
        const te = tally(res, 'attr-enum-set');
        te.run++;
        if (!info.enumValues) bad(res, 'attr-enum-set', name, `@${a}: XSD restricts to {${xsdSet.join(',')}}, grammar has no enumeration`);
        else if (!same(xsdSet, info.enumValues)) { const d = diff(xsdSet, info.enumValues); bad(res, 'attr-enum-set', name, `@${a}: XSD-only{${d.onlyA.join(',')}} grammar-only{${d.onlyB.join(',')}}`); }
      }
    }
  }

  // --- pass C: every value the grammar (and the reference dictionary) lists for an enumerated attribute must be ACCEPTED by the XSD
  const enumLike = (v: string) => !/[\\[\](){}|*+?^$]/.test(v);
  interface EnumJob { name: string; attr: string; vals: string[]; vimOnly: string[] }
  const enums: EnumJob[] = [];
  for (const [name, list] of cands) {
    for (const a of list) {
      if (notAllowed.has(`${name}@${a}`)) continue;
      const info = g.attribute(name, a);
      const vv = (dict[name]?.a?.[a] ?? []).filter(enumLike);
      const gv = info?.enumValues && !info.openEnum ? info.enumValues : [];
      if (!gv.length && !vv.length) continue;
      // the dictionary lists patterns too; only treat it as an enumeration when the grammar has one as well
      if (!gv.length) continue;
      const vimOnly = vv.filter((v) => !gv.includes(v));
      tally(res, 'attr-enum-vim').run++;
      enums.push({ name, attr: a, vals: [...gv], vimOnly });
    }
  }
  const maxK = Math.max(0, ...enums.map((e) => e.vals.length + e.vimOnly.length));
  const passes: Array<Promise<void>> = [];
  for (let r = 0; r < maxK; r++) {
    passes.push((async () => {
      const pp = parse(text);
      const ee = allElements(pp);
      const tried = new Map<string, { v: string; fromVim: boolean }>();
      for (const e of enums) {
        const all = [...e.vals, ...e.vimOnly];
        if (r >= all.length) continue;
        ee[firstOf.get(e.name)!].setAttribute(e.attr, all[r]);
        tried.set(`${e.name}@${e.attr}`, { v: all[r], fromVim: r >= e.vals.length });
      }
      const rr = await xsdValidate(emit(pp), issue, schema);
      const t = tally(res, 'attr-enum');
      t.run += tried.size;
      const rejected = new Set<string>();
      for (const e of rr.errors) {
        if (!e.attr || /is not allowed|required but missing/.test(e.msg)) continue;
        const hit = tried.get(`${e.el}@${e.attr}`);
        if (!hit) continue;
        rejected.add(`${e.el}@${e.attr}`);
        if (hit.fromVim) bad(res, 'attr-enum-vim', e.el, `@${e.attr}: reference dictionary lists "${hit.v}" but the XSD rejects it (dictionary wrong, grammar fine)`);
        else bad(res, 'attr-enum', e.el, `@${e.attr}: grammar allows "${hit.v}" but the XSD rejects it`);
      }
      // a value only the dictionary lists that the XSD ACCEPTS is a value the grammar is missing
      for (const [key, hit] of tried) if (hit.fromVim && !rejected.has(key)) bad(res, 'attr-enum', key.split('@')[0], `@${key.split('@')[1]}: XSD accepts "${hit.v}" but the grammar does not list it`);
    })());
  }
  await Promise.all(passes);

  // --- pass B: remove every attribute -> the XSD lists the required ones -----------------------------------
  const q = parse(text);
  const qe = allElements(q);
  for (const [name, idx] of firstOf) {
    for (const a of Array.from(qe[idx].attributes)) if (!/^(xmlns|xsi:|xlink:)/.test(a.name)) qe[idx].removeAttribute(a.name);
    void name;
  }
  const rb = await xsdValidate(emit(q), issue, schema);
  const xsdReq = new Map<string, Set<string>>();
  for (const e of rb.errors) {
    const m = /The attribute '([^']+)' is required but missing/.exec(e.msg);
    if (m) (xsdReq.get(e.el) ?? xsdReq.set(e.el, new Set()).get(e.el)!).add(m[1]);
  }
  for (const [name] of firstOf) {
    if (!g.has(name)) continue;
    const t = tally(res, 'attr-required');
    t.run++;
    const mine = g.attributes(name).filter((a) => a.required && plain(a.name)).map((a) => a.name);
    const xs = [...(xsdReq.get(name) ?? [])].filter(plain);
    if (!same(mine, xs)) { const d = diff(xs, mine); bad(res, 'attr-required', name, `required: XSD-only{${d.onlyA.join(',')}} grammar-only{${d.onlyB.join(',')}}`); }
  }
  return res;
}

// ------------------------------------------------------------------ suite 3: EVERY element, on its own
// The flat S1000D schemas declare every element globally, so any element can be the root of a tiny document and validated
// against the same XSD. That reaches elements the realistic documents never use. Children are empty leaf elements on their own
// lines, so the only 'not expected' errors are about the content model of the element under test.

/** A signature of an element's definition (content model with groups inlined + attribute types), to test identical ones once per issue. */
function signature(j: GrammarJson, name: string): string {
  const t = j.types[j.elements[name]];
  const groups = new Set<string>();
  const walk = (p: JsonParticle | null | undefined) => {
    if (!p) return;
    if (p.k === 'g') { if (!groups.has(p.n!)) { groups.add(p.n!); walk(j.groups[p.n!]); } return; }
    p.a?.forEach(walk);
  };
  walk(t?.c);
  return JSON.stringify([t, [...groups].sort().map((g) => j.groups[g]), (t?.a ?? []).map((a) => j.simple[a.t])]);
}

export interface ElementJob { issue: string; schema: string; name: string }
/** One job per distinct element definition of the issue, across all 21 types, plus which types share it. */
export function elementJobs(issue: string): Array<ElementJob & { sharedBy: string[] }> {
  const seen = new Map<string, ElementJob & { sharedBy: string[] }>();
  for (const schema of TYPES) {
    const j = gramJson(issue, schema);
    for (const name of Object.keys(j.elements)) {
      if (name.includes(':')) continue;
      const key = name + '|' + signature(j, name);
      const hit = seen.get(key);
      if (hit) hit.sharedBy.push(schema);
      else seen.set(key, { issue, schema, name, sharedBy: [schema] });
    }
  }
  return [...seen.values()];
}

/** A shortest valid child sequence, then a longer valid one grown by appending the first acceptable candidate each time. */
function sequences(g: Grammar, name: string): string[][] {
  const s0 = g.requiredChildren(name).filter((c) => !c.includes(':'));
  const out: string[][] = [s0];
  let cur = [...s0];
  for (let k = 0; k < 6; k++) {
    const next = g.expectedNext(name, cur).filter((c) => !c.includes(':') && g.has(c) && g.expectedNext(name, [...cur, c]).length + (g.isValidContent(name, [...cur, c]) ? 1 : 0) > 0);
    if (!next.length) break;
    cur = [...cur, next[0]];
  }
  if (g.isValidContent(name, cur) && cur.join() !== s0.join()) out.push(cur);
  return out;
}

export async function elementSuite(job: ElementJob): Promise<SuiteResult> {
  const { issue, schema, name } = job;
  const res = newResult();
  const g = gram(issue, schema);
  const doc = (kids: string[], attrs = ''): string => `<${name}${attrs}>${kids.map((k) => `\n<${k}/>`).join('')}\n</${name}>\n`;
  // The root starts on line 1 and ends on line kids+2. A same-named nested child (checkListStep in checkListStep) has its own
  // 'missing child' errors on lines in between, which must not be mistaken for the root's.
  const lastLine = (kids: string[]) => kids.length + 2;
  const CMERR = (kids: string[]) => (e: XsdError) => /not expected/.test(e.msg) || (e.el === name && (e.line === 1 || e.line === lastLine(kids)) && /Missing child element/.test(e.msg));
  const universe = g.childCandidates(name).filter((x) => !x.includes(':') && g.has(x));
  const jobs: Array<() => Promise<void>> = [];

  const global = await xsdValidate(doc([]), issue, schema);
  if (global.errors.some((e) => /No matching global declaration/.test(e.msg))) { tally(res, 'not-global').run++; return res; }

  for (const S of sequences(g, name)) {
    // the sequence as written
    jobs.push(async () => {
      const t = tally(res, 'as-written');
      t.run++;
      const r = await xsdValidate(doc(S), issue, schema);
      const xsd = !r.errors.some(CMERR(S));
      const mine = g.isValidContent(name, S);
      if (xsd !== mine) bad(res, 'as-written', name, `[${S.join(',')}]: XSD ${xsd ? 'valid' : 'invalid'}, grammar ${mine ? 'valid' : 'invalid'}`);
    });
    // every candidate at every position (line j+2 is the probe)
    const cap = S.length > 4 ? [0, 1, Math.floor(S.length / 2), S.length] : S.map((_, i) => i).concat(S.length);
    for (const j of unique(cap)) {
      const nextSet = new Set(g.expectedNext(name, S.slice(0, j)));
      for (const X of universe) {
        jobs.push(async () => {
          const t = tally(res, 'next');
          t.run++;
          const seq = [...S.slice(0, j), X, ...S.slice(j)];
          const r = await xsdValidate(doc(seq), issue, schema);
          const rejected = r.errors.some((e) => e.el === X && e.line === j + 2 && /not expected/.test(e.msg));
          if (!rejected !== nextSet.has(X)) bad(res, 'next', name, `<${X}> after [${S.slice(0, j).join(',')}]: XSD ${rejected ? 'rejects' : 'accepts'}, grammar ${nextSet.has(X) ? 'accepts' : 'rejects'}`);
        });
      }
    }
    // drop / repeat / swap
    const idxs = unique([...Array(Math.min(S.length, 8)).keys(), S.length - 1]).filter((i) => i >= 0 && i < S.length);
    for (const i of idxs) {
      for (const [kind, seq] of [
        ['missing', S.filter((_c, k) => k !== i)],
        ['occurrence', [...S.slice(0, i + 1), S[i], ...S.slice(i + 1)]],
      ] as Array<[string, string[]]>) {
        jobs.push(async () => {
          const t = tally(res, kind);
          t.run++;
          const r = await xsdValidate(doc(seq), issue, schema);
          const xsd = !r.errors.some(CMERR(seq));
          const mine = g.isValidContent(name, seq);
          if (xsd !== mine) bad(res, kind, name, `[${seq.join(',')}] (${kind}): XSD ${xsd ? 'valid' : 'invalid'}, grammar ${mine ? 'valid' : 'invalid'}`);
        });
      }
    }
    for (const sw of idxs.filter((i) => i + 1 < S.length && S[i] !== S[i + 1]).slice(0, 6)) {
      jobs.push(async () => {
        const t = tally(res, 'order');
        t.run++;
        const seq = [...S];
        [seq[sw], seq[sw + 1]] = [seq[sw + 1], seq[sw]];
        const r = await xsdValidate(doc(seq), issue, schema);
        const xsd = !r.errors.some(CMERR(seq));
        const mine = g.isValidContent(name, seq);
        if (xsd !== mine) bad(res, 'order', name, `[${seq.join(',')}] (swap): XSD ${xsd ? 'valid' : 'invalid'}, grammar ${mine ? 'valid' : 'invalid'}`);
      });
    }
  }

  // attributes of this element: names, required, enumerations
  const dict = vim(issue, schema)?.[name];
  const cand = new Set<string>(['zzBogusAttr']);
  g.attributes(name).forEach((a) => !a.name.includes(':') && a.name !== '*' && cand.add(a.name));
  Object.keys(dict?.a ?? {}).forEach((a) => !a.includes(':') && cand.add(a));
  jobs.push(async () => {
    const attrs = [...cand].map((a) => ` ${a}="~~~"`).join('');
    const r = await xsdValidate(doc([], attrs), issue, schema);
    const notAllowed = new Set(r.errors.filter((e) => e.el === name && e.attr && /is not allowed/.test(e.msg)).map((e) => e.attr!));
    for (const a of cand) {
      const t = tally(res, 'attr-name');
      t.run++;
      const xsd = !notAllowed.has(a);
      const mine = !!g.attribute(name, a);
      if (xsd !== mine) bad(res, 'attr-name', name, `@${a}: XSD ${xsd ? 'allows' : 'rejects'}, grammar ${mine ? 'allows' : 'rejects'}`);
    }
  });
  jobs.push(async () => {
    const r = await xsdValidate(doc([]), issue, schema);
    const xs = new Set(r.errors.filter((e) => e.el === name).map((e) => /The attribute '([^']+)' is required but missing/.exec(e.msg)?.[1]).filter((x): x is string => !!x && !x.includes(':')));
    const mine = g.attributes(name).filter((a) => a.required && !a.name.includes(':')).map((a) => a.name);
    const t = tally(res, 'attr-required');
    t.run++;
    if (!same(xs, mine)) { const d = diff(xs, mine); bad(res, 'attr-required', name, `required: XSD-only{${d.onlyA.join(',')}} grammar-only{${d.onlyB.join(',')}}`); }
  });
  // enumerations: every grammar value (and every dictionary-only value) is accepted by the XSD
  const enumAttrs = g.attributes(name).filter((a) => a.enumValues && !a.openEnum && !a.name.includes(':'));
  const maxK = Math.max(0, ...enumAttrs.map((a) => a.enumValues!.length));
  const enumLike = (v: string) => !/[\\[\](){}|*+?^$]/.test(v);
  for (let r0 = 0; r0 < maxK; r0++) {
    jobs.push(async () => {
      const attrs = enumAttrs.filter((a) => r0 < a.enumValues!.length).map((a) => ` ${a.name}="${a.enumValues![r0]}"`).join('');
      const r = await xsdValidate(doc([], attrs), issue, schema);
      for (const a of enumAttrs) {
        if (r0 >= a.enumValues!.length) continue;
        tally(res, 'attr-enum').run++;
        if (r.errors.some((e) => e.el === name && e.attr === a.name && !/required but missing|is not allowed/.test(e.msg))) bad(res, 'attr-enum', name, `@${a.name}: grammar allows "${a.enumValues![r0]}" but the XSD rejects it`);
      }
    });
  }
  const vimExtra = enumAttrs.flatMap((a) => (dict?.a?.[a.name] ?? []).filter((v) => enumLike(v) && !a.enumValues!.includes(v)).map((v) => [a.name, v] as const));
  for (const [a, v] of vimExtra) {
    jobs.push(async () => {
      tally(res, 'attr-enum-vim').run++;
      const r = await xsdValidate(doc([], ` ${a}="${v}"`), issue, schema);
      if (!r.errors.some((e) => e.el === name && e.attr === a && !/required but missing/.test(e.msg))) bad(res, 'attr-enum', name, `@${a}: XSD accepts "${v}" (listed by the reference dictionary) but the grammar does not`);
    });
  }
  await Promise.all(jobs.map((j) => j()));
  return res;
}
