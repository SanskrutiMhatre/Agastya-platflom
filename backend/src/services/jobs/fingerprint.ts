// =============================================================================
// WP-14 (PERF-012, PUB-019): the input fingerprint of a Validation page run. When nothing the run reads has changed since the stored run,
// the job answers with that run ("up to date") instead of judging every module again.
//
// Conservative on purpose: every file of the project folder counts (name, size, modification time; the validator itself reads every XML file
// down to depth 4, including generated ones), plus everything outside the folder the checks read: the project's configuration row, its
// extension profiles, its lifecycle events and CIR links, the data-module type list (applicability), the issue/BREX options and the program
// build. A change to any of them is a cache miss. Only `.validation.json` (the report itself) and `.publish-state.json` (written by every
// build, read by no check) are left out. The publish gate never uses this: it always validates afresh (publishGate.ts).
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { projectDirFor, repos } from '../../context';
import { listItems } from '../adminConfig';
import { buildInfo } from '../version';

const IGNORE = new Set(['.validation.json', '.publish-state.json']);

function walk(dir: string, rel: string, depth: number, out: string[]): void {
  if (depth > 8) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(dir, rel), { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walk(dir, r, depth + 1, out); continue; }
    if (!rel && IGNORE.has(e.name)) continue;
    try { const st = fs.statSync(path.join(dir, r)); out.push(`${r}|${st.size}|${st.mtimeMs}`); } catch { out.push(`${r}|gone`); }
  }
}

/** The fingerprint of everything a Validation page run with these options reads. */
export function validationFingerprint(projectId: string, opts: { issue?: string; brex?: boolean }): string {
  const files: string[] = [];
  walk(projectDirFor(projectId), '', 0, files);
  files.sort();
  const h = crypto.createHash('sha256');
  const part = (label: string, v: unknown): void => { h.update(label); h.update('\0'); h.update(typeof v === 'string' ? v : JSON.stringify(v ?? null)); h.update('\0'); };
  part('opts', { issue: opts.issue ?? null, brex: !!opts.brex });
  part('build', buildInfo().version);
  part('files', files.join('\n'));
  part('config', repos.projectConfig.get(projectId) ?? null);
  part('extensions', { enabled: repos.extensions.enabledFor(projectId).sort(), profiles: repos.extensions.listProfiles().map((p) => [p.id, p.namespace, p.xsd_sha256]) });
  const life = repos.lifecycle.list(projectId);
  part('lifecycle', { n: life.length, last: life[0]?.id ?? null });
  part('cir', repos.cirLinks.listForProject(projectId));
  try { part('dm-types', listItems('dm-types')); } catch (e) { part('dm-types', (e as Error).message); }
  return h.digest('hex');
}
