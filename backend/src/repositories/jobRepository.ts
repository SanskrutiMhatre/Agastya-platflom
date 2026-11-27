// =============================================================================
// Job records (audit WP-14: PUB-004, PUB-027). Behind an interface like every repository (WP-10, PRD-002).
// One row per job the job service ran (services/jobs), and its progress lines in order, so a job outlives the request that started it,
// a late or reconnecting client can replay what happened, and a restart turns an unfinished job into an "interrupted" record.
// =============================================================================

import { SqliteRepository } from './sqliteBase';

export type JobState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export interface JobRow {
  id: string; kind: string; project_id: string | null; state: JobState; params: string | null;
  actor_id: string | null; actor_name: string | null; created_at: string; started_at: string | null; finished_at: string | null;
  worker_pid: number | null; result: string | null; error: string | null; input_hash: string | null;
}
export interface JobLogRow { job_id: string; seq: number; at: string; message: string }

export interface JobRepository {
  insert(j: { id: string; kind: string; projectId: string | null; params: string | null; actorId: string | null; actorName: string | null; createdAt: string }): void;
  get(id: string): JobRow | null;
  markRunning(id: string, at: string, workerPid: number | null): void;
  /** Ends a job (succeeded, failed, cancelled); only a job that has not ended already. True when the row changed. */
  finish(id: string, state: JobState, at: string, result: string | null, error: string | null, inputHash?: string | null): boolean;
  appendLog(jobId: string, seq: number, at: string, message: string): void;
  /** Progress lines after `afterSeq`, in order, at most `limit`. */
  log(jobId: string, afterSeq: number, limit: number): JobLogRow[];
  /** The newest jobs of a project first. */
  listForProject(projectId: string, limit: number): JobRow[];
  /** Jobs that were queued or running when the server stopped: marked interrupted with `error`. Returns how many. */
  interruptUnfinished(at: string, error: string): number;
  /** Ended jobs that ended before `before` (their log rows go with them). Returns how many. */
  purgeFinishedBefore(before: string): number;
}

export class SqliteJobRepository extends SqliteRepository implements JobRepository {
  insert(j: { id: string; kind: string; projectId: string | null; params: string | null; actorId: string | null; actorName: string | null; createdAt: string }): void {
    this.q(`INSERT INTO jobs (id, kind, project_id, state, params, actor_id, actor_name, created_at) VALUES (?,?,?,'queued',?,?,?,?)`)
      .run(j.id, j.kind, j.projectId, j.params, j.actorId, j.actorName, j.createdAt);
  }
  get(id: string): JobRow | null { return (this.q('SELECT * FROM jobs WHERE id = ?').get(id) as JobRow | undefined) ?? null; }
  markRunning(id: string, at: string, workerPid: number | null): void {
    this.q(`UPDATE jobs SET state = 'running', started_at = ?, worker_pid = ? WHERE id = ? AND state = 'queued'`).run(at, workerPid, id);
  }
  finish(id: string, state: JobState, at: string, result: string | null, error: string | null, inputHash: string | null = null): boolean {
    const r = this.q(`UPDATE jobs SET state = ?, finished_at = ?, result = ?, error = ?, input_hash = COALESCE(?, input_hash)
                      WHERE id = ? AND state IN ('queued', 'running')`).run(state, at, result, error, inputHash, id);
    return Number(r.changes) === 1;
  }
  appendLog(jobId: string, seq: number, at: string, message: string): void {
    this.q('INSERT OR IGNORE INTO job_log (job_id, seq, at, message) VALUES (?,?,?,?)').run(jobId, seq, at, message);
  }
  log(jobId: string, afterSeq: number, limit: number): JobLogRow[] {
    return this.q('SELECT * FROM job_log WHERE job_id = ? AND seq > ? ORDER BY seq LIMIT ?').all(jobId, afterSeq, limit) as unknown as JobLogRow[];
  }
  listForProject(projectId: string, limit: number): JobRow[] {
    return this.q('SELECT * FROM jobs WHERE project_id = ? ORDER BY created_at DESC, id DESC LIMIT ?').all(projectId, limit) as unknown as JobRow[];
  }
  interruptUnfinished(at: string, error: string): number {
    return Number(this.q(`UPDATE jobs SET state = 'interrupted', finished_at = ?, error = ? WHERE state IN ('queued', 'running')`).run(at, error).changes);
  }
  purgeFinishedBefore(before: string): number {
    return Number(this.q(`DELETE FROM jobs WHERE state NOT IN ('queued', 'running') AND finished_at IS NOT NULL AND finished_at < ?`).run(before).changes);
  }
}
