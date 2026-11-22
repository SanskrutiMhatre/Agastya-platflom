// =============================================================================
// Applicability resolution and configuration-specific publication planning.
//
// A CONFIGURATION is a set of values for the project's product attributes and conditions: either a PCT product (predefined), or ad-hoc
// values chosen at publication time, or a product with some values overridden. Evaluating a configuration against the data modules
// decides what a configuration-specific publication contains.
//
// RULES (S1000D Issue 4.2, Chap 3.9.5.3; the decisions are recorded in docs/S1000D_REFERENCE_CONFIG.md)
//   assert        matches when ANY value the configuration gives for that property matches ANY token of applicPropertyValues
//                 ("A", "A|B", "1~5"; a range compares numerically when both ends and the value are numbers, otherwise as text)
//   evaluate      andOr="and" / "or" over its assert / evaluate children, with THREE values: true, false, unresolved
//   unresolved    a property the configuration gives no value for. It is not "satisfied": it makes the result unresolved unless the logic
//                 already decides it (false AND anything = false; true OR anything = true). An unresolved result that matters BLOCKS the
//                 configuration publication, and is reported with the property, the data module and the location.
//   no applicRefId  content without one is always included; an <applic> with display text only (no assert/evaluate) asserts nothing
//   false          excludes the element carrying the applicRefId, the data module whose own <dmStatus><applic> is false, or the PM entry
//                  whose applicRefId is false; PM entries left without anything to publish are removed, with empty parents
// Nothing here changes a source file: the filtered copies exist only in the build's own work directory.
// =============================================================================

import crypto from 'crypto';
import { XMLSerializer } from '@xmldom/xmldom';
import { HttpError, bad } from './http';
import { readModel, valueProblem, parseValues, tokenMatches, valuesMatch, dmcKey, resolveApplicRef, externalRefs, parse, kids, lineOf, xpathOf as pathOf, type ApplicModel, type DmLookup } from './applicability';

export type Tri = boolean | null;
export interface ConfigInput { productId?: string; values?: Array<{ ident: string; type?: 'prodattr' | 'condition'; value: string }> }
export interface Selection { values: Map<string, string[]>; productId: string | null; label: string; slug: string; summary: Array<{ ident: string; value: string }> }

const ser = (doc: Document): string => new XMLSerializer().serializeToString(doc as any);

// ── The configuration ────────────────────────────────────────────────────────

const slugOf = (s: string): string => s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 70) || 'configuration';

/** Build the values of a configuration from a PCT product and/or ad-hoc values (ad-hoc values replace the product's for the same property). */
export function buildSelection(projectId: string, input: ConfigInput): Selection {
  const { model } = readModel(projectId);
  const values = new Map<string, string[]>();
  let productId: string | null = null;
  if (input.productId) {
    const p = model.products.find((x) => x.id === input.productId);
    if (!p) throw bad(`This project's PCT has no product "${input.productId}".`, 'NO_SUCH_PRODUCT');
    productId = p.id;
    for (const a of p.assigns) { const cur = values.get(a.ident) ?? []; cur.push(a.value); values.set(a.ident, cur); }
  }
  const adhoc = new Map<string, string[]>();
  for (const v of input.values ?? []) {
    const ident = String(v.ident ?? '').trim(); const value = String(v.value ?? '').trim();
    if (!ident || !value) throw bad('A configuration value needs a property and a value.', 'BAD_CONFIGURATION');
    (adhoc.get(ident) ?? adhoc.set(ident, []).get(ident)!).push(value);
  }
  for (const [k, v] of adhoc) values.set(k, v);
  if (!values.size) throw bad('A configuration needs a product or at least one value.', 'BAD_CONFIGURATION');
  // every value must be one the project's definitions allow (an unknown property or a value outside its enumeration is refused)
  const problems = checkValues(model, values);
  if (problems.length) throw new HttpError(400, `The configuration is not valid for this project:\n- ${problems.join('\n- ')}`, 'BAD_CONFIGURATION', { problems });
  const summary = [...values.entries()].flatMap(([ident, vs]) => vs.map((value) => ({ ident, value }))).sort((a, b) => a.ident.localeCompare(b.ident) || a.value.localeCompare(b.value));
  const label = productId && !adhoc.size ? productId : summary.map((s) => `${s.ident}=${s.value}`).join(', ');
  // a product keeps its own name; values given on top of it (or alone) are appended, with a short hash of the exact values so that two different
  // configurations can never share a file name ("A B" and "A-B" read alike once cleaned)
  const adhocSummary = [...adhoc.entries()].flatMap(([ident, vs]) => vs.map((v) => `${ident}-${v}`)).sort().join('_');
  const hash = crypto.createHash('sha256').update(JSON.stringify(summary)).digest('hex').slice(0, 6);
  const readable = productId ? slugOf(productId) + (adhoc.size ? '+' + slugOf(adhocSummary).slice(0, 50) : '') : slugOf(summary.map((s) => `${s.ident}-${s.value}`).join('_')).slice(0, 60);
  const slug = adhoc.size || !productId ? `${readable}-${hash}` : readable;
  return { values, productId, label, slug, summary };
}

function checkValues(model: ApplicModel, values: Map<string, string[]>): string[] {
  const out: string[] = [];
  const attrs = new Map(model.attributes.map((a) => [a.id, a])); const conds = new Map(model.conditions.map((c) => [c.id, c]));
  const types = new Map(model.conditionTypes.map((t) => [t.id, t]));
  for (const [ident, vs] of values) {
    const a = attrs.get(ident); const c = conds.get(ident);
    if (!a && !c) { out.push(`"${ident}" is not a product attribute or condition of this project.`); continue; }
    const enumVals = (a ? a.values : types.get(c!.condTypeId)?.values ?? []).map((x) => x.value);
    for (const v of vs) {
      // a configuration states what the product IS: one concrete value. A set or range ("A|B", "1~5") is only meaningful in an assertion.
      const toks = parseValues(v);
      if (!enumVals.includes(v) && (toks.length !== 1 || toks[0].to !== undefined)) { out.push(`${ident}: "${v}" is a set or a range; a configuration needs one concrete value.`); continue; }
      const e = a ? valueProblem(v, a.values.map((x) => x.value), a.valuePattern, a.valueDataType)
        : (() => { const t = types.get(c!.condTypeId); return t ? valueProblem(v, t.values.map((x) => x.value), t.valuePattern, t.valueDataType) : null; })();
      if (e) out.push(`${ident}: ${e}.`);
    }
  }
  return out;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

export { tokenMatches, valuesMatch };

interface Ev { r: Tri; un: Set<string> }
const T: Ev = { r: true, un: new Set() };

function evalNode(el: Element, sel: Selection): Ev {
  if (el.nodeName === 'assert') {
    const ident = el.getAttribute('applicPropertyIdent');
    const values = el.getAttribute('applicPropertyValues');
    if (!ident || !values) return T;                                   // free text: asserts nothing
    const chosen = sel.values.get(ident);
    if (!chosen) return { r: null, un: new Set([ident]) };
    return { r: valuesMatch(values, chosen), un: new Set() };
  }
  if (el.nodeName === 'evaluate') {
    const parts = kids(el).filter((k) => k.nodeName === 'assert' || k.nodeName === 'evaluate').map((k) => evalNode(k, sel));
    if (!parts.length) return T;
    const and = el.getAttribute('andOr') !== 'or';
    const decided = parts.find((p) => p.r === !and);                   // a false for "and", a true for "or" decides the whole thing
    if (decided) return { r: !and, un: new Set() };
    const open = parts.filter((p) => p.r === null);
    if (open.length) return { r: null, un: new Set(open.flatMap((p) => [...p.un])) };
    return { r: and, un: new Set() };
  }
  return T;
}

/** The result of an <applic>: its assert / evaluate (display text alone asserts nothing). */
export function evalApplic(applic: Element, sel: Selection): { result: Tri; unresolved: string[] } {
  const body = kids(applic).find((k) => k.nodeName === 'assert' || k.nodeName === 'evaluate');
  if (!body) return { result: true, unresolved: [] };
  const e = evalNode(body, sel);
  return { result: e.r, unresolved: [...e.un].sort() };
}

// ── A data module ────────────────────────────────────────────────────────────

export interface Unresolved { file: string; line: number; location: string; properties: string[]; what: string }
export interface DmPlan { file: string; included: boolean; reason: string; xml: string; removed: number; unresolved: Unresolved[]; dmc: string }


const hasAncestorIn = (el: Element, set: Set<Element>): boolean => { for (let p = el.parentNode; p; p = p.parentNode) if (set.has(p as Element)) return true; return false; };

export function planDm(file: string, xml: string, sel: Selection, lookup: DmLookup = () => null): DmPlan {
  const doc = parse(xml); const root = doc.documentElement;
  const dmc = dmcKey(doc.getElementsByTagName('dmCode')[0]);
  const plan: DmPlan = { file, included: true, reason: '', xml, removed: 0, unresolved: [], dmc };
  if (!root || root.nodeName !== 'dmodule') return plan;
  // the data module's own applicability
  const status = kids(root, 'identAndStatusSection')[0] && kids(kids(root, 'identAndStatusSection')[0], 'dmStatus')[0];
  // <applic>, or an externalized <applicRef> into the applicability annotations CIR (4.2 Chap 3.9.5.2.1.13); an unresolvable one is the validation's finding
  const ownRef = status ? kids(status, 'applicRef')[0] : undefined;
  const own = (status ? kids(status, 'applic')[0] : undefined) ?? (ownRef ? resolveApplicRef(ownRef, lookup).applic : undefined);
  if (own) {
    const r = evalApplic(own, sel);
    if (r.result === false) return { ...plan, included: false, reason: 'its own applicability does not apply to this configuration' };
    if (r.result === null) plan.unresolved.push({ file, line: lineOf(ownRef ?? own), location: pathOf(ownRef ?? own), properties: r.unresolved, what: 'the data module\'s own applicability' });
  }
  // the elements that carry an applicRefId
  const defs = new Map<string, Element>();
  for (const a of Array.from(doc.getElementsByTagName('applic')) as Element[]) { const id = a.getAttribute('id'); if (id) defs.set(id, a); }
  for (const r of externalRefs(doc)) { const id = r.getAttribute('id'); const ext = id ? resolveApplicRef(r, lookup).applic : undefined; if (id && ext) defs.set(id, ext); }
  const doomed: Element[] = []; const open: Array<{ el: Element; u: Unresolved }> = [];
  for (const el of Array.from(doc.getElementsByTagName('*')) as Element[]) {
    const ref = el.getAttribute('applicRefId'); if (!ref) continue;
    const def = defs.get(ref); if (!def) continue;                   // a dangling reference is the validation's finding, not an exclusion
    const r = evalApplic(def, sel);
    if (r.result === false) doomed.push(el);
    else if (r.result === null) open.push({ el, u: { file, line: lineOf(el), location: pathOf(el), properties: r.unresolved, what: `<${el.nodeName} applicRefId="${ref}">` } });
  }
  const gone = new Set(doomed);
  // something that is not decided only matters if it would be published: inside an element that is removed it never is
  for (const { el, u } of open) if (!hasAncestorIn(el, gone)) plan.unresolved.push(u);
  for (const el of doomed) {
    if (hasAncestorIn(el, gone)) continue;
    el.parentNode?.removeChild(el); plan.removed++;
  }
  plan.xml = plan.removed ? ser(doc) : xml;
  return plan;
}

// ── The publication module ───────────────────────────────────────────────────

export interface PmPlan { xml: string; removedEntries: number; unresolved: Unresolved[] }

/** Filter the PM: entries whose applicRefId is false, references to data modules that do not apply, and what that leaves empty. */
export function planPm(pmXml: string, pmFile: string, sel: Selection, excluded: Set<string>, excludedFiles: Set<string>): PmPlan {
  const doc = parse(pmXml); const root = doc.documentElement;
  const out: PmPlan = { xml: pmXml, removedEntries: 0, unresolved: [] };
  if (!root) return out;
  const defs = new Map<string, Element>();
  for (const a of Array.from(doc.getElementsByTagName('applic')) as Element[]) { const id = a.getAttribute('id'); if (id) defs.set(id, a); }
  const removed = new Set<Element>();
  const remove = (el: Element) => { removed.add(el); el.parentNode?.removeChild(el); out.removedEntries++; };
  const entries = Array.from(doc.getElementsByTagName('pmEntry')) as Element[];
  for (const e of entries) {
    const ref = e.getAttribute('applicRefId'); const def = ref ? defs.get(ref) : undefined;
    if (!def || hasAncestorIn(e, removed)) continue;       // inside an entry that is already gone: neither counted nor evaluated
    const r = evalApplic(def, sel);
    if (r.result === false) remove(e);
    else if (r.result === null) out.unresolved.push({ file: pmFile, line: lineOf(e), location: pathOf(e), properties: r.unresolved, what: `<pmEntry applicRefId="${ref}">` });
  }
  for (const d of Array.from(doc.getElementsByTagName('dmRef')) as Element[]) {
    const code = dmcKey(d.getElementsByTagName('dmCode')[0]);
    if (code && excluded.has(code) && d.parentNode) { d.parentNode.removeChild(d); out.removedEntries++; }
  }
  for (const inc of (Array.from(doc.getElementsByTagName('*')) as Element[]).filter((n) => /(^|:)include$/.test(n.nodeName))) {
    const href = (inc.getAttribute('href') ?? '').replace(/\\/g, '/').replace(/^.*\//, '').toLowerCase();
    if (href && excludedFiles.has(href) && inc.parentNode) { inc.parentNode.removeChild(inc); out.removedEntries++; }
  }
  // an entry with nothing left to publish goes too, innermost first
  const pending = (Array.from(doc.getElementsByTagName('pmEntry')) as Element[]).reverse();
  for (const e of pending) {
    const live = kids(e).some((k) => k.nodeName !== 'pmEntryTitle');
    if (!live && e.parentNode) remove(e);
  }
  out.xml = ser(doc);
  return out;
}

// ── The whole plan ───────────────────────────────────────────────────────────

export interface ConfiguredPlan {
  selection: Selection; files: DmPlan[]; pm: PmPlan; excluded: string[]; filtered: number;
  /** Everything that decides the output but cannot be decided from the configuration. Empty when the publication can be built. */
  unresolved: Unresolved[];
  summary: { included: number; excluded: number; elementsRemoved: number; entriesRemoved: number; entriesLeft: number };
}

export function planConfiguration(
  sel: Selection, pmFile: string, pmXml: string, dms: Array<{ file: string; xml: string }>,
): ConfiguredPlan {
  const byDmc = new Map<string, Document>();
  for (const d of dms) { const doc = parse(d.xml); byDmc.set(dmcKey(doc.getElementsByTagName('dmCode')[0]), doc); }
  const files = dms.map((d) => planDm(d.file, d.xml, sel, (dmc) => byDmc.get(dmc) ?? null));
  const excluded = files.filter((f) => !f.included);
  const pm = planPm(pmXml, pmFile, sel, new Set(excluded.map((f) => f.dmc)), new Set(excluded.map((f) => f.file.toLowerCase())));
  const unresolved = [...files.flatMap((f) => f.unresolved), ...pm.unresolved];
  return {
    selection: sel, files, pm, excluded: excluded.map((f) => f.file), filtered: files.filter((f) => f.removed).length, unresolved,
    summary: { included: files.length - excluded.length, excluded: excluded.length, elementsRemoved: files.reduce((a, f) => a + f.removed, 0), entriesRemoved: pm.removedEntries, entriesLeft: (pm.xml.match(/<pmEntry[\s>]/g) ?? []).length },
  };
}

/** Refuse a configuration that cannot be resolved: nothing is built from guesses. */
export function assertResolved(plan: ConfiguredPlan): void {
  if (plan.unresolved.length) {
    const props = [...new Set(plan.unresolved.flatMap((u) => u.properties))];
    throw new HttpError(422,
      `This configuration does not give a value for ${props.map((p) => `"${p}"`).join(', ')}, which decides what the publication contains (${plan.unresolved.length} place${plan.unresolved.length === 1 ? '' : 's'}, first: ${plan.unresolved[0].file} ${plan.unresolved[0].what}). Add the value(s) and try again.`,
      'APPLICABILITY_UNRESOLVED', { unresolved: plan.unresolved.slice(0, 100), properties: props });
  }
  if (!plan.summary.included) throw new HttpError(422, 'No data module applies to this configuration: there is nothing to publish.', 'NOTHING_APPLIES', {});
}

export const configHash = (sel: Selection): string => crypto.createHash('sha256').update(JSON.stringify(sel.summary)).digest('hex').slice(0, 10);
