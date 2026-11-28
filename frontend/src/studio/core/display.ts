/**
 * Presentation classification of S1000D elements, shared by the whitespace
 * normaliser, the XML pretty-printer and the WYSIWYG renderer.
 */
import type { Grammar } from './grammar';
import * as form from '../../../../backend/src/shared/collab/xmlForm';

export type Display = 'block' | 'inline' | 'atomic' | 'none' | 'table-part';

/** Elements that are always laid out as blocks (Phase 3: the list lives in the shared written-form module, used by the collaboration server too). */
export const BLOCK = form.BLOCK;

/** Elements rendered as non-editable chips (edited through dialogs / attributes). */
export const ATOMIC = new Set<string>([
  'dmRef', 'pmRef', 'internalRef', 'dmCode', 'issueInfo', 'language', 'issueDate', 'security', 'footnoteRef', 'commentRef',
  'dmlRef', 'infoEntityRef', 'firstVerification', 'secondVerification', 'unverified', 'brexDmRef', 'applicRef', 'sourceDmIdent',
  'repositorySourceDmIdent', 'externalPubCode', 'catalogSeqNumberRef', 'pmCode', 'indexFlag',
  'noConds', 'noSupportEquips', 'noSupplies', 'noSpares', 'noSafety', 'skillLevel', 'symbol',
]);

/** Block-level objects rendered as non-editable boxes (selected and edited as a whole). */
export const ATOMIC_BLOCK = new Set<string>(['graphic', 'multimediaObject', 'hotspot']);

/**
 * Elements that are always inline, even though their own content model is
 * element-only. `acronym` is itself an inline element within running text, but its
 * content model is `acronymTerm, acronymDefinition` (element-only) — without this
 * override those two children would render as block `<div>`s nested inside the
 * `acronym` `<span>`, forcing the acronym onto its own line.
 * `elementDisplay` additionally applies the general rule "an element-only child of an
 * inline element is inline" (externalPubRef/externalPubRefIdent/externalPubTitle...),
 * so this list only needs names whose parent is not itself inline.
 */
export const FORCE_INLINE = new Set<string>(['acronymTerm', 'acronymDefinition']);

/** Elements whose content is whitespace-preserving. */
export const PRESERVE = form.PRESERVE;

/** Never rendered in the design view (still visible in XML view / tree). */
export const HIDDEN = new Set<string>(['colspec', 'spanspec', 'rdf:Description']);

/**
 * Elements that are normally inline but carry block-level elements inside
 * mixed content; treated as blocks so lists inside paragraphs lay out correctly.
 */
export function isBlockName(name: string): boolean {
  return form.isBlockName(name);
}

export function elementDisplay(el: Element, grammar: Grammar | null): Display {
  const name = el.nodeName;
  if (HIDDEN.has(name)) return 'none';
  if (ATOMIC.has(name)) {
    // atomic chips live inline unless their parent is element-only
    return 'atomic';
  }
  if (BLOCK.has(name)) return 'block';
  if (FORCE_INLINE.has(name)) return 'inline';
  const parent = el.parentNode as Element | null;
  if (parent && parent.nodeType === 1) {
    if (grammar?.has(parent.nodeName)) {
      if (grammar.allowsText(parent.nodeName)) return 'inline';
      // children of an element-only element that is itself inline (acronym, externalPubRef, ...) stay on the line
      return elementDisplay(parent, grammar) === 'inline' ? 'inline' : 'block';
    }
    // unknown parent: inline if parent has real text
    for (const c of Array.from(parent.childNodes)) if (c.nodeType === 3 && /\S/.test(c.nodeValue || '')) return 'inline';
    return 'block';
  }
  return 'block';
}

/** Whether an element's content is element-only (whitespace insignificant). */
export function isElementOnly(el: Element, grammar: Grammar | null): boolean {
  return form.isElementOnly(el as unknown as form.XElement, grammar);
}

export function isPreserved(el: Element): boolean {
  return form.isPreserved(el as unknown as form.XElement);
}
