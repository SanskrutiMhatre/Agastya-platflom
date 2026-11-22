// =============================================================================
// Assets of a project: every ICN / multimedia file in csdb/ and Media/, with what S1000D lets us say about it.
//
//   - the ICN code is parsed from the file name (S1000D 4.2 Chap 7.5.1 para 2.3.4: ICN-<unique id>-<III issue>-<SS security>);
//   - references are collected from the data modules: infoEntityIdent="ICN-..." (graphic / symbol / multimediaObject) and the
//     <!ENTITY ICN-... SYSTEM "file"> declarations that bind the entity to a file;
//   - findings: broken references (referenced, no file), orphans (file, nothing refers to it), duplicates (same content under
//     different names), unsupported formats, ICNs with no illustration-metadata file (IMF) when the project keeps them;
//   - a SHA-256 per file, cached by (size, mtime), is the integrity record the package manifests carry.
// Nothing here modifies a file.
// =============================================================================

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { csdbRel, mediaRel, readProjectJson } from './projects';
import { DM_FILE_RE } from './csdb';
import { formatOf, type AssetClass } from './mediaFormats';
import { listObjects } from './csdbObjects';

export const ICN_CODE_RE = /^ICN-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{3}-\d{2}$/i;
export interface Asset { name: string; dir: 'csdb' | 'Media'; size: number; modified: string; cls: AssetClass | 'unknown'; supported: boolean; icn: string | null; icnValid: boolean; sha256: string }
export interface AssetFinding { code: 'BROKEN_REFERENCE' | 'ORPHAN' | 'DUPLICATE_CONTENT' | 'UNSUPPORTED_FORMAT' | 'BAD_ICN_NAME' | 'NO_METADATA'; severity: 'error' | 'warn' | 'info'; asset: string; module?: string; location?: string; message: string; fix: string }

const hashCache = new Map<string, { sig: string; sha: string }>();
function sha256File(abs: string, st: fs.Stats): string {
  const sig = `${st.size}:${st.mtimeMs}`; const hit = hashCache.get(abs);
  if (hit && hit.sig === sig) return hit.sha;
  const h = crypto.createHash('sha256'); const fd = fs.openSync(abs, 'r'); const buf = Buffer.alloc(1 << 20);
  try { for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) h.update(buf.subarray(0, n)); } finally { fs.closeSync(fd); }
  const sha = h.digest('hex'); hashCache.set(abs, { sig, sha }); return sha;
}

const isAssetName = (f: string): boolean => !!formatOf(f) || /^ICN-/i.test(f);
export const stripExt = (n: string): string => n.replace(/\.[^.]+$/, '');

export function listAssets(projectId: string, hash = true): Asset[] {
  const pj = readProjectJson(projectId); const out: Asset[] = [];
  for (const [label, rel] of [['csdb', csdbRel(pj)], ['Media', mediaRel(pj)]] as const) {
    const dir = path.join(projectDirFor(projectId), rel); if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      if (DM_FILE_RE.test(f) || !isAssetName(f)) continue;
      const abs = path.join(dir, f); let st: fs.Stats; try { st = fs.statSync(abs); } catch { continue; }
      if (!st.isFile()) continue;
      const fmt = formatOf(f); const icn = /^ICN-/i.test(f) ? stripExt(f).toUpperCase() : null;
      out.push({ name: f, dir: label, size: st.size, modified: st.mtime.toISOString(), cls: fmt?.cls ?? 'unknown', supported: !!fmt, icn, icnValid: icn ? ICN_CODE_RE.test(icn) : false, sha256: hash ? sha256File(abs, st) : '' });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface DmRefs { file: string; idents: Array<{ ident: string; line: number }>; entities: Array<{ name: string; file: string; line: number }> }
/** infoEntityIdent values and ENTITY declarations of one module's text (positions as 1-based lines). */
export function refsOf(file: string, xml: string): DmRefs {
  const idents: DmRefs['idents'] = []; const entities: DmRefs['entities'] = [];
  const lineAt = (i: number) => xml.slice(0, i).split('\n').length;
  let m: RegExpExecArray | null;
  const a = /infoEntityIdent\s*=\s*"([^"]+)"/g; while ((m = a.exec(xml))) idents.push({ ident: m[1], line: lineAt(m.index) });
  const e = /<!ENTITY\s+(\S+)\s+SYSTEM\s+"([^"]+)"/g; while ((m = e.exec(xml.slice(0, 2 * 1024 * 1024)))) entities.push({ name: m[1], file: path.basename(m[2]), line: lineAt(m.index) });
  return { file, idents, entities };
}

export function checkAssets(projectId: string): { assets: Asset[]; findings: AssetFinding[] } {
  const assets = listAssets(projectId); const findings: AssetFinding[] = [];
  const dir = path.join(projectDirFor(projectId), csdbRel(readProjectJson(projectId)));
  const byStem = new Map<string, Asset>(); const byName = new Map<string, Asset>();
  for (const a of assets) { byStem.set(stripExt(a.name).toUpperCase(), a); byName.set(a.name.toUpperCase(), a); }
  const used = new Set<string>();
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => DM_FILE_RE.test(f)) : [];
  for (const f of files) {
    const refs = refsOf(f, fs.readFileSync(path.join(dir, f), 'utf8'));
    const declared = new Map(refs.entities.map((e) => [e.name.toUpperCase(), e]));
    for (const e of refs.entities) {
      const hit = byName.get(e.file.toUpperCase()); if (hit) used.add(hit.name);
      else findings.push({ code: 'BROKEN_REFERENCE', severity: 'error', asset: e.file, module: f, location: `line ${e.line}: <!ENTITY ${e.name} SYSTEM "${e.file}">`, message: `The entity ${e.name} points at ${e.file}, which is not in the project.`, fix: `Add ${e.file} to the project's graphics, or correct the entity declaration.` });
    }
    for (const r of refs.idents) {
      const hit = byStem.get(r.ident.toUpperCase()) ?? byName.get(r.ident.toUpperCase()); if (hit) used.add(hit.name);
      if (!hit && !declared.has(r.ident.toUpperCase())) findings.push({ code: 'BROKEN_REFERENCE', severity: 'error', asset: r.ident, module: f, location: `line ${r.line}: infoEntityIdent="${r.ident}"`, message: `infoEntityIdent ${r.ident} names no ICN in the project and no entity declared in this module.`, fix: `Add the ICN file, or declare the entity in the module's DOCTYPE.` });
    }
  }
  const imf = new Set(listObjects(projectId, 'imf').map((o) => o.control.replace(/_\d{3}-\d{2}$/, '').toUpperCase()));
  const shaSeen = new Map<string, Asset>();
  for (const a of assets) {
    if (!a.supported) findings.push({ code: 'UNSUPPORTED_FORMAT', severity: 'warn', asset: a.name, message: `${a.name} has a format the platform does not list for illustrations or multimedia.`, fix: 'Convert it to a supported format (see the asset format table).' });
    if (a.icn && !a.icnValid) findings.push({ code: 'BAD_ICN_NAME', severity: 'warn', asset: a.name, message: `${a.name} does not follow the ICN pattern ICN-<unique id>-<3-digit issue>-<2-digit security> (S1000D 4.2 Chap 7.5.1).`, fix: 'Rename the file (and the references to it) to a valid ICN.' });
    if (!used.has(a.name) && a.icn) findings.push({ code: 'ORPHAN', severity: 'info', asset: a.name, message: `No data module in this project refers to ${a.name}.`, fix: 'Keep it if a publication outside this project uses it; otherwise remove it.' });
    if (imf.size && a.icn && a.icnValid && !imf.has(a.icn.replace(/^ICN-/i, ''))) findings.push({ code: 'NO_METADATA', severity: 'info', asset: a.name, message: `${a.name} has no illustration metadata file (IMF), although this project keeps IMFs.`, fix: 'Create its IMF.' });
    const twin = shaSeen.get(a.sha256);
    if (twin && a.size > 0) findings.push({ code: 'DUPLICATE_CONTENT', severity: 'warn', asset: a.name, message: `${a.name} has exactly the same content as ${twin.name}.`, fix: 'Use one ICN for both figures, or keep both if they are legitimately separate objects.' });
    else shaSeen.set(a.sha256, a);
  }
  return { assets, findings };
}


/** The administrator's opt-in for the active-content types (JS, CSS, DOC, XLS, PPT, MDB, MPP, ZIP, FLA): off unless switched on. */
export const riskyAllowed = (): boolean => { try { return !!require('../context').store.configGet('app-state', 'asset-risky')?.on; } catch { return false; } };
export const setRiskyAllowed = (on: boolean): void => { require('../context').store.configPut('app-state', 'asset-risky', { on }, new Date().toISOString()); };

/** Why an SVG must not be stored (script content, event handlers, external entities), or null. */
export function svgProblem(text: string): string | null {
  const g = require('../core/auth/xmlGuard').checkXmlSafety(text); if (!g.ok) return g.error;
  if (/<script[\s>]|\son\w+\s*=|javascript:|<foreignObject[\s>]/i.test(text)) return 'it contains script, an event handler or foreign content';
  return null;
}
