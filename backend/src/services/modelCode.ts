// Change the model identification code (MIC) of a project that already has data modules.
//
// The MIC is the first part of every data module code, so it cannot be edited like a setting: every file name and every identification block and reference that
// carries it must change together. This service does exactly that, in one step, after showing what it would do:
//   - the files of the project's own modules and CSDB objects whose code starts with the old MIC are renamed (DMC-OLD-... -> DMC-NEW-...),
//   - the code inside each of them (dmCode, pmCode, dmlCode, commentCode, updateCode, ddnCode ...) and every reference to a module of the old MIC - in data modules, in
//     objects and in the publication module - is rewritten,
//   - the project's configuration then records the new MIC.
// Left alone, and said so: graphics (an ICN is named for its drawing, not for the project's MIC), references to modules of OTHER model codes (e.g. the
// S1000D default BREX), and linked copies of Common Information Repository modules (those change in the repository; if one carries the old MIC the change is refused).
// The original files are kept in `.model-code-backup-<time>/` inside the project, so the change can be undone by hand.

import fs from 'fs';
import path from 'path';
import { HttpError, bad, conflict } from './http';
import { projectDirFor } from '../context';
import { readProjectJson, csdbRel, pmRel } from './projects';
import * as PC from './projectConfig';
import { linkOf } from './cir';
import { docIndex } from '../context';
import { nowIso } from '../config';

const OBJECT_FILE = /^(DMC|PMC|DML|DDN|COM|UPF|UPE|SMC|SME)-([A-Za-z0-9]{2,14})-/i;
const CODE_TAGS = 'dmCode|pmCode|dmlCode|commentCode|updateCode|ddnCode|scormContentPackageCode';
const MIC_RE = /^[A-Za-z0-9]{2,14}$/;

export interface ModelCodePlan {
  from: string; to: string; applied: boolean;
  /** Files that will be (or were) renamed, old name -> new name. */
  renamed: Array<{ from: string; to: string }>;
  /** Files whose content changes (including renamed ones, and the publication module). */
  filesChanged: number;
  /** How many code attributes were rewritten across all files. */
  codesRewritten: number;
  untouched: string[];
  /** Reasons the change cannot be made; empty when it can. */
  problems: string[];
  backup?: string;
}

const escRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Rewrite every modelIdentCode="OLD" that belongs to one of the code elements; returns the new text and how many were changed. */
export function rewriteCodes(xml: string, from: string, to: string): { text: string; n: number } {
  let n = 0;
  const re = new RegExp(`(<(?:${CODE_TAGS})\\b[^>]*?\\bmodelIdentCode\\s*=\\s*")${escRe(from)}(")`, 'g');
  const text = xml.replace(re, (_m, a: string, b: string) => { n++; return `${a}${to}${b}`; });
  return { text, n };
}

export function currentMic(projectId: string): string {
  const cfg = PC.getConfig(projectId);
  if (cfg.mic) return cfg.mic;
  const mics = PC.dmStats(projectId).mics;
  if (mics.length === 1) return mics[0];
  throw conflict(mics.length ? `The data modules use ${mics.length} different model codes (${mics.join(', ')}), so there is no single code to change.` : 'The project has no data modules and no model code yet: set it in the project settings.', 'NO_SINGLE_MIC');
}

export async function changeModelCode(projectId: string, toRaw: unknown, actorId: string | null, opts: { apply: boolean }): Promise<ModelCodePlan> {
  const to = String(toRaw ?? '').trim().toUpperCase();
  if (!MIC_RE.test(to)) throw bad('The model identification code is 2 to 14 letters or digits.', 'BAD_MIC');
  const from = currentMic(projectId).toUpperCase();
  if (from === to) throw bad(`The project already uses ${to}.`, 'SAME_MIC');

  const pj = readProjectJson(projectId); const root = projectDirFor(projectId); const csdb = path.join(root, csdbRel(pj));
  const plan: ModelCodePlan = { from, to, applied: false, renamed: [], filesChanged: 0, codesRewritten: 0, untouched: [], problems: [] };
  const writes: Array<{ rel: string; abs: string; newAbs: string; text: string }> = [];

  const consider = (abs: string, rel: string, name: string) => {
    const xml = fs.readFileSync(abs, 'utf8');
    const { text, n } = rewriteCodes(xml, from, to);
    const m = OBJECT_FILE.exec(name); const ownsOld = !!m && m[2].toUpperCase() === from;
    const newName = ownsOld ? name.replace(OBJECT_FILE, (_s, p: string) => `${p}-${to}-`) : name;
    if (ownsOld && linkOf(projectId, name)) plan.problems.push(`${name} is a linked copy of a Common Information Repository module with the model code ${from}: it changes in the repository, not here.`);
    if (!n && newName === name) return;
    if (newName !== name && fs.existsSync(path.join(path.dirname(abs), newName))) plan.problems.push(`${newName} already exists in the project, so ${name} cannot be renamed to it.`);
    writes.push({ rel, abs, newAbs: path.join(path.dirname(abs), newName), text });
    plan.codesRewritten += n; plan.filesChanged++;
    if (newName !== name) plan.renamed.push({ from: name, to: newName });
  };

  if (fs.existsSync(csdb)) for (const f of fs.readdirSync(csdb)) if (/\.xml$/i.test(f) && OBJECT_FILE.test(f)) consider(path.join(csdb, f), `${csdbRel(pj)}/${f}`, f);
  const pm = path.join(root, pmRel(pj)); if (fs.existsSync(pm)) consider(pm, pmRel(pj), path.basename(pm));
  plan.untouched.push('graphics (an ICN is named for its drawing, not for the project\'s model code)', `references to data modules with another model code (they are not this project's)`);

  if (!opts.apply || plan.problems.length) return plan;

  // 1. a copy of everything that will change; 2. the new files; 3. the old names removed; 4. the configuration. A failure before step 3 removes what was written.
  const backup = path.join(root, `.model-code-backup-${nowIso().replace(/[:.]/g, '-')}`); fs.mkdirSync(backup, { recursive: true });
  for (const w of writes) fs.copyFileSync(w.abs, path.join(backup, w.rel.replace(/[\\/]/g, '__')));
  const created: string[] = [];
  try {
    for (const w of writes) { fs.writeFileSync(w.newAbs, w.text, 'utf8'); if (w.newAbs !== w.abs) created.push(w.newAbs); }
  } catch (e) { for (const c of created) try { fs.unlinkSync(c); } catch { /* none */ } throw e; }
  for (const w of writes) if (w.newAbs !== w.abs) fs.unlinkSync(w.abs);
  const cfg = PC.getConfig(projectId); cfg.mic = to; PC.updateConfigRaw(projectId, cfg, actorId);
  await docIndex.syncProject(projectId, root, nowIso());
  plan.applied = true; plan.backup = path.basename(backup);
  return plan;
}

export { HttpError };
