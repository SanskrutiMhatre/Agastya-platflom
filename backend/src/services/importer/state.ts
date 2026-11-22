// =============================================================================
// What the importer remembers about a project: `import-state.json` beside publication.xml.
//
// WHY a file and not the database: the project folder is the unit people copy, back up and hand over
// (workspace/<project>/); the facts that make the unassigned pool intelligible - why a module is unplaced,
// which pmRef it is the title page of, which sub-publication was already turned into a folder - must travel
// with it. The pool itself is NOT stored here: it is always computed live (modules in csdb/ that
// publication.xml does not place), so an edit in the Publication screen can never make this file lie.
// =============================================================================

import fs from 'fs';
import path from 'path';
import type { ReusedDm, SubPublication } from './types';

export const STATE_FILE = 'import-state.json';
export const ORIGINALS_DIR = 'import-originals';
const MAX_BATCHES = 50;

export interface ImportBatch {
  id: string;
  at: string;
  by: string;
  flavour: string;
  rules: string[];
  assembleUnassigned: boolean;
  counts: { dms: number; media: number; placeholders: number; changes: number; pool: number };
  /** Folder (relative to the project) holding the original bytes of every file a repair changed, plus the change log. */
  originals: string;
  publication: 'replaced' | 'kept' | 'none';
  reconstructed: 'full' | 'metadata' | null;
}

export interface PoolNote { reason: string; group: string; anchorOf?: string }

export interface ImportState {
  version: 1;
  batches: ImportBatch[];
  /** Why each unplaced module was left unplaced, by csdb file name. A hint for the screen, never the pool itself. */
  poolNotes: Record<string, PoolNote>;
  subPublications: Array<SubPublication & { materialisedAs?: string }>;
  reusedDms: ReusedDm[];
  reconstructedPublication: 'full' | 'metadata' | null;
}

export const emptyState = (): ImportState => ({ version: 1, batches: [], poolNotes: {}, subPublications: [], reusedDms: [], reconstructedPublication: null });

export function loadState(projectDir: string): ImportState {
  const file = path.join(projectDir, STATE_FILE);
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<ImportState>;
    if (raw && raw.version === 1) return { ...emptyState(), ...raw, batches: raw.batches ?? [], poolNotes: raw.poolNotes ?? {}, subPublications: raw.subPublications ?? [], reusedDms: raw.reusedDms ?? [] };
  } catch { /* no state yet, or unreadable: start fresh - the state is advisory */ }
  return emptyState();
}

/** Written through a temporary file so a crash never leaves half a JSON document behind. */
export function saveState(projectDir: string, state: ImportState): void {
  const file = path.join(projectDir, STATE_FILE);
  const trimmed: ImportState = { ...state, batches: state.batches.slice(-MAX_BATCHES) };
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(trimmed, null, 2), 'utf8');
  fs.renameSync(tmp, file);
}
