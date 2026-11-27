// =============================================================================
// Verify a data folder's audit chain without a running server (audit WP-29: ENT-003, G-SEC-4): scripts/agastya-audit.js, the doctor and
// AgastyaCtl --verify-audit use it. The database is opened READ-ONLY and the key file is never created here: a missing key is reported,
// not replaced (a new key would make every row "changed").
// =============================================================================

import fs from 'fs';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import { buildConfig, type Env } from '../config';
import { SqliteAuditRepository, type AuditCheckpoint } from '../repositories/auditRepository';
import { verifyAudit, readCheckpointFile, type AuditVerifyReport } from '../services/auditTrail';
import { loadOrCreateKey } from '../core/auth/auditChain';
import type { AppContext } from '../appContext';
import type { SqlDatabase } from './sqlite';

export class AuditOfflineError extends Error {}

export interface OfflineVerifyOptions {
  workspaceDir: string;
  /** The process environment (AGASTYA_AUDIT_KEY_FILE, AGASTYA_BACKUP_DIR are honoured). */
  env?: Env;
  /** A key file other than the configured one. */
  keyFile?: string;
  /** Checkpoint files kept elsewhere (JSON Lines, as written to the backup folder). */
  checkpointFiles?: string[];
}

export function verifyWorkspaceAudit(o: OfflineVerifyOptions): AuditVerifyReport {
  const config = buildConfig({ ...(o.env ?? {}), AGASTYA_WORKSPACE_DIR: path.resolve(o.workspaceDir) });
  const dbFile = path.join(config.workspaceDir, 'publisher.db');
  if (!fs.existsSync(dbFile)) throw new AuditOfflineError(`${dbFile} does not exist.`);
  const keyFile = o.keyFile ? path.resolve(o.keyFile) : config.audit.keyFile;
  const key = loadOrCreateKey(keyFile, { create: false }) as { key: Buffer; id: string; file: string } | null;
  if (!key) throw new AuditOfflineError(`The audit chain key ${keyFile} is missing. Restore it from where it was kept (it is not in the database), or name it with --key.`);
  const db = new DatabaseSync(dbFile, { readOnly: true });
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
    const hasChain = (db.prepare("SELECT 1 AS x FROM pragma_table_info('audit_log') WHERE name = 'seq'").get());
    if (!hasChain) throw new AuditOfflineError('This database has no audit chain yet (it was last opened by a version before WP-29); start the server once to add it.');
    const extra: Array<AuditCheckpoint & { source: string }> = [];
    for (const f of o.checkpointFiles ?? []) for (const c of readCheckpointFile(f)) extra.push({ ...c, source: path.basename(f) });
    const ctx = {
      config,
      auditKey: () => key,
      repos: { audit: new SqliteAuditRepository(db as unknown as SqlDatabase) },
      recordAuditVerification: () => undefined,
    } as unknown as AppContext;
    return verifyAudit(ctx, { extraCheckpoints: extra, raise: false });
  } finally { db.close(); }
}
