// The source record: what an imported package carries that a JSS document cannot.
//
// JSS has no place for document codes, issue/language, status blocks, the publication's own structure or the original file names, and its schema must not grow to hold them.
// So the import keeps them beside the document, in `<project>/rwi-source/`:
//     manifest.json         the record (below)
//     original/...          every XML file of the package exactly as it was received
// The JSS document and the record are joined by the `id` attribute JSS sections, tables and figures already have (`dm-<code>`), so nothing in the JSS schema or editor changed.
// A project that was never imported has no record; export then works from the JSS document and the project's settings alone.

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../../../context';
import type { Attachment, PictureUse } from './map';
import type { Finding, ImportCounts } from './report';

export const RECORD_DIR = 'rwi-source';

export interface RecordModule {
  file: string; rel: string; key: string; sectionId: string; chapter: number; listed: boolean; placedBy: 'publication' | 'number'; pmTitle: string;
  code: Record<string, string>; issue: Record<string, string>; language: Record<string, string>; issueDate: Record<string, string>;
  techName: string; infoName: string; heading: string; rootStart: string; identAndStatus: string; doctype: string; schemaLocation: string;
  pictures: PictureUse[]; attachments: Attachment[]; fingerprint: string; tables: Array<{ id: string; original: string }>; figures: Array<{ id: string; original: string }>; flattened: number;
}

export interface SourceRecord {
  version: 1; importedAt: string; packageName: string; root: string; stencil: string;
  publication: { file: string; rel: string; rootStart: string; identAndStatus: string; code: Record<string, string>; language: Record<string, string>; issue: Record<string, string>; title: string; shortTitle: string };
  chapters: Array<{ number: number; stencilTitle: string; sourceTitle: string | null }>;
  modules: RecordModule[];
  /** documents of the package that are not sections of the handbook: its front-matter pages, and each chapter's heading page. Kept so the package's codes survive. */
  others?: Array<{ file: string; rel: string; key: string; kind: 'front-matter' | 'chapter-heading'; page?: string; chapter?: number; techName?: string; infoName?: string; issueDate?: Record<string, string>; title: string; code: Record<string, string>; issue: Record<string, string>; language: Record<string, string> }>;
  pictures: Array<{ file: string; media: string; placeholder: boolean; used: boolean }>;
  findings: Finding[]; counts: ImportCounts;
}

export const recordDir = (projectId: string): string => path.join(projectDirFor(projectId), RECORD_DIR);
export const hasRecord = (projectId: string): boolean => fs.existsSync(path.join(recordDir(projectId), 'manifest.json'));

export function readRecord(projectId: string): SourceRecord | null {
  try { return JSON.parse(fs.readFileSync(path.join(recordDir(projectId), 'manifest.json'), 'utf8')) as SourceRecord; } catch { return null; }
}

/** An original file, exactly as received. */
export function readOriginal(projectId: string, rel: string): string | null {
  try { return fs.readFileSync(path.join(recordDir(projectId), 'original', rel), 'utf8'); } catch { return null; }
}

export function writeRecord(projectId: string, record: SourceRecord, originals: Array<{ rel: string; text: string }>): void {
  const dir = recordDir(projectId);
  // a second import replaces the first one completely: the record must describe exactly one package
  fs.rmSync(path.join(dir, 'original'), { recursive: true, force: true });
  for (const f of originals) {
    const abs = path.join(dir, 'original', f.rel);
    if (path.relative(path.join(dir, 'original'), abs).startsWith('..')) continue;          // never write outside the record
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, f.text, 'utf8');
  }
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(record, null, 1), 'utf8');
}
