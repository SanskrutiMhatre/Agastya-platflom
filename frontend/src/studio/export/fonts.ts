/**
 * Lazy-loaded fonts for PDF export. pdfmake 0.3's browser build ships no
 * fonts by default; font data must be registered explicitly via
 * `addFontContainer`. We register:
 *  - Helvetica (a PDF standard-14 font: no file download, and metric-compatible
 *    with the Arial the reference publication is typeset in) as the body and
 *    heading font. It only covers the Windows-1252 repertoire.
 *  - Roboto (bundled with pdfmake, a real Unicode TTF: Latin, Greek and most of
 *    the "common math" block) as the per-run fallback for any character
 *    Helvetica cannot encode (see `pdf-metrics.ts#fontRuns`).
 *  - Courier (standard-14) for verbatim/monospace text.
 *
 * All are loaded with a dynamic `import()` so the ~850 KB Roboto font data
 * is only fetched when a PDF is actually exported, not on initial page load.
 */

import { instantiatePdfmake, patchPdfmakeSource, type PatchId } from './pdfmake-patch';
import { JUSTIFY } from './pdf-theme';
import { TABLE_LAYOUTS } from './pdf-layouts';

export interface PdfMakeLike {
  createPdf(def: unknown, options?: unknown): {
    /** Both resolve a Promise in the browser build — there is no Node-style callback overload here. */
    getBuffer(): Promise<Uint8Array>;
    getBlob(): Promise<Blob>;
  };
  addFontContainer(container: unknown): void;
  addTableLayouts(layouts: Record<string, unknown>): void;
  /** Which of the publication patches (`pdfmake-patch.ts`) are active in this instance. */
  patches: { applied: PatchId[]; missing: PatchId[] };
}

let loaded: Promise<PdfMakeLike> | null = null;

/**
 * A fresh pdfmake instance with the fonts and the named table layouts registered. `patch: false` gives stock pdfmake
 * (for comparison in the tests); the export uses `loadPdfMake()`, which keeps one patched instance.
 */
export async function createPdfMake(patch = true): Promise<PdfMakeLike> {
  const [{ default: rawSource }, helvetica, roboto, courier] = await Promise.all([
    // the unminified bundle as text: it is patched and evaluated here (see pdfmake-patch.ts)
    import('pdfmake/build/pdfmake.js?raw'),
    import('pdfmake/build/standard-fonts/Helvetica.js'),
    import('pdfmake/build/fonts/Roboto.js'),
    import('pdfmake/build/standard-fonts/Courier.js'),
  ]);
  const patched = patch ? patchPdfmakeSource(rawSource, JUSTIFY.shrink) : { source: rawSource, applied: [] as PatchId[], missing: [] as PatchId[] };
  const pdfMake = instantiatePdfmake(patched.source) as PdfMakeLike;
  pdfMake.patches = { applied: patched.applied, missing: patched.missing };
  // tables name their layout (see pdf-layouts.ts) so that a document definition stays plain data
  pdfMake.addTableLayouts(TABLE_LAYOUTS);
  for (const c of [helvetica, roboto, courier]) {
    const container = (c as { default: unknown }).default ?? c;
    // pdfkit applies the AFM kerning pairs of the standard fonts ("Ta" is 1.3 pt tighter at 11 pt); the reference
    // (Apache FOP) does not kern, so its text is wider. Dropping the pairs makes line breaks, justification and
    // dot leaders come out as in the reference and equal to `pdf-metrics.ts#textWidth`.
    for (const f of (container as { standardFonts?: { kernPairs?: unknown[] }[] }).standardFonts ?? []) f.kernPairs = [];
    pdfMake.addFontContainer(container);
  }
  return pdfMake;
}

export function loadPdfMake(): Promise<PdfMakeLike> {
  if (!loaded) {
    loaded = createPdfMake();
    loaded.catch(() => {
      loaded = null;
    });
  }
  return loaded;
}

/**
 * Characters confirmed (by rendering and extracting text back out of a test
 * PDF) not to be present in the embedded Roboto build pdfmake ships: a
 * handful of arrows and geometric/math operators offered by the editor's
 * special-character picker. Everything else in that picker — degree, plus-
 * minus, multiplication/division signs, micro sign, superscripts, the Greek
 * alphabet, and most mathematical operators — renders correctly (Latin-1 and
 * Windows-1252 characters in Helvetica, the rest in Roboto).
 */
export const PDF_UNSUPPORTED_CHARS = new Set(['∅', '∠', '⊥', '∥', '≡', '∝', '←', '→', '↑', '↓', '↔', '⇒', '⇔', '✓', '✗']);

/** Scans text content for characters that will not render in the exported PDF. Returns the distinct characters found, in document order. */
export function findUnsupportedChars(root: Node): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  const w = root.ownerDocument!.createTreeWalker(root, 4);
  for (let n = w.nextNode() as Text | null; n; n = w.nextNode() as Text | null) {
    for (const ch of n.nodeValue ?? '') {
      if (PDF_UNSUPPORTED_CHARS.has(ch) && !seen.has(ch)) {
        seen.add(ch);
        found.push(ch);
      }
    }
  }
  return found;
}
