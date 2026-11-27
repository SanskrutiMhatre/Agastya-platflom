// =============================================================================
// The audit trail's integrity and export (audit WP-29: ENT-003, G-SEC-4, RES-004).
//
//   verifyAudit(ctx)           walks the chain (core/auth/auditChain.js) from its anchor and compares it with the newest checkpoints: an
//                              edited row, a deleted middle row, an inserted or forged row, rows inserted around the chain, and a cut at
//                              the end (against a checkpoint) are each named. Used by the Administrator page, scripts/agastya-audit.js,
//                              AgastyaCtl --verify-audit and the doctor.
//   writeCheckpoint(ctx, why)  "the chain had N rows ending in H", signed with the chain key; stored in the database, appended to
//                              <backup dir>/audit-checkpoints.jsonl (outside the data folder when the backups are on another disk) and
//                              raised as Application-log event 4102 (off the machine with Event Forwarding).
//   exportAudit(ctx, ...)      every row matching a filter, streamed as CSV or JSON Lines, in pages (no 5 000-row cap).
// =============================================================================

import fs from 'fs';
import path from 'path';
import type { Writable } from 'stream';
import type { AppContext } from '../appContext';
import type { AuditCheckpoint, AuditFilter, AuditRow } from '../repositories/auditRepository';
import { csvRow as csvLine } from './csv';
import { raiseSecurityEvent } from './securityEvents';
import { GENESIS, verifyRows, signCheckpoint, checkpointValid } from '../core/auth/auditChain';

export interface AuditProblem { kind: string; message: string; id?: number; seq?: number }
export interface AuditVerifyReport {
  ok: boolean;
  at: string;
  keyId: string;
  /** Rows in the chain that were checked. */
  chained: number;
  /** Rows written before the chain existed (not verifiable; never rewritten). */
  beforeChain: number;
  head: { seq: number; hash: string };
  anchor: { seq: number; hash: string; archivedAt: string; archive: string | null } | null;
  checkpoints: { checked: number; newest: { at: string; seq: number; source: string } | null };
  problems: AuditProblem[];
  problemCount: number;
  /** Human-readable one-line summary (the doctor row, the CLI, the event text). */
  summary: string;
}

/** Checkpoints kept outside the database: one JSON object per line in the backup folder. */
export const checkpointFileOf = (ctx: AppContext): string => path.join(ctx.config.backup.dir, 'audit-checkpoints.jsonl');

export function readCheckpointFile(file: string): AuditCheckpoint[] {
  try {
    return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((l) => { try { return JSON.parse(l) as AuditCheckpoint; } catch { return null; } })
      .filter((c): c is AuditCheckpoint => !!c && Number.isInteger(c.seq) && typeof c.row_hash === 'string');
  } catch { return []; }
}

function* pagedChain(ctx: AppContext, afterSeq: number): Generator<AuditRow> {
  for (let after = afterSeq; ;) {
    const page = ctx.repos.audit.chainedAfter(after, 2000);
    if (!page.length) return;
    for (const r of page) yield r;
    after = Number(page[page.length - 1].seq);
  }
}

/**
 * Verify the chain. `extraCheckpoints` are checkpoints from elsewhere (a file an auditor kept, the event log); the database's own and the
 * backup folder's are always read. `raise` = false keeps the Application log quiet (a dry run in a test).
 */
export function verifyAudit(ctx: AppContext, opts: { extraCheckpoints?: Array<AuditCheckpoint & { source?: string }>; raise?: boolean; now?: string } = {}): AuditVerifyReport {
  const key = ctx.auditKey();
  const R = ctx.repos.audit;
  const anchorRow = R.anchor();
  const anchor = anchorRow ? { seq: anchorRow.seq, hash: anchorRow.row_hash } : null;
  const first = R.firstChained();
  const problems: AuditProblem[] = []; let problemCount = 0;
  const add = (p: AuditProblem): void => { problemCount++; if (problems.length < 50) problems.push(p); };

  // A chain whose first row is not where the anchor (or GENESIS) says: rows at the start were removed without retention recording it.
  const walked = verifyRows(key.key, key.id, pagedChain(ctx, 0), anchor);
  for (const p of walked.problems) add(p);
  problemCount += walked.problemCount - walked.problems.length;
  if (walked.wrongKey) add({ kind: 'key', message: `${walked.wrongKey} row(s) were signed with another chain key than the one in ${key.file} (id ${key.id}): use the key that was in place when they were written` });

  const unchained = R.unchained(first ? first.id : null, 10);
  if (unchained.after) add({ kind: 'inserted', message: `${unchained.after} row(s) without a chain position were inserted after the chain started (ids ${unchained.afterIds.join(', ')}${unchained.after > unchained.afterIds.length ? ', ...' : ''})` });

  // Checkpoints: the newest valid ones from the database, the backup folder and the caller. A checkpoint beyond the head = rows cut off
  // at the end; a checkpoint whose row now has another hash = the chain was rebuilt.
  const fromDb = R.checkpoints(20).map((c) => ({ ...c, source: 'database' }));
  const fromFile = readCheckpointFile(checkpointFileOf(ctx)).slice(-20).map((c) => ({ ...c, source: 'backup folder' }));
  const all = [...fromDb, ...fromFile, ...(opts.extraCheckpoints ?? []).map((c) => ({ ...c, source: c.source ?? 'given' }))];
  let checked = 0; let newest: { at: string; seq: number; source: string } | null = null;
  for (const cp of all) {
    if (cp.chain_key !== key.id) continue;                                // another key's checkpoint says nothing about this chain
    if (!checkpointValid(key.key, cp)) { add({ kind: 'checkpoint', message: `a checkpoint (${cp.source}, ${cp.at}) does not carry a valid signature` }); continue; }
    checked++;
    if (!newest || cp.seq > newest.seq) newest = { at: cp.at, seq: cp.seq, source: cp.source };
    if (cp.seq > walked.head.seq) { add({ kind: 'truncated', seq: cp.seq, message: `the checkpoint of ${cp.at} (${cp.source}) recorded ${cp.seq} rows; the chain now ends at ${walked.head.seq}: the newest ${cp.seq - walked.head.seq} row(s) were removed` }); continue; }
    if (anchor && cp.seq <= anchor.seq) continue;                          // archived by retention: no longer in the database
    if (cp.seq === 0) continue;
    const row = R.rowAtSeq(cp.seq);
    if (row && String(row.row_hash) !== cp.row_hash) add({ kind: 'rebuilt', seq: cp.seq, message: `row ${cp.seq} no longer has the hash the checkpoint of ${cp.at} (${cp.source}) recorded: the chain was rewritten` });
  }

  const ok = problemCount === 0;
  const report: AuditVerifyReport = {
    ok, at: opts.now ?? new Date().toISOString(), keyId: key.id, chained: walked.rows, beforeChain: unchained.before,
    head: walked.head.seq === 0 && !anchor ? { seq: 0, hash: GENESIS } : walked.head,
    anchor: anchorRow ? { seq: anchorRow.seq, hash: anchorRow.row_hash, archivedAt: anchorRow.archived_at, archive: anchorRow.archive } : null,
    checkpoints: { checked, newest }, problems, problemCount,
    summary: ok
      ? `audit chain intact: ${walked.rows} row(s) verified${unchained.before ? `, ${unchained.before} older row(s) from before the chain` : ''}${newest ? `, consistent with the checkpoint of ${newest.at}` : ', no checkpoint yet'}`
      : `audit chain BROKEN: ${problemCount} problem(s); first: ${problems[0]?.message ?? '?'}`,
  };
  ctx.recordAuditVerification(report);
  if (opts.raise !== false) raiseSecurityEvent(ok ? 'AUDIT_VERIFIED' : 'AUDIT_VERIFY_FAILED', report.summary);
  return report;
}

/** A signed checkpoint of the chain's head, in the database, in the backup folder's file and in the Application log. */
export function writeCheckpoint(ctx: AppContext, reason: string, now = new Date().toISOString()): AuditCheckpoint {
  const key = ctx.auditKey();
  const head = ctx.store.auditChainHead() as { seq: number; hash: string };
  const base = { at: now, seq: head.seq, row_hash: head.hash, chain_key: key.id, reason };
  const cp: AuditCheckpoint = { ...base, signature: signCheckpoint(key.key, base) };
  cp.id = ctx.repos.audit.insertCheckpoint(cp);
  try {
    fs.mkdirSync(ctx.config.backup.dir, { recursive: true });
    fs.appendFileSync(checkpointFileOf(ctx), `${JSON.stringify({ at: cp.at, seq: cp.seq, row_hash: cp.row_hash, chain_key: cp.chain_key, reason, signature: cp.signature })}\n`);
  } catch (e) { console.error('[audit] the checkpoint could not be written to the backup folder:', (e as Error).message); }
  raiseSecurityEvent('AUDIT_CHECKPOINT', `Audit checkpoint (${reason}): ${cp.seq} rows, last hash ${cp.row_hash}, key ${cp.chain_key}, signature ${cp.signature}.`);
  return cp;
}

/** The newest checkpoint's age decides whether the schedule takes another one. */
export function lastCheckpointAt(ctx: AppContext): string | null {
  const c = ctx.repos.audit.checkpoints(1)[0];
  return c ? c.at : null;
}

// the first eight columns are the former export's, in its order (tools that read it keep working); id, sequence and hash follow
const HEAD = ['time', 'actor', 'action', 'target type', 'target', 'project', 'ip', 'details', 'id', 'sequence', 'row hash'];
const csvRow = (r: AuditRow): unknown[] => [r.at, r.actor_username, r.action, r.target_type, r.target_id, r.project_id, r.ip, r.meta, r.id, r.seq, r.row_hash];

/** Stream every matching row (oldest first) as CSV or JSON Lines; resolves with the number of rows written. Honours back-pressure. */
export async function exportAudit(ctx: AppContext, filter: AuditFilter, format: 'csv' | 'jsonl', out: Writable): Promise<number> {
  const write = (s: string): Promise<void> => new Promise((resolve, reject) => {
    if (out.destroyed) return reject(new Error('client went away'));
    if (out.write(s)) resolve(); else { out.once('drain', resolve); out.once('close', () => reject(new Error('client went away'))); }
  });
  let n = 0;
  if (format === 'csv') await write(`${HEAD.join(',')}\r\n`);
  for (let after = 0; ;) {
    const page = ctx.repos.audit.page(filter, after, 2000);
    if (!page.length) break;
    if (format === 'csv') {
      await write(`${page.map((r) => csvLine(csvRow(r))).join('\r\n')}\r\n`);
    } else {
      await write(page.map((r) => JSON.stringify({ ...r, meta: r.meta ? safeJson(String(r.meta)) : null })).join('\n') + '\n');
    }
    n += page.length; after = Number(page[page.length - 1].id);
  }
  return n;
}
const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return s; } };
