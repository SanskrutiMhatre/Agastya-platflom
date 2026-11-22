/**
 * S1000D warnings and cautions that are *referenced* rather than written out.
 *
 * A data module can hold a warning in three ways:
 *  1. written in place (`warning` / `caution` / `note` in the text, in `safetyRqmts` or in the content-level
 *     `warningsAndCautions`): rendered directly;
 *  2. declared in `warningsAndCautionsRef` as `warningRef warningIdentNumber="..."` / `cautionRef
 *     cautionIdentNumber="..."`, each with an `id`;
 *  3. attached to a part of the content with `warningRefs="id ..."` / `cautionRefs="id ..."`, which means "print
 *     these warnings/cautions with this paragraph, step, safety section, ...".
 *
 * The text of a referenced warning lives in a *warnings repository* data module (`warningRepository/warningSpec` +
 * `cautionRepository/cautionSpec`, found by identification number). Specs are collected from every data module that is
 * part of the export, so a publication that contains the repository prints the real text. When it does not, the
 * reference number is printed and the export reports it.
 */
import { elementChildren } from '../core/xml';

export type AttentionKind = 'warning' | 'caution';

/** A `warningSpec` / `cautionSpec` of a repository data module. */
export interface AttentionSpec {
  kind: AttentionKind;
  ident: string;
  symbols: Element[];
  paras: Element[];
}

export interface Repository {
  warnings: Map<string, AttentionSpec>;
  cautions: Map<string, AttentionSpec>;
}

/** One `warningRef` / `cautionRef` of the current data module. */
export interface AttentionRef {
  id: string;
  kind: AttentionKind;
  ident: string;
}

export function emptyRepository(): Repository {
  return { warnings: new Map(), cautions: new Map() };
}

function specOf(el: Element, kind: AttentionKind): AttentionSpec | null {
  const identEl = elementChildren(el).find((c) => c.nodeName === (kind === 'warning' ? 'warningIdent' : 'cautionIdent'));
  const ident = identEl?.getAttribute(kind === 'warning' ? 'warningIdentNumber' : 'cautionIdentNumber') ?? '';
  if (!ident) return null;
  return {
    kind,
    ident,
    symbols: elementChildren(el).filter((c) => c.nodeName === 'symbol'),
    paras: elementChildren(el).filter((c) => c.nodeName === 'warningAndCautionPara'),
  };
}

/** Every warning and caution specification found in the given data modules (the first one wins on a duplicate). */
export function buildRepository(docs: Document[]): Repository {
  const repo = emptyRepository();
  for (const doc of docs) {
    for (const el of Array.from(doc.getElementsByTagName('warningSpec'))) {
      const s = specOf(el, 'warning');
      if (s && !repo.warnings.has(s.ident)) repo.warnings.set(s.ident, s);
    }
    for (const el of Array.from(doc.getElementsByTagName('cautionSpec'))) {
      const s = specOf(el, 'caution');
      if (s && !repo.cautions.has(s.ident)) repo.cautions.set(s.ident, s);
    }
  }
  return repo;
}

/** The `warningRef` / `cautionRef` declarations of a data module, by their `id`. */
export function declaredRefs(doc: Document): Map<string, AttentionRef> {
  const map = new Map<string, AttentionRef>();
  for (const el of Array.from(doc.getElementsByTagName('warningRef'))) {
    const id = el.getAttribute('id');
    if (id) map.set(id, { id, kind: 'warning', ident: el.getAttribute('warningIdentNumber') ?? '' });
  }
  for (const el of Array.from(doc.getElementsByTagName('cautionRef'))) {
    const id = el.getAttribute('id');
    if (id) map.set(id, { id, kind: 'caution', ident: el.getAttribute('cautionIdentNumber') ?? '' });
  }
  return map;
}

/** Ids named by the `warningRefs` / `cautionRefs` attributes of one element, warnings first, in attribute order. */
export function referencedIds(el: Element): string[] {
  const ids = (a: string) => (el.getAttribute(a) ?? '').split(/\s+/).filter(Boolean);
  return [...ids('warningRefs'), ...ids('cautionRefs')];
}

/** Ids of all declared references that some element of the data module points at through `warningRefs` / `cautionRefs`. */
export function usedRefIds(doc: Document): Set<string> {
  const used = new Set<string>();
  for (const el of Array.from(doc.getElementsByTagName('*'))) {
    if (el.hasAttribute('warningRefs') || el.hasAttribute('cautionRefs')) for (const id of referencedIds(el)) used.add(id);
  }
  return used;
}
