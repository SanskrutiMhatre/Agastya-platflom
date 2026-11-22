/**
 * Types shared by the PDF export's two halves.
 *
 *  - extraction (`pdf-extract.ts`) runs on the page: it reads the data modules' XML (DOM) and renders their content to
 *    pdfmake nodes;
 *  - assembly (`pdf-assemble.ts`) turns that into the paginated publication - front matter, headers/footers, page-break
 *    passes, blank pages, mirrored margins - and needs no DOM, so it can run in a Web Worker (`pdf-worker.ts`) while the
 *    editor stays responsive.
 *
 * Everything that crosses from one to the other is `PublicationInput`: plain data that survives `postMessage`.
 */
import type { PNode } from './pdf-metrics';
import type { Collected, RefRow } from './pdf-content';
import type { PublicationSettings } from './pdf-settings';

/** The only operation the PDF export needs from the image store, kept narrow for easy testing. */
export interface ImageResolver {
  blob(icn: string): Blob | null;
}

export type PdfMode = 'preview' | 'publication';

/** What the export is doing, for a progress display. `page`/`pages` are known while laying out. */
export interface PdfProgress {
  phase: 'prepare' | 'measure' | 'layout' | 'write' | 'finish';
  page?: number;
  pages?: number;
}

export interface PdfBuildOptions {
  mode?: PdfMode;
  settings?: Partial<PublicationSettings>;
  /** Called while the PDF is generated (from the worker's messages when it runs in one). */
  onProgress?: (p: PdfProgress) => void;
  /** Aborting stops the generation (the worker is terminated); the promise rejects with an `AbortError`. */
  signal?: AbortSignal;
  /** Lay the document out in a Web Worker (default: yes where workers exist). `false` keeps it on the calling thread. */
  worker?: boolean;
}

export interface PdfBuildResult {
  def: PNode;
  warnings: string[];
}

export interface PdfRenderResult {
  blob: Blob;
  warnings: string[];
  pages: number;
  /** False when the mirrored-margin post-processing could not be applied (symmetric margins were kept). */
  mirrored: boolean;
  passes: number;
  /** First and last page of each data module, in the order they were passed in. */
  dmPages: { first: number; last: number }[];
}

/** One data module as the assembly needs it. */
export interface DmInput {
  index: number;
  id: string;
  dmc: string;
  mic: string;
  techName: string;
  infoName: string;
  title: string;
  date: string;
  issueNumber: string;
  classification: string;
  notReleased: boolean;
  /** Applicability text of the data module (`dmStatus/applic/displayText`), "" when it has none. */
  applic: string;
  /** The References table (Table 1). */
  refs: RefRow[];
  /** Headings, tables, figures and acronyms found while rendering: they feed the contents lists. */
  collected: Collected;
  /** The rendered content (after the opening block). */
  body: PNode[];
  /** The "Notes" block at the end, empty when the data module has no footnotes. */
  footnotes: PNode[];
}

export interface PublicationInput {
  dms: DmInput[];
  settings: PublicationSettings;
  mode: PdfMode;
  /** Problems found while extracting (missing images, unsupported characters, unresolved references). */
  warnings: string[];
}

export interface AssembleHooks {
  onProgress?: (p: PdfProgress) => void;
}

export interface AssembleResult {
  buffer: Uint8Array;
  warnings: string[];
  pages: number;
  mirrored: boolean;
  passes: number;
  dmPages: { first: number; last: number }[];
}
