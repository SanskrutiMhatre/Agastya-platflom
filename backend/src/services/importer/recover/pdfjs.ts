// =============================================================================
// Loading pdfjs-dist, offline, only when a PDF actually has to be read.
//
// The backend has no PDF dependency of its own; the frontend ships `pdfjs-dist` for the viewer. Structure
// recovery borrows that copy (`../frontend/node_modules`) or one installed beside the backend, and loads it
// lazily so the server starts, and every other import path works, without it.
//
// Offline guarantees: the LEGACY build (runs on plain Node), `disableFontFace`, no eval, no worker file fetch,
// and `standardFontDataUrl` pointing at the package's own `standard_fonts/` folder. Nothing here opens a socket.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { pathToFileURL } from 'url';
import { config } from '../../../config';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type PdfDocument = any;

export function findPdfjsDir(): string | null {
  const candidates = [
    process.env.AGASTYA_PDFJS_DIR,
    path.join(config.root, 'node_modules', 'pdfjs-dist'),
    path.join(config.root, '..', 'frontend', 'node_modules', 'pdfjs-dist'),
  ].filter((d): d is string => !!d);
  return candidates.find((d) => fs.existsSync(path.join(d, 'legacy', 'build', 'pdf.mjs'))) ?? null;
}

// A real dynamic import: TypeScript's CommonJS output would turn `import()` into `require()`, which cannot load an .mjs file.
const dynamicImport = new Function('u', 'return import(u)') as (u: string) => Promise<any>;

export async function openPdf(file: string): Promise<{ doc: PdfDocument; pages: number; close(): Promise<void> }> {
  const dir = findPdfjsDir();
  if (!dir) throw new Error('pdfjs-dist was not found (looked in backend/node_modules and ../frontend/node_modules). Structure recovery needs it; nothing is downloaded.');
  const pdfjs = await dynamicImport(pathToFileURL(path.join(dir, 'legacy', 'build', 'pdf.mjs')).href);
  const buf = fs.readFileSync(file);
  // A view over the Buffer's memory: the 200+ MB reference PDF is read once and not copied again here.
  const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.length);
  const fontDir = path.join(dir, 'standard_fonts');
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: pathToFileURL(fontDir).href + '/',
    disableFontFace: true,
    useSystemFonts: false,
    isEvalSupported: false,
    verbosity: 0,
  });
  const doc: PdfDocument = await task.promise;
  return { doc, pages: doc.numPages as number, close: async () => { try { await doc.destroy(); } catch { /* already gone */ } } };
}

export interface TextItem { str: string; x: number; y: number; rotated: boolean; w: number }

/** The text items of a page with their position, rotated (margin) text flagged. */
export async function pageItems(doc: PdfDocument, n: number): Promise<{ items: TextItem[]; width: number; height: number }> {
  const page = await doc.getPage(n);
  try {
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items: TextItem[] = [];
    for (const it of tc.items as any[]) {
      if (typeof it.str !== 'string' || !it.str.trim()) continue;
      const t = it.transform as number[];
      items.push({ str: it.str, x: t[4], y: t[5], w: it.width ?? 0, rotated: Math.abs(t[1]) > 0.01 || Math.abs(t[2]) > 0.01 });
    }
    return { items, width: vp.width, height: vp.height };
  } finally { page.cleanup(); }
}
