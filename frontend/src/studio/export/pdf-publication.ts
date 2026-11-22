/**
 * Publication PDF export: entry points that tie the two halves together.
 *
 *  - `extractPublication` (`pdf-extract.ts`, on the page): data modules (XML DOM) -> pdfmake nodes;
 *  - `assemble` (`pdf-assemble.ts`, in a Web Worker where there is one): front matter, headers/footers, page-break
 *    passes, blank pages, mirrored margins -> PDF bytes.
 *
 * Without a worker (tests, very old browsers, a worker that cannot start) the same assembly runs on the calling thread.
 */
import type { EditorDocument } from '../core/document';
import { assemble, assembleDefinition, type LayoutInfo } from './pdf-assemble';
import { extractPublication } from './pdf-extract';
import type { ImageResolver, PdfBuildOptions, PdfBuildResult, PdfRenderResult } from './pdf-input';
import { abortError, runInWorker, WorkerUnavailable, workerAvailable } from './pdf-worker-client';

export { DEFAULT_SETTINGS, type PublicationSettings } from './pdf-settings';
export type { ImageResolver, PdfBuildOptions, PdfBuildResult, PdfMode, PdfProgress, PdfRenderResult } from './pdf-input';
export type { LayoutInfo };

/** Builds the pdfmake definition for the given pass (exposed for tests). */
export async function buildPublicationDefinition(
  docs: EditorDocument[], images: ImageResolver, opts: PdfBuildOptions = {}, info: LayoutInfo | null = null,
): Promise<PdfBuildResult & { plan: ReturnType<typeof assembleDefinition>['plan'] }> {
  const input = await extractPublication(docs, images, opts);
  const { def, plan } = assembleDefinition(input, info, false);
  return { def, warnings: input.warnings, plan };
}

/**
 * Renders the publication to a PDF. Layout passes repeat until the page of every marker is stable (normally two:
 * a measuring pass, then the final one), then the mirrored-margin transform is applied.
 */
export async function renderPublication(docs: EditorDocument[], images: ImageResolver, opts: PdfBuildOptions = {}): Promise<PdfRenderResult> {
  if (opts.signal?.aborted) throw abortError();
  opts.onProgress?.({ phase: 'prepare' });
  const input = await extractPublication(docs, images, opts);
  if (opts.signal?.aborted) throw abortError();
  let res;
  if (opts.worker !== false && workerAvailable()) {
    try {
      res = await runInWorker(input, opts);
    } catch (e) {
      if (!(e instanceof WorkerUnavailable)) throw e;
      console.warn('PDF worker unavailable, generating on the main thread:', e.message);
    }
  }
  res ??= await assemble(input, { onProgress: opts.onProgress });
  return { blob: new Blob([res.buffer as BlobPart], { type: 'application/pdf' }), warnings: res.warnings, pages: res.pages, mirrored: res.mirrored, passes: res.passes, dmPages: res.dmPages };
}
