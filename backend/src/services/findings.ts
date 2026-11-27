// =============================================================================
// Findings: every validation result in ONE shape - the module it is about, the rule, the XML location, and what to do about it.
//
// Sources, each judged with the scope that fits it:
//   - the project validation run (XSD, BREX, applicability, graphics, publication, extensions): mapped, not re-run unless asked;
//   - project consistency (this file): file name vs identification (DMC / PMC / DML / DDN / COM / UPF / SMC / IMF), model identification code,
//     S1000D issue, DM type, information code, SNS, cross-module references (dmRef), ICN references and asset integrity.
// IDs are NOT compared across modules (S1000D requires them unique within one module only).
// =============================================================================

import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { csdbRel, readProjectJson } from './projects';
import { listDms, csdbDir, dmcString, type DmSummary } from './csdb';
import { lastRun, runValidation, type Issue } from './validation';
import { newDmProblems } from './projectConfig';
import { checkAssets } from './assets';
import { fileNameProblem, listObjects, OBJECT_FILE_RE, type ObjectSummary } from './csdbObjects';
import { readAttrs } from './xmlHead';

export interface Finding { module: string; rule: string; severity: 'error' | 'warn' | 'info'; location: string; line: number; message: string; fix: string; source: string }

const FIX: Record<string, string> = {
  xsd: 'Change the element or attribute named in the message so it matches the S1000D schema for this module\'s declared issue.',
  xml: 'Correct the XML syntax at the line shown (an unclosed or mis-nested tag is the usual cause).',
  brex: 'Change the content to satisfy the BREX rule, or - if the rule is wrong for this project - ask the BREX owner to change the rule.',
  applic: 'Make the applicRefId point at an applicability declared in this module, and make the asserted property exist in the ACT/CCT/PCT.',
  graphics: 'Add the ICN artwork to the project, or correct the reference.',
  ids: 'No action needed unless you build the JSS book: ids are only required to be unique within one module.',
  icn: 'Declare the ICN entity in the module (Tools > Entities).',
  pm: 'Fix the publication module entry, or add / restore the data module it refers to.',
};
const ruleOf = (i: Issue): string => (i.source === 'brex' ? i.title.replace(/^BREX\s+/, 'BREX:') : i.source === 'applic' ? i.title.replace(/^Applicability\s+/, 'APPLIC:') : i.source === 'xsd' && /^Extension: /.test(i.title) ? i.title.replace('Extension: ', '') : i.source === 'xsd' ? 'XSD' : i.source.toUpperCase());
const fixOf = (i: Issue): string => (/Fix: (.*)$/s.exec(i.detail)?.[1] ?? FIX[i.source] ?? 'Review the message and correct the module.');

export const fromIssue = (i: Issue): Finding => ({ module: i.file || i.rel, rule: ruleOf(i), severity: i.sev, location: i.loc || `${i.file}:${i.line}`, line: i.line, message: i.detail || i.title, fix: fixOf(i), source: i.source });

const expectedDmFile = (d: DmSummary): string => {
  const ext = d.identExtension?.extensionProducer ? `${d.identExtension.extensionProducer}-${d.identExtension.extensionCode ?? ''}-` : '';
  return `${ext}${dmcString(d.dmCodeAttrs)}_${d.issueNumber}-${d.inWork}_${d.languageAttrs.languageIsoCode ?? ''}-${(d.languageAttrs.countryIsoCode ?? '').toUpperCase()}`.toUpperCase();
};
const lineOf = (xml: string, needle: RegExp): number => { const m = needle.exec(xml); return m ? xml.slice(0, m.index).split('\n').length : 1; };

export function consistency(projectId: string): Finding[] {
  const out: Finding[] = []; const dir = csdbDir(projectId); const dms = listDms(projectId); const have = new Set(dms.map((d) => d.dmc.toUpperCase()));
  for (const d of dms) {
    let xml = ''; try { xml = fs.readFileSync(path.join(dir, d.file), 'utf8'); } catch { continue; }
    // file name vs identification (Chap 7.5.1)
    const want = expectedDmFile(d); const have1 = d.file.replace(/^DMC-/i, '').replace(/^DME-/i, '').replace(/\.xml$/i, '').toUpperCase();
    if (d.dmCodeAttrs.modelIdentCode && have1 !== want) out.push({ module: d.file, rule: 'DMC_FILE_NAME', severity: 'warn', location: '<dmIdent>', line: lineOf(xml, /<dmIdent>/), message: `The file name does not match the module's own identification (expected DMC-${want}.XML).`, fix: 'Rename the file to the name its dmIdent calls for, or correct the dmIdent.', source: 'consistency' });
    // project configuration (MIC, issue, type, information code, SNS)
    for (const p of newDmProblems(projectId, xml)) {
      const rule = /model identification/i.test(p) ? 'PROJECT_MIC' : /Issue/.test(p) && /project is/.test(p) ? 'PROJECT_ISSUE' : /does not offer/.test(p) ? 'PROJECT_DM_TYPE' : /Information code/.test(p) ? 'INFO_CODE' : /SNS/.test(p) ? 'SNS' : 'PROJECT_CONFIG';
      out.push({ module: d.file, rule, severity: 'warn', location: '<dmCode>', line: lineOf(xml, /<dmCode\b/), message: p, fix: rule === 'SNS' ? 'Add the system / subsystem / assembly to the project SNS, or correct the data module code.' : rule === 'INFO_CODE' ? 'Enable the information code for the project (S1000D settings), or use an enabled one.' : 'Correct the module, or change the project configuration (S1000D settings).', source: 'consistency' });
    }
    // cross-module references: dmRef to a module this project does not hold (legitimate across projects, so a warning)
    for (const m of xml.matchAll(/<dmRef\b[^>]*>([\s\S]*?)<\/dmRef>/g)) {
      const code = /<dmCode\b([^>]*?)\/?>/.exec(m[1]); if (!code) continue; const a = readAttrs(code[1]);
      const dmc = dmcString(a).toUpperCase(); if (!have.has(dmc)) out.push({ module: d.file, rule: 'XREF_DM', severity: 'warn', location: `<dmRef> ${dmc}`, line: xml.slice(0, m.index).split('\n').length, message: `Refers to data module ${dmc}, which is not in this project.`, fix: 'Add the module to the project (or the Common Information Repository), or remove the reference if it points to another CSDB.', source: 'consistency' });
    }
  }
  // CSDB objects: file name vs identification
  for (const o of listObjects(projectId) as ObjectSummary[]) {
    const xml = fs.readFileSync(path.join(dir, o.file), 'utf8'); const p = fileNameProblem(o.file, xml);
    if (p) out.push({ module: o.file, rule: `${o.prefix}_FILE_NAME`, severity: 'warn', location: 'identification', line: 1, message: p, fix: 'Rename the file, or correct the identification inside it.', source: 'consistency' });
  }
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (/^(DML|DDN|COM|UPF|UPE|SMC|SME|IMF)-/i.test(f) && !OBJECT_FILE_RE.test(f)) out.push({ module: f, rule: 'CSDB_FILE_NAME', severity: 'warn', location: 'file name', line: 1, message: 'Not a valid CSDB object file name (expected .xml and only letters, digits, - . _).', fix: 'Rename the file.', source: 'consistency' });
  // ICN references and asset integrity
  for (const f of checkAssets(projectId).findings) out.push({ module: f.module ?? f.asset, rule: `ICN_${f.code}`, severity: f.severity, location: f.location ?? f.asset, line: 1, message: f.message, fix: f.fix, source: 'assets' });
  void projectDirFor; void csdbRel; void readProjectJson;
  return out;
}

/** The project's findings: the validation run (reused, or re-run when asked) + consistency. */
export async function allFindings(projectId: string, rerun = false): Promise<{ ranAt: string | null; findings: Finding[]; counts: Record<string, number> }> {
  const run = rerun || !lastRun(projectId) ? await runValidation(projectId, {}) : lastRun(projectId)!;
  const findings = [...run.issues.map(fromIssue), ...consistency(projectId)];
  const counts: Record<string, number> = { error: 0, warn: 0, info: 0 }; for (const f of findings) counts[f.severity]++;
  return { ranAt: run.ranAt, findings, counts };
}
