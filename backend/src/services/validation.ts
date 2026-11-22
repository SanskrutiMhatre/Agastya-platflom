// =============================================================================
// Project validation - every check, one normalised issue list.
//
// Ported from JSS Publisher's GET /api/validate and extended with BREX (from
// Agastya) and publication-module checks. The point is a single list the
// Validation dashboard can review: each issue says what is wrong (title/detail),
// where (file + line) and which check found it (source), so the error-review
// screen can group, filter and jump to the offending line in the editor.
//
//   xml      well-formedness, by the bundled libxml2 - the parser the build uses
//   xsd      S1000D schema for the issue each file DECLARES (never a fixed set)
//   brex     business rules: the project's BREX, else the S1000D default
//   graphics referenced ICN artwork that is not on disk
//   ids      the same @id declared by more than one module (breaks references in the book)
//   icn      graphics naming an ICN the module never declares (information)
//   pm       publication entries that name modules the project does not have
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso, vendor } from '../config';
import { projectDirFor } from '../context';
import { readProjectJson, updateProjectJson, csdbRel, mediaRel, isS1000dProject } from './projects';
import { explore } from './pm';
import { listDms } from './csdb';
import { checkModuleBrex } from './brex';
import { pmRevisionProblems } from './lifecycle';
import { analyse as analyseExt, usesForeign } from './extensions';

const paths = vendor('engine/paths');
const { validateProjectXml } = vendor('engine/validateXml');
const { validateProjectSchema, installedIssues } = vendor('engine/validateSchema');
import { getConfigRow } from './projectConfig';
import { validateProject as validateApplicability } from './applicability';
import { ISSUE_LABEL } from './s1000dRef';
const imagesEngine = vendor('engine/images');
const fixIds = vendor('engine/fixIds');
const fixEntities = vendor('engine/fixEntities');

export type Severity = 'error' | 'warn' | 'info';
export interface Issue {
  id: string; source: 'xml' | 'xsd' | 'brex' | 'graphics' | 'ids' | 'icn' | 'pm' | 'applic';
  sev: Severity; title: string; rel: string; file: string; line: number; loc: string; detail: string;
}
export interface ValidationRun {
  ranAt: string; issueUsed: string; checked: number; schemaChecked: number; brexChecked: number;
  summary: { error: number; warn: number; info: number }; issues: Issue[]; notes: string[];
  /** project-relative files the schema check could NOT judge (undeclared/unsupported issue, XInclude, the check could not run). Not the same as valid. */
  unchecked: string[];
}

const reportFile = (projectId: string): string => path.join(projectDirFor(projectId), '.validation.json');

export function lastRun(projectId: string): ValidationRun | null {
  try { return JSON.parse(fs.readFileSync(reportFile(projectId), 'utf8')); } catch { return null; }
}

export function installedSchemaIssues(): string[] { return installedIssues(); }

let seq = 0;
/** Applicability reference problems (services/applicability), as validation issues with the data module and XML location. */
function applicIssues(projectId: string): Issue[] {
  try {
    return validateApplicability(projectId).map((p) => norm('applic', { sev: p.severity === 'error' ? 'error' : 'warn', title: `Applicability ${p.code}`, rel: p.file, line: p.line, loc: p.location, detail: p.message }));
  } catch (e) { return [norm('applic', { sev: 'warn', title: 'Applicability not checked', rel: '', line: 1, detail: (e as Error).message })]; }
}

function norm(source: Issue['source'], i: any, fallbackSev: Severity = 'warn'): Issue {
  const sev: Severity = i.sev === 'error' || i.sev === 'warn' || i.sev === 'info' ? i.sev : fallbackSev;
  const rel = String(i.rel ?? '');
  return {
    id: `${source}-${++seq}`, source, sev, title: String(i.title ?? 'Problem'), rel,
    file: rel.split('/').pop() ?? rel, line: Math.max(1, Number(i.line) || 1),
    loc: String(i.loc ?? ''), detail: String(i.detail ?? i.message ?? ''),
  };
}

/** Graphic references that do not resolve, by the SAME order of resolution the pipelines use. */
function missingGraphics(dir: string, csdb: string, media: string): Issue[] {
  const csdbAbs = path.join(dir, csdb);
  if (!fs.existsSync(csdbAbs)) return [];
  const index = imagesEngine.buildFileIndex(dir, [csdb, media]);
  const out: Issue[] = [];
  for (const fname of fs.readdirSync(csdbAbs).filter((f) => /^DMC-.*\.xml$/i.test(f))) {
    let text: string;
    try { text = fs.readFileSync(path.join(csdbAbs, fname), 'utf8'); } catch { continue; }
    const entities = new Map<string, string>();
    const entRe = /<!ENTITY\s+([\w.\-]+)\s+SYSTEM\s+"([^"]+)"/g;
    let em: RegExpExecArray | null;
    while ((em = entRe.exec(text))) entities.set(em[1], em[2]);

    const refRe = /<(graphic|symbol)\b([^>]*)\/?>/g;
    let gm: RegExpExecArray | null;
    while ((gm = refRe.exec(text))) {
      const attrs = gm[2];
      const line = text.slice(0, gm.index).split('\n').length;
      const src = (/\bsrc\s*=\s*"([^"]*)"/.exec(attrs) || [])[1];
      if (src && src.trim()) {
        if (fs.existsSync(path.join(dir, src.trim().replace(/\\/g, '/')))) continue;
        out.push(norm('graphics', { sev: 'warn', title: 'Missing referenced graphic', rel: `${csdb}/${fname}`, line, loc: `${fname}:${line}`, detail: `<${gm[1]} src="${src.trim()}"> - file not found` }));
        continue;
      }
      const icn = ((/\binfoEntityIdent\s*=\s*"([^"]*)"/.exec(attrs) || [])[1] || '').trim();
      if (!icn) continue;
      const declared = entities.get(icn);
      if (declared) { if (fs.existsSync(path.join(csdbAbs, declared.replace(/\\/g, '/')))) continue; }
      else if (index.get(icn.toLowerCase()) || index.get((icn + '.png').toLowerCase())) continue;
      out.push(norm('graphics', {
        sev: 'warn', title: 'Missing referenced graphic', rel: `${csdb}/${fname}`, line, loc: `${fname}:${line}`,
        detail: declared
          ? `ICN "${icn}" is declared as "${declared}" in ${csdb}/ - file not found`
          : `ICN "${icn}" has no entity declaration and no matching file in ${csdb}/ or ${media}/`,
      }));
    }
  }
  return out;
}

function duplicateIds(dir: string, csdb: string): Issue[] {
  try {
    const plan = fixIds.planFixIds(path.join(dir, csdb));
    return plan.collisions.map((c: any) => norm('ids', {
      sev: 'info', title: 'Same ID in several data modules', rel: `${csdb}/${c.files[0]}`, line: 1, loc: c.id,
      detail: `declared by ${c.count} data modules (${c.files.slice(0, 3).join(', ')}${c.files.length > 3 ? ', ...' : ''}). S1000D requires an id to be unique only WITHIN one data module, so this is not an error; it matters only to the JSS book build, which resolves an id to whichever module it reaches first.`,
    }));
  } catch { return []; }
}

function undeclaredIcns(dir: string, csdb: string, media: string): Issue[] {
  try {
    const plan = fixEntities.planFixEntities(dir, csdb, media);
    return plan.plan.map((p: any) => norm('icn', {
      sev: 'info', title: 'Undeclared ICN entity', rel: `${csdb}/${p.file}`, line: 1, loc: p.file,
      detail: `${p.entities} graphic${p.entities === 1 ? '' : 's'} reference ICNs this module never declares. The image is found on disk and prints, but the module does not say where it is.`,
    }));
  } catch { return []; }
}

/** The S1000D issue the project's checks use: 'auto' (each module's own declaration) or one of the installed issues. */
export function projectIssue(projectId: string): string {
  // The project's S1000D issue, when its configuration sets one, IS the issue its checks use: one setting, not two.
  const cfgIssue = getConfigRow(projectId)?.config.issue;
  if (cfgIssue) return ISSUE_LABEL[cfgIssue];
  const v = readProjectJson(projectId)?.validation?.issue;
  return typeof v === 'string' && (v === 'auto' || installedIssues().includes(v)) ? v : 'auto';
}
export function setProjectIssue(projectId: string, issue: string): string {
  if (issue !== 'auto' && !installedIssues().includes(issue)) throw new Error(`S1000D issue ${issue} is not installed (available: ${installedIssues().join(', ')}).`);
  updateProjectJson(projectId, (pj: any) => { pj.validation = { ...(pj.validation ?? {}), issue }; });
  return issue;
}

export async function runValidation(projectId: string, opts: { issue?: string; brex?: boolean } = {}): Promise<ValidationRun> {
  const dir = projectDirFor(projectId);
  const pj = readProjectJson(projectId);
  const csdb = csdbRel(pj);
  const media = mediaRel(pj);
  const notes: string[] = [];
  // an explicit choice wins; otherwise the project's own setting (so a build, a preview and a release judge the same way as the page)
  const wanted = opts.issue ?? projectIssue(projectId);
  const issueUsed = wanted && wanted !== 'auto' ? wanted : 'auto';

  // Well-formedness first: it is the check that stops a build, and schema checking
  // only for files that PARSE (a second complaint about the same broken file is noise).
  const xml = await validateProjectXml(paths.XSLTPROC, dir);
  const broken = new Set<string>(xml.issues.map((i: any) => i.rel));
  // Modules that use another namespace: the host schema judges them with the enabled extension content taken out (same lines); the extension
  // content is judged by its own profile XSD, and unregistered / not-enabled namespaces are errors (services/extensions.ts).
  const parseable: string[] = xml.files.filter((f: string) => !broken.has(f));
  const extIssues: Issue[] = [];
  const hostDir = path.join(dir, '.ext-host');
  const hostFiles: string[] = []; const direct: string[] = [];
  for (const rel of parseable) {
    let text = ''; try { text = fs.readFileSync(path.join(dir, rel), 'utf8'); } catch { direct.push(rel); continue; }
    if (!usesForeign(text)) { direct.push(rel); continue; }
    const a = await analyseExt(projectId, text);
    for (const f of a.findings) extIssues.push(norm('xsd', { sev: f.severity === 'error' ? 'error' : 'info', title: `Extension: ${f.rule}`, rel, line: f.line, loc: f.location, detail: `${f.message} Fix: ${f.fix}` }));
    const dest = path.join(hostDir, rel); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.writeFileSync(dest, a.host, 'utf8'); hostFiles.push(rel);
  }
  const schema = await validateProjectSchema(dir, direct, { issue: issueUsed });
  if (hostFiles.length) {
    try {
      const hs = await validateProjectSchema(hostDir, hostFiles, { issue: issueUsed, includeNotes: false });
      schema.issues.push(...hs.issues);
    } finally { fs.rmSync(hostDir, { recursive: true, force: true }); }
  }

  const issues: Issue[] = [
    ...xml.issues.map((i: any) => norm('xml', i, 'error')),
    ...schema.issues.map((i: any) => norm('xsd', i, 'error')),
    ...extIssues,
    ...applicIssues(projectId),
    ...missingGraphics(dir, csdb, media),
    ...duplicateIds(dir, csdb),
    ...undeclaredIcns(dir, csdb, media),
  ];

  // Publication module: entries that name modules this project does not have.
  try {
    const ex = explore(projectId);
    for (const ref of ex.missing) {
      issues.push(norm('pm', { sev: 'error', title: 'Publication entry has no data module', rel: pj.input?.pm || 'publication.xml', line: 1, loc: ref, detail: `The publication refers to "${ref}", which is not in this project's data modules - nothing is published for it.` }));
    }
    // revisions: a pinned issue the project does not hold; a reference to an obsolete (deleted) module
    try {
      const pmAbs = path.join(dir, pj.input?.pm || 'publication.xml');
      if (fs.existsSync(pmAbs)) for (const p of pmRevisionProblems(projectId, fs.readFileSync(pmAbs, 'utf8'))) issues.push(norm('pm', { sev: 'error', title: p.code === 'OBSOLETE_MODULE' ? 'Publication refers to an obsolete module' : 'Pinned revision not in the project', rel: pj.input?.pm || 'publication.xml', line: 1, loc: p.ref, detail: `${p.message} Fix: ${p.fix}` }));
    } catch { /* the revision check is advisory when the publication cannot be read */ }
    if (ex.totals.unplaced > 0) {
      issues.push(norm('pm', { sev: 'info', title: 'Data modules not in the publication', rel: pj.input?.pm || 'publication.xml', line: 1, loc: `${ex.totals.unplaced}`, detail: `${ex.totals.unplaced} data module${ex.totals.unplaced === 1 ? ' is' : 's are'} in the project but not placed in any chapter, so they are not published.` }));
    }
  } catch (e) { notes.push(`Publication checks skipped: ${(e as Error).message}`); }

  let brexChecked = 0;
  if (opts.brex && isS1000dProject(projectId)) {
    const csdbAbs = path.join(dir, csdb);
    const reported = new Set<string>();                                  // a BREX problem is the same for every module that names it: say it once
    for (const d of listDms(projectId)) {
      try {
        const text = fs.readFileSync(path.join(csdbAbs, d.file), 'utf8');
        const rep = checkModuleBrex(text, csdbAbs, issueUsed);
        brexChecked++;
        for (const f of rep.result.findings) {
          issues.push(norm('brex', { sev: f.severity === 'error' ? 'error' : 'warn', title: `BREX ${f.ruleId}`, rel: `${csdb}/${d.file}`, line: 1, loc: f.where, detail: f.message + (f.found !== undefined ? ` [found: ${f.found}]` : '') + ` (from ${f.brexSource})` }));
        }
        for (const p of rep.problems) {
          const key = `${p.kind}|${p.brex}|${p.ruleId ?? ''}`;
          if (reported.has(key)) continue;
          reported.add(key);
          issues.push(norm('brex', { sev: p.severity === 'error' ? 'error' : 'warn', title: p.kind === 'invalid-rule' || p.kind === 'unenforced-rule' ? 'BREX rule cannot be used' : 'BREX data module unavailable', rel: `${csdb}/${d.file}`, line: 1, loc: p.brex, detail: p.message }));
        }
        if (rep.result.rulesSkipped) notes.push(`${d.file}: ${rep.result.rulesSkipped} BREX rule${rep.result.rulesSkipped === 1 ? '' : 's'} could not be evaluated here (XPath 2.0 or unsupported) and ${rep.result.rulesSkipped === 1 ? 'is' : 'are'} not enforced.`);
      } catch (e) { notes.push(`BREX check failed for ${d.file}: ${(e as Error).message}`); }
    }
  }

  for (const n of schema.notes ?? []) if (n.sev === 'info' && n.title) notes.push(`${n.rel}: ${n.title}`);

  const summary = { error: 0, warn: 0, info: 0 };
  for (const i of issues) summary[i.sev]++;
  // A file the schema check skipped or could not run is NOT valid: report it, so a gate can refuse it instead of reading silence as success.
  const unchecked = new Set<string>();
  for (const n of [...(schema.notes ?? []), ...(schema.issues ?? [])]) if (n.rel && /Not checked|could not run/i.test(String(n.title ?? ''))) unchecked.add(String(n.rel));
  const run: ValidationRun = { ranAt: nowIso(), issueUsed, checked: xml.checked, schemaChecked: schema.checked, brexChecked, summary, issues, notes, unchecked: [...unchecked] };
  try { fs.writeFileSync(reportFile(projectId), JSON.stringify(run)); } catch { /* the report is a convenience */ }
  return run;
}
