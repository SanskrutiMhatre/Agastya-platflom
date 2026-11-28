// =============================================================================
// Phase 7 (docs/phase3/performance.md, item 5; audit PERF-012): "nothing changed = up to date". The input key of a PDF build: when it equals
// the key the last build of the same kind recorded, and that build's PDF is still the file it wrote, the build answers with that PDF instead
// of validating, transforming and rendering everything again.
//
// The key is conservative: everything a build can read goes in, and anything unknown makes it differ (a miss only costs a normal build):
//   * the CONTENT (SHA-256, kept per file version) of every file of the project folder except the build's own outputs and intermediates
//     (the project archive's GENERATED rule, plus the composed and transformed books), so a file rewritten with the same bytes is no change;
//   * the house templates and artwork of the workspace (`templates/`, by name, size and times);
//   * the program build (stylesheets, schemas, FOP, the engine, the bundled assets ship with it) and the FOP heap setting;
//   * the database state a build reads: the project's configuration row, extensions, lifecycle events, CIR links, the data-module type list,
//     the publish waivers, and the release rows (released or NOT RELEASED, and the release number, are printed);
//   * the build's own options (kind, compression, rule breaks allowed, the previewed module) and the calendar day (a page may print a date).
// The PDF itself must still be the one recorded (size, modification time, file id), so a PDF replaced or removed by hand is rebuilt.
// =============================================================================

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { config } from '../config';
import { projectDirFor, repos, store } from '../context';
import { FileMemo } from './fileMemo';
import { buildInfo } from './version';
import { listItems } from './adminConfig';
import { listWaivers } from './publishWaivers';

/** Top-level names of a project folder that a build writes itself (outputs, intermediates, reports, the configuration-specific PDFs and the
 *  HTML publication): never part of its input. */
const GENERATED_TOP = /^(jss-output\.(pdf|fo)|jsg-output\.(pdf|fo)|jss-preview\.(pdf|fo)|configurations|html|jss-book\.xml|jss-run\.xsl|s1000dtofo-run\.xsl|_.*|\.publish-state\.json|\.validation(\.prev)?\.json|\.jsg-publish-state\.json|\.import-reports|.*\.bak|.*\.tmp|.*\.partial)$/i;
const MAX_DEPTH = 8;
const FRONT_MATTER_STAMP = '_frontmatter-generated.json';

const contentMemo = new FileMemo<string>(100000);
const sigOf = (st: fs.Stats): string => `${st.size}:${st.mtimeMs}:${st.ctimeMs}:${st.ino}`;

function hashFile(abs: string, st: fs.Stats): string {
  return contentMemo.get(abs, st, () => crypto.createHash('sha256').update(fs.readFileSync(abs)).digest('hex'));
}

function walk(root: string, rel: string, depth: number, out: string[], content: boolean): void {
  if (depth > MAX_DEPTH) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true }); } catch { return; }
  // A front-matter page the build generates from Settings (vendor engine/frontmatter.js) is still the build's own while its bytes match the
  // stamp the build wrote: it is regenerated from the settings (part of the key) by every build, so it is output, not input. Once edited by
  // hand it no longer matches and counts as content like any other file.
  let stamp: Record<string, string> = {};
  if (content) { try { stamp = JSON.parse(fs.readFileSync(path.join(root, rel, FRONT_MATTER_STAMP), 'utf8')); } catch { stamp = {}; } }
  for (const e of entries) {
    if (!rel && GENERATED_TOP.test(e.name)) continue;
    if (e.name === FRONT_MATTER_STAMP) continue;
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { walk(root, r, depth + 1, out, content); continue; }
    if (!e.isFile()) continue;
    const abs = path.join(root, r);
    try {
      const st = fs.statSync(abs);
      if (!content) { out.push(`${r}|${sigOf(st)}`); continue; }
      const hash = hashFile(abs, st);
      out.push(typeof stamp[e.name] === 'string' && hash.slice(0, 32) === stamp[e.name] ? `${r}|generated` : `${r}|${hash}`);
    } catch { out.push(`${r}|gone`); }
  }
}

const safe = (f: () => unknown): unknown => { try { return f(); } catch (e) { return `error:${(e as Error).message}`; } };

/** What a build reads: each project file with its content hash (or "generated"), one hash of everything else, and the key of both. */
export interface BuildInputs { key: string; files: Map<string, string>; rest: string }

/** The inputs of a build of `kind` (see above). `extra`: the build's own options. */
export function buildInputs(projectId: string, kind: string, extra: Record<string, unknown> = {}): BuildInputs {
  const dir = projectDirFor(projectId);
  const list: string[] = []; walk(dir, '', 0, list, true); list.sort();
  const templates: string[] = []; walk(path.join(config.workspaceDir, 'templates'), '', 0, templates, false); templates.sort();
  const h = crypto.createHash('sha256');
  const part = (label: string, v: unknown): void => { h.update(label); h.update('\0'); h.update(typeof v === 'string' ? v : JSON.stringify(v ?? null)); h.update('\0'); };
  const now = new Date().toISOString();
  part('kind', kind);
  part('extra', extra);
  part('day', now.slice(0, 10));
  part('build', buildInfo().version);
  part('fopHeap', config.jobs.fopHeapMb);
  part('templates', templates.join('\n'));
  part('config', safe(() => repos.projectConfig.get(projectId) ?? null));
  part('extensions', safe(() => ({ enabled: repos.extensions.enabledFor(projectId).sort(), profiles: repos.extensions.listProfiles().map((p) => [p.id, p.namespace, p.xsd_sha256]) })));
  part('lifecycle', safe(() => { const life = repos.lifecycle.list(projectId); return { n: life.length, last: life[0]?.id ?? null }; }));
  part('cir', safe(() => repos.cirLinks.listForProject(projectId)));
  part('dm-types', safe(() => listItems('dm-types')));
  part('security-classes', safe(() => listItems('security-classes')));
  // the registry row without its times (opening a project touches them)
  part('project-row', safe(() => { const r = store.getProjectRow(projectId); return r ? [r.id, r.name, r.type, r.template, r.status] : null; }));
  part('waivers', safe(() => listWaivers(projectId, now).map((w) => [w.id, w.kind, w.subject, w.expiresAt, !!w.expired])));
  part('release', safe(() => {
    const pick = (r: Record<string, unknown> | null | undefined) => (r ? [r.id, r.release_number, r.content_hash, r.status, r.scheduled_at] : null);
    return [pick(store.currentRelease(projectId, now)), pick(store.scheduledRelease(projectId, now)), pick(store.pendingRelease(projectId))];
  }));
  const rest = h.digest('hex');
  const files = new Map<string, string>();
  for (const line of list) { const i = line.lastIndexOf('|'); files.set(line.slice(0, i), line.slice(i + 1)); }
  const key = crypto.createHash('sha256').update(rest).update('\0').update(list.join('\n')).digest('hex');
  return { key, files, rest };
}

/** The input key of a build of `kind`. */
export function buildInputKey(projectId: string, kind: string, extra: Record<string, unknown> = {}): string {
  return buildInputs(projectId, kind, extra).key;
}

/**
 * The key a finished build records. Normally the key taken BEFORE it ran (a change made while it ran is then a change next time). A build
 * also writes some of its inputs itself (the front-matter pages it generates from Settings, engine/frontmatter.js): when the only
 * differences between before and after are such pages, now matching the build's stamp, the after-key is recorded, so the next unchanged
 * request is answered at once instead of one build later. Any other difference (an edit while the build ran) keeps the before-key.
 */
export function keyToRecord(before: BuildInputs, after: BuildInputs): string {
  if (before.key === after.key || before.rest !== after.rest) return before.key;
  for (const p of new Set([...before.files.keys(), ...after.files.keys()])) {
    if (before.files.get(p) !== after.files.get(p) && after.files.get(p) !== 'generated') return before.key;
  }
  return after.key;
}

/** Keys for one build: `before()` when it starts, `record()` when it has finished (see keyToRecord). Null when the inputs cannot be read. */
export function buildKeys(projectId: string, kind: string, extra: Record<string, unknown> = {}): { key: string; record: () => string } | null {
  let before: BuildInputs;
  try { before = buildInputs(projectId, kind, extra); } catch { return null; }
  return { key: before.key, record: () => { try { return keyToRecord(before, buildInputs(projectId, kind, extra)); } catch { return before.key; } } };
}

/** The file signature a recorded build keeps of its PDF (null when there is no such file). */
export function pdfSignature(abs: string): string | null {
  try { const st = fs.statSync(abs); return st.isFile() ? sigOf(st) : null; } catch { return null; }
}
