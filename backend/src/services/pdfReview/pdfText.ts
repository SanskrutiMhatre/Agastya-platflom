// =============================================================================
// PDF review: the text of a PDF's pages on the server, for re-anchoring (shared/pdfAnchor.ts). Read with the pdf.js the product already
// borrows for structure recovery (services/importer/recover/pdfjs.ts: offline, legacy build, no worker, no fonts loaded), only the pages a
// re-anchoring asks for, and kept per file version (SHA-256) for a few versions so a second reader of the same new build costs nothing.
// =============================================================================

import { openPdf } from '../importer/recover/pdfjs';
import { buildPageIndex, runsFromTextContent, type PageIndex } from '../../shared/pdfAnchor';

interface Entry { pages: number; idx: Map<number, PageIndex | null>; at: number }
const cache = new Map<string, Entry>();
const KEEP = 6;

export interface PdfTextReader { pages: number; page(n: number): Promise<PageIndex | null> }

/** Run `fn` with a reader of the page indexes of the PDF at `abs` (version `hash`). The document is open only while `fn` runs. */
export async function withPdfText<T>(abs: string, hash: string, fn: (r: PdfTextReader) => Promise<T>): Promise<T> {
  let entry = cache.get(hash);
  let opened: Awaited<ReturnType<typeof openPdf>> | null = null;
  const open = async (): Promise<NonNullable<typeof opened>> => { if (!opened) opened = await openPdf(abs); return opened; };
  if (!entry) {
    const o = await open();
    entry = { pages: o.pages, idx: new Map(), at: Date.now() };
    cache.set(hash, entry);
    while (cache.size > KEEP) { const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]; cache.delete(oldest[0]); }
  }
  entry.at = Date.now();
  const e = entry;
  try {
    return await fn({
      pages: e.pages,
      page: async (n: number): Promise<PageIndex | null> => {
        if (n < 1 || n > e.pages) return null;
        if (e.idx.has(n)) return e.idx.get(n) ?? null;
        let ix: PageIndex | null = null;
        try {
          const o = await open();
          const page = await o.doc.getPage(n);
          try { ix = buildPageIndex(runsFromTextContent((await page.getTextContent()).items)); } finally { page.cleanup(); }
        } catch { ix = null; }
        e.idx.set(n, ix);
        return ix;
      },
    });
  } finally {
    if (opened) await (opened as { close(): Promise<void> }).close();
  }
}

/** The number of pages of a PDF version (read once per version). */
export async function pageCountOf(abs: string, hash: string): Promise<number> {
  return withPdfText(abs, hash, async (r) => r.pages);
}

export function forgetPdfText(): void { cache.clear(); }
