// =============================================================================
// S1000D applicability: the ACT / CCT / PCT of a project, and the validation of every reference to them.
//
// WHAT IS IMPLEMENTED (and what is not)
//   - Structured authoring of the three cross-reference tables of a project (product attributes + allowed values, condition types +
//     conditions, products). The platform writes them as REAL S1000D data modules (ACT info code 00W, CCT 00Q, PCT 00P: BREX-S1-00180
//     titles) into the project's CSDB, XSD-checked before they are stored. The data modules are the source of truth; this service reads them back.
//   - A data module's own applicability is selected from those definitions and written as <applic><assert/evaluate>, with an
//     <applicCrossRefTableRef> to the ACT (done by the New data module wizard).
//   - Validation of references, with the data module and the XML location: applicRefId -> <applic id>; applicPropertyIdent -> ACT
//     productAttribute / CCT cond; applicPropertyValues -> the declared enumeration or pattern; applicCrossRefTableRef -> an existing ACT;
//     ACT -> CCT/PCT references; CCT condTypeRefId; PCT assign.
//   Configuration-specific publication (filtering by a product configuration) is in applicEval.ts. Externalized applicability (an applicRef into the
//   applicability annotations CIR data module) is resolved here (resolveApplicRef) and used by both the validation and the evaluation.
//
// SEMANTICS (S1000D Issue 4.2, Chap 3.9.5.3, examples 3.2 and 3.3)
//   assert prodattr   : applicPropertyIdent = productAttribute/@id (ACT); values from its <enumeration>s or valuePattern
//   assert condition  : applicPropertyIdent = cond/@id (CCT); values from the enumerations of the cond's condType
//   values syntax     : "A", a set "A|B", a range "1~5", combinations "1~2|5~10"
// =============================================================================

import fs from 'fs';
import path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { nowIso, vendor } from '../config';
import { bad, conflict, HttpError } from './http';
import { listDms, createDm, writeDm, csdbDir, DM_FILE_RE, dmcString } from './csdb';
import { readProjectJson, csdbRel } from './projects';
import { getConfig, updateConfig } from './projectConfig';
import { defaultLetterFor } from './brex';
import { listItems } from './adminConfig';
import { IssueKey } from './s1000dRef';
import { yielder } from './yieldLoop';
import { escAttr as esc } from '../lib/xml';

const { validateDocument } = vendor('engine/validateSchema');

// ── Model ────────────────────────────────────────────────────────────────────

export type ValueType = 'string' | 'integer' | 'real' | 'boolean';
export interface Value { value: string; label?: string }
export interface Attribute { id: string; name: string; displayName?: string; descr: string; valueDataType: ValueType; values: Value[]; valuePattern?: string; productIdentifier?: 'primary' | 'secondary' | 'no' }
export interface CondType { id: string; name: string; descr: string; valueDataType: ValueType; values: Value[]; valuePattern?: string }
export interface Cond { id: string; condTypeId: string; name: string; displayName?: string; descr: string }
export interface Product { id: string; assigns: Array<{ ident: string; type: 'prodattr' | 'condition'; value: string }> }
export interface ApplicModel { attributes: Attribute[]; conditionTypes: CondType[]; conditions: Cond[]; products: Product[] }
export const emptyModel = (): ApplicModel => ({ attributes: [], conditionTypes: [], conditions: [], products: [] });

export interface Problem { severity: 'error' | 'warning'; file: string; line: number; location: string; code: string; message: string }

const TABLES = {
  act: { schema: 'appliccrossreftable', fallbackInfo: '00W', title: 'Applicability cross-reference table' },
  cct: { schema: 'condcrossreftable', fallbackInfo: '00Q', title: 'Conditions cross-reference table' },
  pct: { schema: 'prdcrossreftable', fallbackInfo: '00P', title: 'Products cross-reference table' },
} as const;
type TableKey = keyof typeof TABLES;

const NCNAME = /^[A-Za-z_][A-Za-z0-9._-]*$/;

// ── Value syntax ─────────────────────────────────────────────────────────────

/** "1~2|5~10" -> tokens; a token is a single value or a range [from, to]. */
export function parseValues(raw: string): Array<{ from: string; to?: string }> {
  return String(raw ?? '').split('|').map((t) => t.trim()).filter(Boolean).map((t) => {
    const i = t.indexOf('~');
    return i > 0 ? { from: t.slice(0, i), to: t.slice(i + 1) } : { from: t };
  });
}

const isNum = (s: string): boolean => /^-?\d+(\.\d+)?$/.test(s.trim());

/** Does one selected value match one token of applicPropertyValues ("A", or a range "1~5")? Ranges compare numerically when value and both ends are numbers, otherwise as text. */
export function tokenMatches(token: { from: string; to?: string }, v: string): boolean {
  if (token.to === undefined) return token.from === v;
  if (isNum(token.from) && isNum(token.to) && isNum(v)) { const n = Number(v); return n >= Number(token.from) && n <= Number(token.to); }
  return v >= token.from && v <= token.to;
}
/** Does any selected value match any token of an applicPropertyValues expression ("A", "A|B", "1~5", "1~2|5~10")? */
export function valuesMatch(applicValues: string, selected: string[]): boolean {
  const toks = parseValues(applicValues);
  return selected.some((v) => toks.some((t) => tokenMatches(t, v)));
}

/**
 * Why a value string is not allowed for a property (null = allowed). `values` = the declared enumerations; each is itself an applicPropertyValues
 * expression ("A|B|C", "001~100"), so a value is allowed when ANY enumeration matches it. No enumeration and no pattern = an open value.
 */
export function valueProblem(raw: string, values: string[], pattern: string | undefined, type: ValueType): string | null {
  const toks = parseValues(raw);
  if (!toks.length) return 'no value is given';
  for (const t of toks) {
    for (const v of [t.from, ...(t.to !== undefined ? [t.to] : [])]) {
      if (type === 'integer' && !/^-?\d+$/.test(v)) return `"${v}" is not an integer`;
      if (type === 'real' && !/^-?\d+(\.\d+)?$/.test(v)) return `"${v}" is not a number`;
      if (type === 'boolean' && !/^(true|false|0|1)$/i.test(v)) return `"${v}" is not a boolean`;
      if (pattern) { try { if (!new RegExp(`^(?:${pattern})$`).test(v)) return `"${v}" does not match the pattern ${pattern}`; } catch { /* bad pattern: not judged */ } }
      else if (values.length && !values.some((e) => valuesMatch(e, [v]))) return `"${v}" is not one of the declared values (${values.slice(0, 8).join(', ')}${values.length > 8 ? '…' : ''})`;
    }
  }
  return null;
}

// ── Locating the project's tables ────────────────────────────────────────────

function schemaOfFile(abs: string): string {
  try {
    const head = fs.readFileSync(abs, 'utf8').slice(0, 4000);
    const m = /noNamespaceSchemaLocation\s*=\s*"[^"]*\/([A-Za-z]+)\.xsd"/.exec(head);
    return m ? m[1] : '';
  } catch { return ''; }
}

/** File names of the project's ACT / CCT / PCT: the configured ones, else the data modules of those schemas. */
export function tableFiles(projectId: string): Record<TableKey, string | null> {
  const cfg = getConfig(projectId).applicability;
  const dir = csdbDir(projectId);
  const out: Record<TableKey, string | null> = { act: cfg.act, cct: cfg.cct, pct: cfg.pct };
  for (const k of Object.keys(TABLES) as TableKey[]) {
    if (out[k] && fs.existsSync(path.join(dir, out[k]!))) continue;
    out[k] = null;
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).sort()) if (DM_FILE_RE.test(f) && schemaOfFile(path.join(dir, f)) === TABLES[k].schema) { out[k] = f; break; }
  }
  return out;
}

// ── Reading the tables back into a model ─────────────────────────────────────

export const parse = (xml: string): Document => new DOMParser({ onError: () => undefined } as any).parseFromString(xml, 'text/xml') as unknown as Document;
export const kids = (el: Element, name?: string): Element[] => Array.from(el.childNodes).filter((n): n is Element => n.nodeType === 1 && (!name || (n as Element).nodeName === name));
const kid = (el: Element, name: string): Element | null => kids(el, name)[0] ?? null;
const txt = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
const all = (doc: Document | Element, name: string): Element[] => Array.from((doc as Document).getElementsByTagName(name)) as Element[];
const vt = (v: string | null): ValueType => (['integer', 'real', 'boolean'].includes(String(v)) ? (v as ValueType) : 'string');
const enums = (el: Element): Value[] => kids(el, 'enumeration').map((e) => ({ value: e.getAttribute('applicPropertyValues') ?? '', ...(e.getAttribute('enumerationLabel') ? { label: e.getAttribute('enumerationLabel')! } : {}) }));

export function readModel(projectId: string): { model: ApplicModel; files: Record<TableKey, string | null> } {
  const files = tableFiles(projectId); const dir = csdbDir(projectId); const model = emptyModel();
  const load = (k: TableKey) => (files[k] ? parse(fs.readFileSync(path.join(dir, files[k]!), 'utf8')) : null);
  const act = load('act'); const cct = load('cct'); const pct = load('pct');
  if (act) for (const a of all(act, 'productAttribute')) model.attributes.push({
    id: a.getAttribute('id') ?? '', name: txt(kid(a, 'name')), ...(kid(a, 'displayName') ? { displayName: txt(kid(a, 'displayName')) } : {}), descr: txt(kid(a, 'descr')),
    valueDataType: vt(a.getAttribute('valueDataType')), values: enums(a), ...(a.getAttribute('valuePattern') ? { valuePattern: a.getAttribute('valuePattern')! } : {}),
    ...(a.getAttribute('productIdentifier') && a.getAttribute('productIdentifier') !== 'no' ? { productIdentifier: a.getAttribute('productIdentifier') as 'primary' | 'secondary' } : {}),
  });
  if (cct) {
    for (const c of all(cct, 'condType')) model.conditionTypes.push({ id: c.getAttribute('id') ?? '', name: txt(kid(c, 'name')), descr: txt(kid(c, 'descr')), valueDataType: vt(c.getAttribute('valueDataType')), values: enums(c), ...(c.getAttribute('valuePattern') ? { valuePattern: c.getAttribute('valuePattern')! } : {}) });
    for (const c of all(cct, 'cond')) model.conditions.push({ id: c.getAttribute('id') ?? '', condTypeId: c.getAttribute('condTypeRefId') ?? '', name: txt(kid(c, 'name')), ...(kid(c, 'displayName') ? { displayName: txt(kid(c, 'displayName')) } : {}), descr: txt(kid(c, 'descr')) });
  }
  // <product id> is optional in the schema: a product without one is named product-N (and gets that id if the tables are saved again)
  if (pct) for (const [n, p] of (all(pct, 'product') as Element[]).entries()) model.products.push({ id: p.getAttribute('id') || `product-${n + 1}`, assigns: kids(p, 'assign').map((a) => ({ ident: a.getAttribute('applicPropertyIdent') ?? '', type: (a.getAttribute('applicPropertyType') === 'condition' ? 'condition' : 'prodattr') as 'prodattr' | 'condition', value: a.getAttribute('applicPropertyValue') ?? '' })) });
  return { model, files };
}

// ── Checking a model before it is written ────────────────────────────────────

export function modelProblems(m: ApplicModel): string[] {
  const out: string[] = []; const ids = new Set<string>();
  const dupe = (id: string, what: string) => { if (ids.has(id)) out.push(`${what} "${id}": the identifier is used twice (identifiers are unique across the three tables).`); ids.add(id); };
  const ident = (id: string, what: string) => { if (!NCNAME.test(id)) out.push(`${what} "${id}": an identifier starts with a letter and contains only letters, digits, "-", "_" and ".".`); };
  for (const a of m.attributes) {
    ident(a.id, 'Product attribute'); dupe(a.id, 'Product attribute');
    if (!a.name.trim()) out.push(`Product attribute "${a.id}": a name is required.`);
    if (!a.descr.trim()) out.push(`Product attribute "${a.id}": a description is required.`);
    for (const v of a.values) { if (!v.value.trim()) out.push(`Product attribute "${a.id}": a value is empty.`); else { const p = valueProblem(v.value, [], undefined, a.valueDataType); if (p) out.push(`Product attribute "${a.id}": value ${p}.`); } }
    if (new Set(a.values.map((v) => v.value)).size !== a.values.length) out.push(`Product attribute "${a.id}": a value is listed twice.`);
    if (a.valuePattern) { try { new RegExp(a.valuePattern); } catch { out.push(`Product attribute "${a.id}": the value pattern is not a valid expression.`); } }
  }
  const types = new Map(m.conditionTypes.map((t) => [t.id, t]));
  for (const t of m.conditionTypes) {
    ident(t.id, 'Condition type'); dupe(t.id, 'Condition type');
    if (!t.name.trim() || !t.descr.trim()) out.push(`Condition type "${t.id}": a name and a description are required.`);
    for (const v of t.values) { const p = v.value.trim() ? valueProblem(v.value, [], undefined, t.valueDataType) : 'is empty'; if (p) out.push(`Condition type "${t.id}": value ${p}.`); }
  }
  for (const c of m.conditions) {
    ident(c.id, 'Condition'); dupe(c.id, 'Condition');
    if (!types.has(c.condTypeId)) out.push(`Condition "${c.id}": its condition type "${c.condTypeId}" is not declared.`);
    if (!c.name.trim() || !c.descr.trim()) out.push(`Condition "${c.id}": a name and a description are required.`);
  }
  const attrs = new Map(m.attributes.map((a) => [a.id, a])); const conds = new Map(m.conditions.map((c) => [c.id, c]));
  for (const p of m.products) {
    ident(p.id, 'Product'); dupe(p.id, 'Product');
    if (!p.assigns.length) out.push(`Product "${p.id}": it assigns no value.`);
    for (const a of p.assigns) {
      if (a.type === 'prodattr') {
        const at = attrs.get(a.ident);
        if (!at) { out.push(`Product "${p.id}": "${a.ident}" is not a declared product attribute.`); continue; }
        const e = valueProblem(a.value, at.values.map((v) => v.value), at.valuePattern, at.valueDataType); if (e) out.push(`Product "${p.id}", ${a.ident}: ${e}.`);
      } else {
        const c = conds.get(a.ident);
        if (!c) { out.push(`Product "${p.id}": "${a.ident}" is not a declared condition.`); continue; }
        const t = types.get(c.condTypeId); if (!t) continue;
        const e = valueProblem(a.value, t.values.map((v) => v.value), t.valuePattern, t.valueDataType); if (e) out.push(`Product "${p.id}", ${a.ident}: ${e}.`);
      }
    }
  }
  return out;
}

// ── Writing the tables ───────────────────────────────────────────────────────

interface Ident { mic: string; issue: IssueKey; language: string; country: string; ent: { code: string; name: string }; security: string; brexDmc: string }

function identOf(projectId: string): Ident {
  const cfg = getConfig(projectId);
  if (!cfg.mic) throw bad('Set the project\'s model identification code first: the applicability tables are data modules with that code.', 'NO_MIC');
  if (!cfg.issue) throw bad('Set the project\'s S1000D issue first: the applicability tables are written for that issue.', 'NO_ISSUE');
  if (!cfg.responsiblePartner.code) throw bad('Set the project\'s responsible partner company first: every data module names it.', 'NO_RPC');
  const brexDmc = cfg.brex.mode === 'project' && cfg.brex.dmc ? cfg.brex.dmc : `S1000D-${defaultLetterFor(cfg.issue)}-04-10-0301-00A-022A-D`;
  return { mic: cfg.mic, issue: cfg.issue, language: cfg.language, country: cfg.country, ent: cfg.responsiblePartner, security: cfg.security, brexDmc };
}

const infoOf = (k: TableKey): string => String((listItems('dm-types') as any[]).find((t) => t.schema === TABLES[k].schema)?.infoCode || TABLES[k].fallbackInfo).toUpperCase();

function dmCode(mic: string, info: string): string {
  return `<dmCode modelIdentCode="${esc(mic)}" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="${esc(info)}" infoCodeVariant="A" itemLocationCode="D"/>`;
}
export const dmcFile = (mic: string, info: string, lang: string, country: string): string => `DMC-${mic}-A-00-00-00-00A-${info}A-D_001-00_${lang.toUpperCase()}-${country}.xml`;
/** The codes of the CCT / PCT data modules that really exist (an imported table need not carry the platform's conventional code). */
type TableCodes = { cct: string | null; pct: string | null };
const refTo = (tag: string, code: string | null, mic: string, info: string): string => `<${tag}><dmRef><dmRefIdent>${code ?? dmCode(mic, info)}</dmRefIdent></dmRef></${tag}>`;
function dmCodeOfFile(abs: string): string | null { try { return /<dmIdent>[\s\S]*?(<dmCode\s[^>]*\/>)/.exec(fs.readFileSync(abs, 'utf8').slice(0, 20000))?.[1] ?? null; } catch { return null; } }

function enumXml(values: Value[]): string { return values.map((v) => `<enumeration applicPropertyValues="${esc(v.value)}"${v.label ? ` enumerationLabel="${esc(v.label)}"` : ''}/>`).join(''); }

function contentFor(k: TableKey, m: ApplicModel, id: Ident, codes: TableCodes = { cct: null, pct: null }): string {
  if (k === 'act') {
    return `<content><applicCrossRefTable><productAttributeList>${m.attributes.map((a) =>
      `<productAttribute id="${esc(a.id)}"${a.valueDataType !== 'string' ? ` valueDataType="${a.valueDataType}"` : ''}${a.valuePattern ? ` valuePattern="${esc(a.valuePattern)}"` : ''}${a.productIdentifier ? ` productIdentifier="${a.productIdentifier}"` : ''}>` +
      `<name>${esc(a.name)}</name>${a.displayName ? `<displayName>${esc(a.displayName)}</displayName>` : ''}<descr>${esc(a.descr)}</descr>${enumXml(a.values)}</productAttribute>`).join('')}</productAttributeList>` +
      `${m.conditionTypes.length && m.conditions.length ? refTo('condCrossRefTableRef', codes.cct, id.mic, infoOf('cct')) : ''}${m.products.length ? refTo('productCrossRefTableRef', codes.pct, id.mic, infoOf('pct')) : ''}</applicCrossRefTable></content>`;
  }
  if (k === 'cct') {
    return `<content><condCrossRefTable><condTypeList>${m.conditionTypes.map((t) =>
      `<condType id="${esc(t.id)}"${t.valueDataType !== 'string' ? ` valueDataType="${t.valueDataType}"` : ''}${t.valuePattern ? ` valuePattern="${esc(t.valuePattern)}"` : ''}><name>${esc(t.name)}</name><descr>${esc(t.descr)}</descr>${enumXml(t.values)}</condType>`).join('')}</condTypeList>` +
      `<condList>${m.conditions.map((c) => `<cond id="${esc(c.id)}" condTypeRefId="${esc(c.condTypeId)}"><name>${esc(c.name)}</name>${c.displayName ? `<displayName>${esc(c.displayName)}</displayName>` : ''}<descr>${esc(c.descr)}</descr></cond>`).join('')}</condList></condCrossRefTable></content>`;
  }
  return `<content><productCrossRefTable>${m.products.map((p) => `<product id="${esc(p.id)}">${p.assigns.map((a) => `<assign applicPropertyIdent="${esc(a.ident)}" applicPropertyType="${a.type}" applicPropertyValue="${esc(a.value)}"/>`).join('')}</product>`).join('')}</productCrossRefTable></content>`;
}

function fullDm(k: TableKey, m: ApplicModel, id: Ident, codes: TableCodes): string {
  const d = new Date(); const p2 = (n: number) => String(n).padStart(2, '0');
  const info = infoOf(k);
  const brex = id.brexDmc.split('-');
  const brexCode = `<dmCode modelIdentCode="${esc(brex[0])}" systemDiffCode="${esc(brex[1])}" systemCode="${esc(brex[2])}" subSystemCode="${esc(brex[3][0])}" subSubSystemCode="${esc(brex[3][1])}" assyCode="${esc(brex[4])}" disassyCode="${esc(brex[5].slice(0, 2))}" disassyCodeVariant="${esc(brex[5].slice(2))}" infoCode="${esc(brex[6].slice(0, 3))}" infoCodeVariant="${esc(brex[6].slice(3))}" itemLocationCode="${esc(brex[7])}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<dmodule xmlns:dc="http://www.purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_${id.issue}/xml_schema_flat/${TABLES[k].schema}.xsd">
  <identAndStatusSection>
    <dmAddress>
      <dmIdent>
        ${dmCode(id.mic, info)}
        <language languageIsoCode="${esc(id.language)}" countryIsoCode="${esc(id.country)}"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </dmIdent>
      <dmAddressItems>
        <issueDate year="${d.getFullYear()}" month="${p2(d.getMonth() + 1)}" day="${p2(d.getDate())}"/>
        <dmTitle><techName>${esc(TABLES[k].title)}</techName></dmTitle>
      </dmAddressItems>
    </dmAddress>
    <dmStatus issueType="new">
      <security securityClassification="${esc(id.security)}"/>
      <responsiblePartnerCompany enterpriseCode="${esc(id.ent.code)}"><enterpriseName>${esc(id.ent.name)}</enterpriseName></responsiblePartnerCompany>
      <originator enterpriseCode="${esc(id.ent.code)}"><enterpriseName>${esc(id.ent.name)}</enterpriseName></originator>
      <applic><displayText><simplePara>All</simplePara></displayText></applic>
      <brexDmRef><dmRef><dmRefIdent>${brexCode}</dmRefIdent></dmRef></brexDmRef>
      <qualityAssurance><unverified/></qualityAssurance>
    </dmStatus>
  </identAndStatusSection>
  ${contentFor(k, m, id, codes)}
</dmodule>
`;
}

/** Replace only the <content> of an existing table module: its identification, issue and history are untouched. */
function withNewContent(existing: string, k: TableKey, m: ApplicModel, id: Ident, codes: TableCodes): string {
  const i = existing.indexOf('<content'); const j = existing.lastIndexOf('</content>');
  if (i < 0 || j < 0) throw conflict('The existing table data module has no <content>; it cannot be updated safely.', 'BAD_TABLE');
  return existing.slice(0, i) + contentFor(k, m, id, codes) + existing.slice(j + '</content>'.length);
}

export async function writeModel(projectId: string, model: ApplicModel, actor: { id: string; username: string; role?: string }, projectRole: string) {
  const problems = modelProblems(model);
  if (problems.length) throw new HttpError(400, `The applicability definitions have problems:\n- ${problems.join('\n- ')}`, 'BAD_APPLICABILITY', { problems });
  if (model.conditions.length && !model.conditionTypes.length) throw bad('Conditions need a condition type.', 'BAD_APPLICABILITY');
  const id = identOf(projectId);
  const files = tableFiles(projectId); const dir = csdbDir(projectId);
  const hasCct = model.conditionTypes.length > 0 && model.conditions.length > 0;
  if ((model.conditionTypes.length > 0) !== (model.conditions.length > 0)) throw bad('A conditions table needs at least one condition type AND one condition (or neither).', 'BAD_APPLICABILITY');
  if (files.cct && !hasCct) throw conflict('The project already has a conditions cross-reference table; it cannot be emptied here (a table needs at least one entry). Delete its data module if the project no longer uses conditions.', 'TABLE_EXISTS');
  if (files.pct && !model.products.length) throw conflict('The project already has a products cross-reference table; it cannot be emptied here (a table needs at least one product). Delete its data module if the project no longer uses products.', 'TABLE_EXISTS');
  const wanted: TableKey[] = ['act', ...(hasCct ? ['cct' as const] : []), ...(model.products.length ? ['pct' as const] : [])];
  if (!model.attributes.length && !files.act) throw bad('Define at least one product attribute: the cross-reference table needs one.', 'BAD_APPLICABILITY');
  if (!model.attributes.length) throw bad('The applicability cross-reference table needs at least one product attribute.', 'BAD_APPLICABILITY');
  // Build + XSD-check everything FIRST: nothing is stored unless every table is valid.
  const codes: TableCodes = { cct: files.cct ? dmCodeOfFile(path.join(dir, files.cct)) : null, pct: files.pct ? dmCodeOfFile(path.join(dir, files.pct)) : null };
  const planned: Array<{ k: TableKey; file: string; xml: string; exists: boolean }> = [];
  for (const k of wanted) {
    const file = files[k] ?? dmcFile(id.mic, infoOf(k), id.language, id.country);
    const exists = fs.existsSync(path.join(dir, file));
    const xml = exists ? withNewContent(fs.readFileSync(path.join(dir, file), 'utf8'), k, model, id, codes) : fullDm(k, model, id, codes);
    const res = await validateDocument(`${csdbRel(readProjectJson(projectId))}/${file}`, xml, { issue: id.issue === '4-2' ? '4.2' : id.issue === '5-0' ? '5.0' : id.issue === '6' ? '6.0' : '7.0' });
    if (res.diagnostics?.length) throw new HttpError(400, `The ${TABLES[k].title} would not be valid S1000D: ${res.diagnostics[0].message}`, 'TABLE_INVALID', { diagnostics: res.diagnostics.slice(0, 10) });
    planned.push({ k, file, xml, exists });
  }
  for (const p of planned) {
    if (p.exists) await writeDm(projectId, p.file, p.xml, undefined, actor, projectRole, true);
    else await createDm(projectId, p.file, p.xml, actor, true);
  }
  const cfgFiles = { act: files.act, cct: files.cct, pct: files.pct } as Record<TableKey, string | null>;
  for (const p of planned) cfgFiles[p.k] = p.file;
  updateConfig(projectId, { applicability: cfgFiles }, actor.id);
  return { files: cfgFiles, written: planned.map((p) => ({ table: p.k, file: p.file, created: !p.exists })), at: nowIso() };
}

// ── Validation of references ─────────────────────────────────────────────────

export const xpathOf = (el: Element): string => {
  const parts: string[] = [];
  for (let n: Node | null = el; n && n.nodeType === 1; n = n.parentNode) {
    const e = n as Element; const same = Array.from(e.parentNode?.childNodes ?? []).filter((c) => c.nodeType === 1 && c.nodeName === e.nodeName);
    parts.unshift(same.length > 1 ? `${e.nodeName}[${same.indexOf(e) + 1}]` : e.nodeName);
  }
  return '/' + parts.join('/');
};
export const lineOf = (el: Element): number => Number((el as any).lineNumber) || 1;

// ── Externalized applicability (S1000D 4.2 Chap 3.9.5.3 para 2.1.3.2, 3.9.5.2.1.13, 3.9.5.2.11.12) ─────────────────────
// A data module may collect its applicability annotations in a CIR data module instead of in itself: <applicRef applicIdentValue> + <dmRef>
// (in <dmStatus> or in <referencedApplicGroupRef> under <content>) -> the CIR's <applicSpec><applicSpecIdent applicIdentValue> ->
// applicMapRefId -> the <applic id> in that data module's <referencedApplicGroup>. The 4.2 text is the evidence; later issues UNVERIFIED.

/** The DMC string of a <dmCode> (the key data modules are looked up by). */
export const dmcKey = (code: Element | null | undefined): string => (code ? dmcString(Object.fromEntries(Array.from(code.attributes).map((a) => [a.name, a.value]))).toUpperCase() : '');
export type DmLookup = (dmc: string) => Document | null;
export interface ExternalApplic { applic?: Element; problem?: string }

/** The applicability annotations of one CIR data module, indexed once (a project can hold hundreds of references into the same module). */
const annotations = new WeakMap<Document, { mapByIdent: Map<string, string>; applicById: Map<string, Element> }>();
function annotationIndex(doc: Document) {
  let idx = annotations.get(doc);
  if (!idx) {
    const mapByIdent = new Map<string, string>(); const applicById = new Map<string, Element>();
    for (const s of Array.from(doc.getElementsByTagName('applicSpec')) as Element[]) {
      for (const i of Array.from(s.getElementsByTagName('applicSpecIdent')) as Element[]) { const v = i.getAttribute('applicIdentValue'); if (v && !mapByIdent.has(v)) mapByIdent.set(v, s.getAttribute('applicMapRefId') ?? ''); }
    }
    for (const a of Array.from(doc.getElementsByTagName('applic')) as Element[]) { const id = a.getAttribute('id'); if (id && !applicById.has(id)) applicById.set(id, a); }
    annotations.set(doc, idx = { mapByIdent, applicById });
  }
  return idx;
}

/** The <applic> an <applicRef> points to, or the reason it cannot be resolved (never a guess). */
export function resolveApplicRef(ref: Element, lookup: DmLookup): ExternalApplic {
  const ident = ref.getAttribute('applicIdentValue');
  const code = ref.getElementsByTagName('dmCode')[0];
  if (!ident) return { problem: '<applicRef> has no applicIdentValue.' };
  if (!code) return { problem: `<applicRef applicIdentValue="${ident}"> has no <dmRef> to the applicability annotations data module.` };
  const key = dmcKey(code);
  const doc = lookup(key);
  if (!doc) return { problem: `The applicability annotations data module ${key} is not in this project.` };
  const idx = annotationIndex(doc);
  const mapId = idx.mapByIdent.get(ident);
  if (mapId === undefined) return { problem: `${key} has no <applicSpec> with applicIdentValue="${ident}".` };
  const applic = idx.applicById.get(mapId);
  if (!applic) return { problem: `In ${key}, applicSpec "${ident}" has applicMapRefId="${mapId}", which matches no <applic id> there.` };
  return { applic };
}

/** Every <applicRef> of a data module that externalizes applicability: in <dmStatus> or under <referencedApplicGroupRef>. */
export const externalRefs = (doc: Document): Element[] => all(doc, 'applicRef').filter((r) => ['dmStatus', 'referencedApplicGroupRef'].includes((r.parentNode as Element | null)?.nodeName ?? ''));

/** Every applicability reference problem in the project, each with the data module and the XML location. */
/** WP-32 (PERF-001 stop-gap): async, and it gives the event loop a turn between modules so a large project does not freeze the server. */
export async function validateProject(projectId: string): Promise<Problem[]> {
  const tick = yielder();
  const out: Problem[] = []; const dir = csdbDir(projectId); if (!fs.existsSync(dir)) return out;
  const rel = (f: string) => `${csdbRel(readProjectJson(projectId))}/${f}`;
  const { model, files } = readModel(projectId);
  const attrs = new Map(model.attributes.map((a) => [a.id, a])); const conds = new Map(model.conditions.map((c) => [c.id, c]));
  const types = new Map(model.conditionTypes.map((t) => [t.id, t]));
  const tableSet = new Set(Object.values(files).filter(Boolean) as string[]);
  let sink: Problem[] = out;                                           // phase 8: a module's problems are collected on their own (kept per module)
  const add = (f: string, el: Element, code: string, message: string, severity: 'error' | 'warning' = 'error') => sink.push({ severity, file: rel(f), line: lineOf(el), location: xpathOf(el), code, message });

  // table integrity
  for (const p of modelProblems(model)) out.push({ severity: 'error', file: rel(files.act ?? files.cct ?? files.pct ?? ''), line: 1, location: '/dmodule/content', code: 'APPLIC-TABLE', message: p });
  if (files.act) {
    const doc = parse(fs.readFileSync(path.join(dir, files.act), 'utf8'));
    for (const tag of ['condCrossRefTableRef', 'productCrossRefTableRef'] as const) for (const r of all(doc, tag)) {
      const c = r.getElementsByTagName('dmCode')[0]; if (!c) continue;
      const want = `-${c.getAttribute('infoCode')}${c.getAttribute('infoCodeVariant')}-`.toUpperCase();
      const target = Array.from(fs.readdirSync(dir)).find((f) => f.toUpperCase().startsWith(`DMC-${c.getAttribute('modelIdentCode')}-`.toUpperCase()) && f.toUpperCase().includes(want));
      if (!target) add(files.act, r, 'APPLIC-ACT-REF', `The ACT refers to a ${tag === 'condCrossRefTableRef' ? 'conditions' : 'products'} cross-reference table (${c.getAttribute('infoCode')}) that is not in this project.`);
    }
  }
  for (const c of model.conditions) if (!types.has(c.condTypeId) && files.cct) out.push({ severity: 'error', file: rel(files.cct), line: 1, location: `//cond[@id='${c.id}']`, code: 'APPLIC-COND-TYPE', message: `Condition ${c.id} refers to the undeclared condition type ${c.condTypeId}.` });

  /*
    Data modules. Phase 8 (docs/phase3/cleanup-backend.md, item 5): what one module contributes depends on its text and on the tables (the
    model, the table files, the CSDB folder name: `ctx`), and - only for a module with externalized applicability (<applicRef>) - on the
    other modules (looked up by DMC). So each module's problems are kept per file version (size, times, file id) and ctx, and a module whose
    version and ctx are unchanged and that has no <applicRef> is not parsed again. When a module that IS checked has an <applicRef>, every
    module is parsed, as before, so its lookup sees exactly what it always saw. The order of the problems is the order of the listing.
  */
  const ctx = JSON.stringify({ model, files, csdb: rel('') });
  const listed = listDms(projectId);
  const docs: Array<Document | null> = new Array(listed.length).fill(null);
  const results: Array<Problem[] | null> = new Array(listed.length).fill(null);
  const sigs: Array<ApplicSig | null> = new Array(listed.length).fill(null);
  const keys: string[] = new Array(listed.length).fill('');
  const parseAt = (i: number): Document | null => {
    if (docs[i]) return docs[i];
    // as before: a module that cannot be read, parsed or keyed is left out (reported elsewhere)
    try { const doc = parse(fs.readFileSync(path.join(dir, listed[i].file), 'utf8')); keys[i] = dmcKey(doc.getElementsByTagName('dmCode')[0]); docs[i] = doc; } catch { docs[i] = null; }
    return docs[i];
  };
  let needLookup = false;
  for (let i = 0; i < listed.length; i++) {
    await tick();
    const abs = path.join(dir, listed[i].file);
    let st: fs.Stats; try { st = fs.statSync(abs); } catch { continue; }
    const sig: ApplicSig = { size: st.size, mtimeMs: st.mtimeMs, ctimeMs: st.ctimeMs, ino: st.ino }; sigs[i] = sig;
    const kept = applicKept.get(abs);
    if (kept && kept.ctx === ctx && sameSig(kept, sig)) { results[i] = kept.problems.map((p) => ({ ...p })); continue; }
    const doc = parseAt(i);
    if (doc && !tableSet.has(listed[i].file) && doc.documentElement?.nodeName === 'dmodule' && externalRefs(doc).length) needLookup = true;
  }
  const byDmc = new Map<string, Document>();
  if (needLookup) for (let i = 0; i < listed.length; i++) {
    await tick();
    if (parseAt(i)) byDmc.set(keys[i], docs[i]!);
  }
  const lookup: DmLookup = (dmc) => byDmc.get(dmc) ?? null;
  for (let i = 0; i < listed.length; i++) {
    if (results[i]) { out.push(...results[i]!); continue; }
    const doc = docs[i]; if (!doc) continue;
    await tick();
    const file = listed[i].file;
    sink = [];
    const external = checkModule(file, doc);
    out.push(...sink);
    const abs = path.join(dir, file);
    if (sigs[i] && !external) { applicKept.delete(abs); applicKept.set(abs, { ...sigs[i]!, ctx, problems: sink.map((p) => ({ ...p })) }); if (applicKept.size > 20000) { const first = applicKept.keys().next().value; if (first !== undefined) applicKept.delete(first); } }
    else applicKept.delete(abs);
    sink = out;
  }
  return out;

  /** The problems of one module (into `sink`); true when it has externalized applicability (its answer depends on other modules). */
  function checkModule(file: string, doc: Document): boolean {
    if (tableSet.has(file)) return false;
    const root = doc.documentElement; if (!root || root.nodeName !== 'dmodule') return false;
    const applics = all(doc, 'applic');
    const ids = new Map<string, Element>();
    for (const a of applics) { const id = a.getAttribute('id'); if (id) ids.set(id, a); }
    // externalized applicability: every <applicRef> must resolve; its id may then be the target of applicRefId
    for (const ref of externalRefs(doc)) {
      const id = ref.getAttribute('id'); if (id) ids.set(id, ref);
      const r = resolveApplicRef(ref, lookup);
      if (r.problem) add(file, ref, 'APPLIC-EXT-REF', r.problem);
    }
    // applicConfiguration is defined for illustrated parts data only (4.2 Chap 3.9.5.3 para 2.2); the XSD allows it elsewhere
    if (!all(doc, 'illustratedPartsCatalog').length) for (const a of applics) if (a.getAttribute('applicConfiguration')) add(file, a, 'APPLIC-CONFIG-NOT-IPD', `applicConfiguration="${a.getAttribute('applicConfiguration')}" is used outside an illustrated parts data module; the specification defines it for IPD data modules only.`, 'warning');
    // applicRefId -> applic id
    for (const el of all(doc, '*')) {
      const r = el.getAttribute('applicRefId');
      if (!r) continue;
      if (!ids.has(r)) add(file, el, 'APPLIC-REFID', `applicRefId="${r}" on <${el.nodeName}> does not match any <applic id> in this data module${ids.size ? ` (defined: ${[...ids.keys()].slice(0, 6).join(', ')})` : ' (it defines none: add a <referencedApplicGroup>)'}.`);
    }
    // assertions
    let usesAsserts = false;
    for (const a of all(doc, 'assert')) {
      const ident = a.getAttribute('applicPropertyIdent'); const type = a.getAttribute('applicPropertyType'); const vals = a.getAttribute('applicPropertyValues');
      if (!ident && !type && !vals) continue;                        // an <assert> used as free text (no property) asserts nothing
      usesAsserts = true;
      if (!ident || !type || !vals) { add(file, a, 'APPLIC-ASSERT', `<assert> needs applicPropertyIdent, applicPropertyType and applicPropertyValues together.`); continue; }
      if (!model.attributes.length && !model.conditions.length) { add(file, a, 'APPLIC-NO-TABLES', `"${ident}" cannot be checked: the project has no applicability definitions (ACT/CCT).`, 'warning'); continue; }
      if (type === 'prodattr') {
        const at = attrs.get(ident);
        if (!at) { add(file, a, 'APPLIC-PROPERTY', `Product attribute "${ident}" is not declared in the project's ACT.`); continue; }
        const e = valueProblem(vals, at.values.map((v) => v.value), at.valuePattern, at.valueDataType); if (e) add(file, a, 'APPLIC-VALUE', `${ident}: ${e}.`);
      } else if (type === 'condition') {
        const c = conds.get(ident);
        if (!c) { add(file, a, 'APPLIC-PROPERTY', `Condition "${ident}" is not declared in the project's CCT.`); continue; }
        const t = types.get(c.condTypeId);
        if (t) { const e = valueProblem(vals, t.values.map((v) => v.value), t.valuePattern, t.valueDataType); if (e) add(file, a, 'APPLIC-VALUE', `${ident}: ${e}.`); }
      } else add(file, a, 'APPLIC-ASSERT', `applicPropertyType="${type}" is not prodattr or condition.`);
    }
    // the ACT reference of the data module
    const actRef = all(doc, 'applicCrossRefTableRef')[0];
    if (actRef) {
      const c = actRef.getElementsByTagName('dmCode')[0];
      if (c && !files.act) add(file, actRef, 'APPLIC-ACT-MISSING', 'The data module refers to an applicability cross-reference table, but this project has none.');
      else if (c && files.act && !files.act.toUpperCase().startsWith(`DMC-${c.getAttribute('modelIdentCode')}-`.toUpperCase())) add(file, actRef, 'APPLIC-ACT-OTHER', `The data module's ACT (${c.getAttribute('modelIdentCode')}) is not this project's ACT (${files.act}).`, 'warning');
    } else if (usesAsserts && files.act) add(file, root, 'APPLIC-ACT-REF-MISSING', 'The data module uses applicability assertions but has no <applicCrossRefTableRef> to the project ACT.', 'warning');
    return externalRefs(doc).length > 0;
  }
}

interface ApplicSig { size: number; mtimeMs: number; ctimeMs: number; ino: number }
const sameSig = (a: ApplicSig, b: ApplicSig): boolean => a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino;
/** phase 8: each module's applicability problems, per file version and table context (modules with externalized applicability are never kept) */
const applicKept = new Map<string, ApplicSig & { ctx: string; problems: Problem[] }>();
/** Forget the kept per-module problems (tests). */
export function clearApplicKept(): void { applicKept.clear(); }

