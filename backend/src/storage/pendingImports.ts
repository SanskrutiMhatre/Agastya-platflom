// =============================================================================
// Pending package imports (audit WP-10, PLT-031).
//
// A package that has been examined but not yet turned into a project waits under a random token until its owner confirms the format.
// The token used to live in a process-local Map, so a restart between "detect" and "import" lost it although the upload was still on disk.
// The default store keeps one small JSON record beside the upload in the upload folder, so a pending import survives a restart within its
// expiry, and a second server process sees the same record. A server build may supply another implementation (a table, a shared folder).
// =============================================================================

import fs from 'fs';
import path from 'path';

export interface PendingImport { userId: string; file: string; name: string; at: number }

export interface PendingImportStore {
  put(token: string, rec: PendingImport): void;
  /** The record, or undefined when there is none or it is older than the expiry. */
  get(token: string, now?: number): PendingImport | undefined;
  delete(token: string): void;
  /** Remove expired records and their uploads. */
  sweep(now?: number): void;
}

const TOKEN_RE = /^[a-f0-9]{32}$/;
export const PENDING_IMPORT_TTL_MS = 3600_000;

export class FilePendingImportStore implements PendingImportStore {
  constructor(private readonly dir: () => string, private readonly ttlMs = PENDING_IMPORT_TTL_MS) {}

  private recordFile(token: string): string {
    if (!TOKEN_RE.test(token)) throw new Error('Bad import token.');
    return path.join(this.dir(), `${token}.pending.json`);
  }

  put(token: string, rec: PendingImport): void { fs.writeFileSync(this.recordFile(token), JSON.stringify(rec), 'utf8'); }

  get(token: string, now = Date.now()): PendingImport | undefined {
    if (!TOKEN_RE.test(token)) return undefined;
    let rec: PendingImport;
    try { rec = JSON.parse(fs.readFileSync(this.recordFile(token), 'utf8')); } catch { return undefined; }
    if (!rec || typeof rec.file !== 'string' || typeof rec.userId !== 'string' || !(now - Number(rec.at) <= this.ttlMs)) return undefined;
    return rec;
  }

  delete(token: string): void { try { fs.unlinkSync(this.recordFile(token)); } catch { /* gone */ } }

  sweep(now = Date.now()): void {
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir()); } catch { return; }
    for (const n of names) {
      const m = /^([a-f0-9]{32})\.pending\.json$/.exec(n); if (!m) continue;
      let rec: PendingImport | null = null;
      try { rec = JSON.parse(fs.readFileSync(path.join(this.dir(), n), 'utf8')); } catch { /* unreadable: remove it */ }
      if (rec && now - Number(rec.at) <= this.ttlMs) continue;
      if (rec?.file) try { fs.unlinkSync(rec.file); } catch { /* gone */ }
      this.delete(m[1]);
    }
  }
}
