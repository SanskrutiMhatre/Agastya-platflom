/**
 * S1000D data module(s) -> PDF, in the publication format of the reference document.
 *
 * Public entry points:
 *  - `exportPdfBlob`     renders data modules to a PDF Blob ("preview": data module pages only; "publication":
 *                        title page, contents lists and every data module on a right-hand page).
 *  - `buildPdfDocDefinition` / `buildCombinedPdfDocDefinition`  the pdfmake document definition only (first
 *                        layout pass, without measured page numbers), for tests and inspection.
 *
 * The implementation is split by concern:
 *  - `pdf-theme.ts`        measured page geometry, typography and spacing
 *  - `pdf-metrics.ts`      Helvetica metrics, font fallback runs and dot leaders
 *  - `pdf-content.ts`      S1000D element -> pdfmake node walker (numbering, tables, figures, steps, admonitions)
 *  - `pdf-extract.ts`      data modules (XML DOM) -> plain publication input (runs on the page)
 *  - `pdf-assemble.ts`     front matter, running headers/footers, page-break passes, blank pages, landscape runs (no DOM)
 *  - `pdf-worker.ts`       runs the assembly in a Web Worker so the editor stays responsive (`pdf-worker-client.ts` is the page side)
 *  - `pdf-publication.ts`  ties them together: `renderPublication`
 *  - `pdf-landscape.ts`    which content turns to a landscape page (`orient="land"`, `foldout`)
 *  - `pdf-applic.ts` / `pdf-attention.ts`  applicability text, referenced warnings and cautions
 *  - `pdfmake-patch.ts`    justification, page-break batching and measuring caches patched into the pdfmake bundle
 *  - `pdf-mirror.ts`       mirrored inside/outside margins by page parity
 */
import type { EditorDocument } from '../core/document';
import { buildPublicationDefinition, renderPublication, type ImageResolver, type PdfBuildOptions, type PdfBuildResult, type PdfRenderResult } from './pdf-publication';

export type { PNode } from './pdf-metrics';
export { DEFAULT_SETTINGS } from './pdf-publication';
export type { ImageResolver, PublicationSettings, PdfMode, PdfBuildOptions, PdfBuildResult, PdfProgress, PdfRenderResult } from './pdf-publication';

/** Renders the given data modules (in order) to a PDF. */
export function exportPdfBlob(docs: EditorDocument[], images: ImageResolver, opts: PdfBuildOptions = {}): Promise<PdfRenderResult> {
  return renderPublication(docs, images, opts);
}

/** pdfmake definition of one data module's publication (first layout pass). */
export async function buildPdfDocDefinition(doc: EditorDocument, images: ImageResolver, opts: PdfBuildOptions = {}): Promise<PdfBuildResult> {
  const { def, warnings } = await buildPublicationDefinition([doc], images, opts);
  return { def, warnings };
}

/** pdfmake definition of several data modules combined into one publication (first layout pass). */
export async function buildCombinedPdfDocDefinition(docs: EditorDocument[], images: ImageResolver, opts: PdfBuildOptions = {}): Promise<PdfBuildResult> {
  const { def, warnings } = await buildPublicationDefinition(docs, images, opts);
  return { def, warnings };
}
