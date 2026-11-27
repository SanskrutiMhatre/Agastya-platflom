// =============================================================================
// WP-14: what crosses the process boundary between the server and a job worker. Plain data only: an error is sent as its fields and
// rebuilt on the server side, so a route answers exactly as it did when the work ran in the request (same status, message, code, extra).
// =============================================================================

import { HttpError } from '../http';

export type JobKind =
  | 'validate' | 'gate' | 'publish' | 'preview' | 'configured' | 'html' | 'jsg'
  | 'test.sleep' | 'test.busy' | 'test.crash' | 'test.alloc' | 'test.spawn' | 'test.progress';

export type Lane = 'validation' | 'build';

/** Which admission lane a kind uses: "validation" (validation and the publish gate) or "build" (anything that runs FOP). */
export const LANE_OF: Record<JobKind, Lane> = {
  validate: 'validation', gate: 'validation',
  publish: 'build', preview: 'build', configured: 'build', html: 'build', jsg: 'build',
  'test.sleep': 'validation', 'test.busy': 'validation', 'test.crash': 'validation', 'test.alloc': 'validation', 'test.spawn': 'validation', 'test.progress': 'validation',
};
export const isJobKind = (k: string): k is JobKind => Object.prototype.hasOwnProperty.call(LANE_OF, k);

export interface WireError { name: string; message: string; status?: number; code?: string; extra?: Record<string, unknown>; stack?: string }

export function serializeError(e: unknown): WireError {
  const err = e as { name?: string; message?: string; status?: unknown; code?: unknown; extra?: unknown; stack?: string };
  const out: WireError = { name: String(err?.name ?? 'Error'), message: String(err?.message ?? e) };
  if (e instanceof HttpError) { out.status = e.status; out.code = e.code; if (e.extra) out.extra = JSON.parse(JSON.stringify(e.extra)); out.name = 'HttpError'; }
  else if (typeof err?.code === 'string') out.code = err.code;
  if (typeof err?.stack === 'string') out.stack = err.stack.slice(0, 4000);
  return out;
}

/** The error the route throws: an HttpError when the worker threw one, else an Error with the same message and code. */
export function deserializeError(w: WireError): Error {
  if (w.name === 'HttpError' && typeof w.status === 'number') return new HttpError(w.status, w.message, w.code, w.extra);
  const e = new Error(w.message) as Error & { code?: string };
  e.name = w.name || 'Error';
  if (w.code) e.code = w.code;
  return e;
}

/** Server -> worker. */
export type ToWorker = { t: 'run'; jobId: string; kind: JobKind; projectId: string | null; params: Record<string, unknown> };
/** Worker -> server. */
export type FromWorker =
  | { t: 'ready'; pid: number }
  | { t: 'broadcast'; projectId: string; msg: Record<string, unknown> }
  | { t: 'done'; jobId: string; ok: true; result: unknown; inputHash?: string | null }
  | { t: 'done'; jobId: string; ok: false; error: WireError };
