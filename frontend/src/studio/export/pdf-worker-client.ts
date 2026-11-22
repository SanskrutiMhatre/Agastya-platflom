/**
 * Page side of the PDF worker (`pdf-worker.ts`): sends the extracted publication, relays progress, supports cancelling.
 *
 * One worker is kept for the next export (loading pdfmake and the fonts takes a moment); a second export that starts
 * while one is running gets a worker of its own, which is dropped afterwards.
 */
import type { AssembleResult, PdfBuildOptions, PublicationInput } from './pdf-input';
import type { WorkerReply } from './pdf-worker';

/** The worker could not be started or died: the caller may do the work on the page instead. */
export class WorkerUnavailable extends Error {}

let idle: Worker | null = null;

export function workerAvailable(): boolean {
  return typeof Worker !== 'undefined';
}

export function abortError(): Error {
  const e = new Error('PDF generation cancelled');
  e.name = 'AbortError';
  return e;
}

export function runInWorker(input: PublicationInput, opts: Pick<PdfBuildOptions, 'onProgress' | 'signal'>): Promise<AssembleResult> {
  return new Promise((resolve, reject) => {
    if (opts.signal?.aborted) return reject(abortError());
    let worker: Worker;
    try {
      worker = idle ?? new Worker(new URL('./pdf-worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      return reject(new WorkerUnavailable(e instanceof Error ? e.message : String(e)));
    }
    idle = null;
    const finish = (settle: () => void, keep: boolean) => {
      opts.signal?.removeEventListener('abort', onAbort);
      worker.onmessage = null;
      worker.onerror = null;
      if (keep && !idle) idle = worker;
      else worker.terminate();
      settle();
    };
    const onAbort = () => finish(() => reject(abortError()), false);
    opts.signal?.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<WorkerReply>) => {
      const m = e.data;
      if (m.type === 'progress') opts.onProgress?.(m.progress);
      else if (m.type === 'done') finish(() => resolve(m.result), true);
      else finish(() => reject(new Error(m.message)), true);
    };
    worker.onerror = (e) => finish(() => reject(new WorkerUnavailable(e.message || 'The PDF worker failed to start')), false);
    worker.postMessage({ input });
  });
}
