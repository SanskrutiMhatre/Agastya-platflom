// =============================================================================
// Where a document's real content starts.
//
// A data module's prolog can be long: every graphic is declared as an <!ENTITY ... NDATA ...> in the
// DOCTYPE, and a module with hundreds of figures has a DOCTYPE of tens of kilobytes. Code that looks
// for the root element (or the identity inside it) in a fixed-size prefix of the file then sees only
// the prolog and wrongly concludes "not a data module". These helpers measure from the root element
// instead of from byte 0.
// =============================================================================

/** Reading a start tag's attributes off the head without a full parse (audit S1K-007: one helper instead of four). */
export { readAttrs } from '../lib/xml';

/** How much of a document, counted from its root element, holds its identity and status section. */
export const HEAD_BYTES = 12288;
/** The prolog is searched up to here; a longer one is not a document this tool should be reading. */
export const MAX_PROLOG = 2 * 1024 * 1024;

/** Index of the root element's opening tag (`<dmodule`, `<pm`), or -1. */
export function rootStart(xml: string, root: string): number {
  return xml.slice(0, MAX_PROLOG).search(new RegExp(`<${root}[\\s>/]`));
}

/** The start of the document up to `size` characters past its root element's opening tag (the prolog is kept). */
export function headOf(xml: string, root = 'dmodule', size = HEAD_BYTES): string {
  const i = rootStart(xml, root);
  return xml.slice(0, (i < 0 ? 0 : i) + size);
}
