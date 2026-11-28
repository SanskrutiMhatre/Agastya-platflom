// =============================================================================
// WP-14 (PRD-001 "one interface for every document engine"): what each job kind does. A kind takes plain data and returns plain data, and
// calls the same service functions the routes used to call in the request, so findings, gate results and PDFs are those of before. The
// worker process (worker.ts) runs these; the inline mode (AGASTYA_JOBS=inline) runs them in the server process.
// =============================================================================

import fs from 'fs';
import { spawn } from 'child_process';
import { config } from '../../config';
import { broadcast } from '../broadcast';
import { HttpError } from '../http';
import { runValidation, lastRun } from '../validation';
import { assertPublishable, type GateScope, type GateOptions } from '../publishGate';
import * as publisher from '../publisher';
import { buildHtmlPublication } from '../htmlPublish';
import { buildJsgPdf } from '../jsg/engine';
import { validationFingerprint } from './fingerprint';
import type { JobKind } from './protocol';

export interface KindOutcome { result: unknown; inputHash?: string | null }

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));

/** The diagnostic kinds exist only when AGASTYA_JOB_TEST_KINDS=1 (the job-service tests); a server never offers them. */
export const testKindsEnabled = (): boolean => config.jobs.testKinds;

export async function runKind(kind: JobKind, projectId: string | null, p: Record<string, unknown>): Promise<KindOutcome> {
  const pid = (): string => { if (!projectId) throw new HttpError(400, 'This job needs a project.', 'NO_PROJECT'); return projectId; };
  switch (kind) {
    case 'validate': {
      // The Validation page: answered from the stored run when nothing it reads has changed (PERF-012); otherwise a full run, as before.
      const opts = { issue: str(p.issue), brex: !!p.brex };
      // `fresh`: judge again even when unchanged (the stored run is still replaced and fingerprinted, so the next request can use it)
      const hash = config.jobs.validationCache ? validationFingerprint(pid(), opts) : null;
      const prev = hash && p.fresh !== true ? lastRun(pid()) : null;
      if (hash && prev && prev.inputHash === hash) return { result: { run: { ...prev, cached: true } }, inputHash: hash };
      const run = await runValidation(pid(), { ...opts, inputHash: hash ?? undefined });
      return { result: { run }, inputHash: hash };
    }
    case 'gate': {
      const scope = (p.scope && typeof p.scope === 'object' ? { file: String((p.scope as { file: unknown }).file) } : 'publication') as GateScope;
      const g = await assertPublishable(pid(), scope, (p.opts ?? {}) as GateOptions);
      return { result: { validatedAt: g.validatedAt, files: g.files, warnings: g.warnings, ruleBreaks: g.ruleBreaks } };
    }
    case 'publish': {
      const out = await publisher.buildPublication(pid(), { compression: p.compression === undefined ? undefined : Number(p.compression), allowRuleBreaks: p.allowRuleBreaks === true });
      return { result: { ...out, bytes: fs.statSync(out.pdf).size } };
    }
    case 'preview': return { result: await publisher.buildPreview(pid(), String(p.file)) };
    // the JSS and JSG editors' Quick preview: the whole document as a draft beside its PDF (no release, no build state)
    case 'doc-preview': return { result: await publisher.buildDocumentPreview(pid()) };
    case 'jsg-preview': return { result: await buildJsgPdf(pid(), { preview: true }) };
    case 'configured': return { result: await publisher.buildConfiguredPublication(pid(), { productId: str(p.productId), values: Array.isArray(p.values) ? p.values : undefined }) };
    case 'html': return { result: await buildHtmlPublication(pid(), (p.input ?? undefined) as Parameters<typeof buildHtmlPublication>[1], { allowRuleBreaks: p.allowRuleBreaks === true }) };
    case 'jsg': return { result: await buildJsgPdf(pid()) };
    default: break;
  }
  if (!testKindsEnabled()) throw new HttpError(400, `Unknown job kind ${kind}.`, 'BAD_JOB_KIND');
  switch (kind) {
    case 'test.sleep': await sleep(Number(p.ms) || 1000); return { result: { slept: Number(p.ms) || 1000, pid: process.pid } };
    case 'test.busy': { const end = Date.now() + (Number(p.ms) || 1000); while (Date.now() < end) { /* a worker that never yields */ } return { result: { pid: process.pid } }; }
    case 'test.crash': setImmediate(() => process.exit(70)); await sleep(60_000); return { result: null };
    case 'test.alloc': {
      // touch every page, so the memory is committed (a job object limits committed memory)
      const keep: Buffer[] = []; const mb = Number(p.mb) || 1024;
      for (let i = 0; i < mb / 64; i++) { keep.push(Buffer.alloc(64 * 1024 * 1024, 1)); await sleep(5); }
      return { result: { allocatedMb: keep.length * 64 } };
    }
    case 'test.spawn': {
      // a long-lived child of the worker, as FOP's JVM is: the job object must take it down with the worker
      const c = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 600000)'], { stdio: 'ignore', windowsHide: true });
      return { result: { childPid: c.pid, workerPid: process.pid } };
    }
    case 'test.progress': {
      const n = Number(p.lines) || 3;
      for (let i = 1; i <= n; i++) { broadcast(pid(), { type: 'progress', message: `step ${i} of ${n}` }); await sleep(Number(p.gapMs) || 20); }
      return { result: { lines: n } };
    }
    default: throw new HttpError(400, `Unknown job kind ${kind}.`, 'BAD_JOB_KIND');
  }
}
