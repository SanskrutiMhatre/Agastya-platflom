// =============================================================================
// The record of which data modules the front-matter code owns: `.jssdm.json` in the project folder.
//
//   generated   modules WRITTEN by jssdm generate (dmsFromFrontMatter). The author did not write them and they are hidden
//               from the author's list by default; `sha256` of the text as written says whether anyone has edited one since
//               (an edited module is the author's now: regenerating leaves it alone unless told to overwrite).
//   consumed    modules READ by the front-matter import: their content now lives in the project's settings, so the engine
//               prints its own page and the module must not also be printed as body.
//
// A dot-file, so the document index ignores it; it travels with a copy of the project. Pure fs, no database.
// =============================================================================

import fs from 'fs';
import path from 'path';

export interface GeneratedEntry { page: string; infoCode: string; sha256: string; at: string }
export interface ConsumedEntry { page: string; infoCode: string; at: string }
export interface Sidecar {
  schemaVersion: 1;
  generated: Record<string, GeneratedEntry>;
  consumed: Record<string, ConsumedEntry>;
}

const file = (dir: string): string => path.join(dir, '.jssdm.json');

export function readSidecar(dir: string): Sidecar {
  try {
    const j = JSON.parse(fs.readFileSync(file(dir), 'utf8'));
    return { schemaVersion: 1, generated: j.generated && typeof j.generated === 'object' ? j.generated : {}, consumed: j.consumed && typeof j.consumed === 'object' ? j.consumed : {} };
  } catch { return { schemaVersion: 1, generated: {}, consumed: {} }; }
}

export function writeSidecar(dir: string, sc: Sidecar): void {
  const abs = file(dir);
  const tmp = `${abs}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sc, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, abs);
}

/** Marker written into every generated data module: a processing instruction, so the module stays valid XML and schema-valid S1000D. */
export const GENERATED_PI = 'agastya-generated';
export const generatedMarker = (page: string): string => `<?${GENERATED_PI} source="jssdm" page="${page}" version="1"?>`;
export const isGeneratedXml = (xml: string): boolean => new RegExp(`<\\?${GENERATED_PI}\\s`).test(xml.slice(0, 4096));
