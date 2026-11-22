/**
 * S1000D applicability for the publication PDF.
 *
 * Two levels matter in print:
 *  - the data module's own applicability (`dmStatus/applic/displayText`): the reference prints it behind
 *    "Applicable to:" in the footer of every page of the data module and in the last column of the
 *    document-contents table (it is empty where the data module has no display text);
 *  - applicability of parts of the content (`applicRefId` on a paragraph, step, table, warning, ...): the id points
 *    at an `applic` element of the data module's `referencedApplicGroup`. A part that is only valid for a subset of
 *    what the data module covers carries an "Applicable to: ..." note, so a printed copy still shows which
 *    configuration an instruction belongs to.
 *
 * The human-readable text is the author's `displayText`. Where an annotation has none, a readable form of its
 * `assert` / `evaluate` expression is derived (`version = A or B`) so the note is never blank.
 */
import { elementChildren } from '../core/xml';
import { find } from '../core/s1000d';

const squeeze = (s: string): string => s.replace(/\s+/g, ' ').trim();

function valuesText(v: string): string {
  return v.split('|').map((x) => x.replace('~', ' to ')).join(' or ');
}

function assertText(a: Element): string {
  const ident = a.getAttribute('applicPropertyIdent') ?? '';
  const values = valuesText(a.getAttribute('applicPropertyValues') ?? '');
  return ident ? `${ident} = ${values}` : values;
}

/** `assert` / `evaluate` tree -> "a = 1 and (b = 2 or b = 3)". */
function expressionText(el: Element): string {
  const parts: string[] = [];
  for (const c of elementChildren(el)) {
    if (c.nodeName === 'assert') parts.push(assertText(c));
    else if (c.nodeName === 'evaluate') {
      const inner = expressionText(c);
      if (inner) parts.push(elementChildren(c).length > 1 ? `(${inner})` : inner);
    }
  }
  return parts.filter(Boolean).join(` ${el.getAttribute('andOr') ?? 'and'} `);
}

/** The text of one `applic` element: its display text, else a derived expression. */
export function applicText(applic: Element | null, derive = true): string {
  if (!applic) return '';
  const display = elementChildren(applic).find((c) => c.nodeName === 'displayText');
  const text = display ? elementChildren(display).filter((c) => c.nodeName === 'simplePara').map((p) => squeeze(p.textContent ?? '')).filter(Boolean).join('; ') : '';
  if (text) return text;
  return derive ? squeeze(expressionText(applic)) : '';
}

/** Applicability of the whole data module ("" when the data module carries no display text). */
export function dmApplicText(doc: Document): string {
  const status = find(doc.documentElement, 'dmStatus');
  const applic = status ? elementChildren(status).find((c) => c.nodeName === 'applic') ?? null : null;
  return applicText(applic, false);
}

/** `applic/@id` -> text, for every annotation of the data module (the `referencedApplicGroup` ones in practice). */
export function applicIndex(doc: Document): Map<string, string> {
  const map = new Map<string, string>();
  for (const a of Array.from(doc.getElementsByTagName('applic'))) {
    const id = a.getAttribute('id');
    if (!id) continue;
    const text = applicText(a);
    if (text) map.set(id, text);
  }
  return map;
}
