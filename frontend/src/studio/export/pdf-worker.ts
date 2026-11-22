/**
 * Web Worker entry of the PDF export: lays the publication out and writes the PDF off the main thread.
 *
 * Messages in:  `{ input: PublicationInput }`
 * Messages out: `{ type: 'progress', progress }` while working, then `{ type: 'done', result }` (the PDF bytes are
 *               transferred, not copied) or `{ type: 'error', message }`.
 *
 * The worker is reused for later exports (pdfmake and the fonts are loaded once); cancelling terminates it.
 */
import { assemble } from './pdf-assemble';
import type { AssembleResult, PdfProgress, PublicationInput } from './pdf-input';

export type WorkerReply =
  | { type: 'progress'; progress: PdfProgress }
  | { type: 'done'; result: AssembleResult }
  | { type: 'error'; message: string };

const ctx = self as unknown as {
  onmessage: ((e: MessageEvent<{ input: PublicationInput }>) => void) | null;
  postMessage(message: WorkerReply, transfer?: Transferable[]): void;
};

ctx.onmessage = async (e) => {
  try {
    const result = await assemble(e.data.input, { onProgress: (progress) => ctx.postMessage({ type: 'progress', progress }) });
    ctx.postMessage({ type: 'done', result }, [result.buffer.buffer as ArrayBuffer]);
  } catch (err) {
    ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
