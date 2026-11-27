'use strict';
// Migration 026-jobs (audit WP-14: PUB-004, PUB-027, PERF-001). One body per database engine (WP-10); additive only.
// The number 026 was assigned by the lead: 024 and 025 belong to WP-27 and WP-29, which ran in parallel.

const step = {
    /*
      026 - the job service.
      jobs: one row per validation, publish gate or build that the server ran in a worker process (services/jobs). It records who asked,
      what for (kind + parameters), the state (queued, running, succeeded, failed, cancelled, interrupted), the result or the error, and the
      input fingerprint. A row that is still queued or running when the server starts again is marked interrupted: the job died with the
      server, and the record says so instead of pretending it still runs.
      job_log: the progress lines of a job, in order, so a client that connects late (or reconnects) can replay them.
    */
    name: '026-jobs',
    sql: `CREATE TABLE IF NOT EXISTS jobs (
            id           TEXT PRIMARY KEY,
            kind         TEXT NOT NULL,
            project_id   TEXT,
            state        TEXT NOT NULL,
            params       TEXT,
            actor_id     TEXT,
            actor_name   TEXT,
            created_at   TEXT NOT NULL,
            started_at   TEXT,
            finished_at  TEXT,
            worker_pid   INTEGER,
            result       TEXT,
            error        TEXT,
            input_hash   TEXT
          );
          CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, created_at);
          CREATE INDEX IF NOT EXISTS idx_jobs_state ON jobs(state);
          CREATE TABLE IF NOT EXISTS job_log (
            job_id   TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
            seq      INTEGER NOT NULL,
            at       TEXT NOT NULL,
            message  TEXT NOT NULL,
            PRIMARY KEY (job_id, seq)
          );`,
  };

module.exports = { name: step.name, sqlite: { sql: step.sql, columns: step.columns, fkOff: !!step.fkOff } };
