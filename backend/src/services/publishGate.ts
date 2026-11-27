// The publication gate: a PDF or a release needs a FRESH schema validation of what it will contain.
//
// Saving is deliberately permissive: a well-formed module that does not (yet) match its S1000D schema is a legitimate draft and is saved
// (malformed XML is not: see wellFormed.ts). Publishing is the opposite: nothing is rendered or released from a module that has not just
// been checked against its XSD and found valid. "Fresh" means this request validates the current files itself; a report stored by an
// earlier validation run is never consulted. A module the check could not judge at all (an issue this installation has no schema for,
// XInclude, the checker failing to run) counts as NOT valid: silence is not success.
//
// "Valid" means THREE layers: the S1000D schema, the project's business rules (BREX, see brex.ts) AND the applicability references (applicability.ts:
// a dangling applicRefId, an undeclared property, a value outside its enumeration, a table that does not hold together). Applicability warnings never block.
// The first two layers: A breach of a BREX rule at error severity blocks
// exactly like a schema error. So does a BREX that cannot be used: one the module names that is not in the project, or a rule in the project's own BREX
// that is not valid (an invalid XPath), because a business rule that cannot run silently does nothing. Warnings (rules of a lower severity level, rules
// this engine cannot evaluate) never block; they are returned to the caller.
//
// Scope: the data modules the publication contains (full build, release request, release approval) or the one module being previewed.
// Drafts that are not in the publication do not block it.
import fs from 'fs';
import path from 'path';
import { projectDirFor } from '../context';
import { HttpError, conflict } from './http';
import { readProjectJson, csdbRel } from './projects';
import { publicationSources, pmRefsOf } from './pm';
import { runValidation, type Issue } from './validation';
import { checkModuleBrex, newBrexRun } from './brex';
import { isS1000dProject } from './projects';
import { registerPublishCheck, publishCheckFor, type GateScope, type GatePass, type GateOptions } from './publishChecks';
import { waiverFor } from './publishWaivers';
import { sha256FileOr as sha } from '../lib/hash';

export interface GateFinding { file: string; kind: 'malformed' | 'schema' | 'unchecked' | 'brex' | 'brex-source' | 'applic' | 'revision'; title: string; detail: string; line: number }
export type { GateScope, GatePass, GateOptions } from './publishChecks';


/** The data modules (project-relative paths) a scope covers. */
export function gateTargets(projectId: string, scope: GateScope): string[] {
  const csdb = csdbRel(readProjectJson(projectId)).replace(/\/+$/, '');
  if (scope !== 'publication') return [`${csdb}/${scope.file}`];
  const prefix = `${csdb}/`.toLowerCase();
  return publicationSources(projectId).filter((rel) => rel.toLowerCase().startsWith(prefix));
}

/**
 * The gate: a fresh check of what a build will contain, by the check of the project's format (publishChecks.ts, WP-16 S1K-006). A JSS document
 * registers its own (its schema and the stencil's rules: services/jss/service.ts); everything else is judged by the S1000D check below.
 */
export async function assertPublishable(projectId: string, scope: GateScope, opts: GateOptions = {}): Promise<GatePass> {
  return publishCheckFor(projectId).check(projectId, scope, opts);
}

/** The S1000D check: schema, business rules (BREX), applicability and revision references of the modules the scope covers. */
async function assertS1000dPublishable(projectId: string, scope: GateScope, opts: GateOptions): Promise<GatePass> {
  const dir = projectDirFor(projectId);
  const files = gateTargets(projectId, scope);
  const want = new Set(files.map((f) => f.toLowerCase()));
  const hashesBefore = new Map(files.map((f) => [f, sha(path.join(dir, f))]));

  // fresh: validate now, with the same checks the Validation page runs (well-formedness, then XSD against each module's own declared issue)
  const run = await runValidation(projectId, { brex: false });          // the project's chosen issue (default: each module's own)

  const findings: GateFinding[] = [];
  for (const i of run.issues as Issue[]) {
    if ((i.source !== 'xml' && i.source !== 'xsd') || i.sev !== 'error' || !want.has(i.rel.toLowerCase())) continue;
    findings.push({ file: i.file, kind: i.source === 'xml' ? 'malformed' : 'schema', title: i.title, detail: i.detail.slice(0, 400), line: i.line });
  }
  // applicability references: errors in the modules this scope covers, and errors in the project's applicability tables themselves (they decide every result)
  for (const i of run.issues as Issue[]) {
    if (i.source !== 'applic' || i.sev !== 'error') continue;
    if (!want.has(i.rel.toLowerCase()) && !/APPLIC-(TABLE|ACT-REF|COND-TYPE)\b/.test(i.title)) continue;
    findings.push({ file: i.file, kind: 'applic', title: i.title, detail: `${i.detail} (at ${i.loc})`.slice(0, 500), line: i.line });
  }
  // revision references: a pinned issue that does not exist, or an obsolete module, cannot be published faithfully
  if (scope === 'publication') for (const i of run.issues as Issue[]) if (i.source === 'pm' && i.sev === 'error' && /Pinned revision|obsolete module/.test(i.title)) findings.push({ file: i.file, kind: 'revision', title: i.title, detail: i.detail.slice(0, 400), line: i.line });
  for (const rel of run.unchecked) {
    if (!want.has(rel.toLowerCase())) continue;
    // WP-32 (PERF-002): the reason travels with the module (too large for the validator, an issue that is not installed ...), never a generic line
    const why = run.uncheckedWhy?.[rel];
    findings.push({ file: rel.split('/').pop() ?? rel, kind: 'unchecked', title: 'Could not be checked against a schema', detail: why ? `${why} It cannot be treated as valid.` : 'The schema check did not run for this module, so it cannot be treated as valid.', line: 1 });
  }
  // business rules (BREX): fresh as well, read from the same files
  const csdbAbs = path.join(dir, csdbRel(readProjectJson(projectId)));
  const warnings: string[] = [];
  const ruleBreaks: string[] = [];
  const sourceSeen = new Set<string>();
  const usedProjectBrex = new Set<string>();                             // the project's own BREX data modules that the publication's modules rely on
  const brexRun = newBrexRun();                                          // WP-17: the CSDB listing and the BREX texts read once for this gate
  for (const rel of isS1000dProject(projectId) ? files : []) {      // business rules exist in S1000D only: a JSS or JSG project is never BREX-checked
    const abs = path.join(dir, rel);
    let text: string;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    const file = rel.split('/').pop() ?? rel;
    const rep = checkModuleBrex(text, csdbAbs, run.issueUsed, brexRun);
    for (const m of rep.models) if (m.projectOwn) usedProjectBrex.add(m.label);
    for (const f of rep.result.findings) {
      if (f.severity === 'error' && opts.allowRuleBreaks) { ruleBreaks.push(`${file}: ${f.ruleId} - ${f.message} (at ${f.where})`.slice(0, 400)); }
      else if (f.severity === 'error') findings.push({ file, kind: 'brex', title: `Breaks business rule ${f.ruleId}`, detail: `${f.message} (at ${f.where}; rule from ${f.brexSource})`.slice(0, 500), line: 1 });
      else warnings.push(`${file}: BREX ${f.ruleId} (warning level): ${f.message}`);
    }
    for (const p of rep.problems) {
      const key = `${p.kind}|${p.brex}|${p.ruleId ?? ''}`;
      if (p.severity === 'error') {
        if (sourceSeen.has(key)) continue;
        sourceSeen.add(key);
        // A BREX that is not in the project: a recorded waiver stands in for it in a draft build, and the build says so.
        const waiver = p.kind === 'missing-brex' ? waiverFor(projectId, 'brex-missing', String(p.brex)) : undefined;
        if (waiver && opts.waivable) {
          warnings.push(`BREX ${p.brex} is not available - its business rules are NOT enforced in this draft build (waived by ${waiver.by} on ${waiver.at.slice(0, 10)}: ${waiver.reason}). A release still needs it.`);
          continue;
        }
        findings.push({ file, kind: 'brex-source', title: p.kind === 'invalid-rule' ? `BREX ${p.brex} has an invalid rule` : p.kind === 'missing-brex' ? `BREX ${p.brex} is not available` : `BREX ${p.brex} cannot be used`,
          detail: waiver ? `${p.message} (A recorded waiver covers draft builds, not a release.)` : p.message, line: 1 });
      } else if (!sourceSeen.has(key)) { sourceSeen.add(key); warnings.push(p.message); }
    }
    if (rep.result.rulesSkipped) warnings.push(`${file}: ${rep.result.rulesSkipped} BREX rule${rep.result.rulesSkipped === 1 ? '' : 's'} could not be evaluated here (XPath 2.0 or unsupported) and ${rep.result.rulesSkipped === 1 ? 'is' : 'are'} not enforced.`);
  }

  // a BREX the project's rules come from must itself be a valid data module, or its rules cannot be trusted
  const csdbPrefix = csdbRel(readProjectJson(projectId)).replace(/\/+$/, '');
  for (const label of usedProjectBrex) {
    const rel = `${csdbPrefix}/${label}`.toLowerCase();
    for (const i of run.issues as Issue[]) {
      if ((i.source !== 'xml' && i.source !== 'xsd') || i.sev !== 'error' || i.rel.toLowerCase() !== rel) continue;
      findings.push({ file: label, kind: 'brex-source', title: `BREX ${label} is not a valid data module`, detail: `${i.title}: ${i.detail}`.slice(0, 400), line: i.line });
      break;
    }
  }

  if (findings.length) {
    const byKind = (...k: GateFinding['kind'][]) => [...new Set(findings.filter((f) => k.includes(f.kind)).map((f) => f.file))];
    const schema = byKind('malformed', 'schema');
    const unchecked = byKind('unchecked').filter((f) => !schema.includes(f));
    const brex = byKind('brex');
    const applic = byKind('applic');
    const source = findings.filter((f) => f.kind === 'brex-source');
    const parts: string[] = [];
    if (schema.length) parts.push(`${schema.length} data module${schema.length === 1 ? ' is' : 's are'} not valid against the S1000D schema`);
    // WP-32: say what really happened: not "not valid" for a module the validator never judged
    if (unchecked.length) {
      const big = findings.filter((f) => f.kind === 'unchecked' && /too large for the schema validator|ran out of memory/.test(f.detail)).length;
      parts.push(`the schema check could not judge ${unchecked.length} data module${unchecked.length === 1 ? '' : 's'}${big ? ` (the validator ran out of memory or the module is too large: ${big})` : ''}`);
    }
    if (brex.length) parts.push(`${brex.length} data module${brex.length === 1 ? ' breaks' : 's break'} the project's business rules (BREX)`);
    if (applic.length) parts.push(`${applic.length} data module${applic.length === 1 ? ' has' : 's have'} applicability references that do not resolve`);
    const revs = byKind('revision');
    if (revs.length) parts.push(`the publication has ${revs.length === 1 ? 'a reference' : 'references'} to a revision that does not exist or to an obsolete module`);
    if (source.length) parts.push(`${source.length === 1 ? 'a BREX' : source.length + ' BREX problems'} cannot be used: ${source[0].title}${source.some((f) => /is not available/.test(f.title)) ? '. The data modules name a business rules (BREX) file this project does not have: use "Create the BREX" in the yellow bar at the top of the project, or import the original file' : ''}`);
    const modules = [...new Set(findings.map((f) => f.file))];
    const first = findings[0];
    throw new HttpError(422,
      `Not published: ${parts.join('; ')} (first: ${first.file} - ${first.title}). Fix ${modules.length === 1 && !source.length ? 'it' : 'them'} and try again. Drafts that are not in the publication are not affected.`,
      'VALIDATION_FAILED', { findings: findings.slice(0, 50), totalFindings: findings.length, modules, validatedAt: run.ranAt });
  }

  // An annexure is only a reference to another publication, and this build does not embed one: it prints nothing. Say so, for every one, so the book
  // is never quietly shorter than its table of contents says (the importer keeps these entries when the annexure was not part of the package).
  if (scope === 'publication') {
    for (const a of pmRefsOf(projectId)) warnings.push(`Annexure${a.title ? ` "${a.title}"` : ''}${a.code ? ` (publication ${a.code})` : ''} is a reference to a separate publication and is NOT part of this PDF.`);
  }

  return {
    validatedAt: run.ranAt,
    files,
    warnings,
    ruleBreaks,
    // the files are validated and then rendered a moment later: refuse if any changed in between, so what is published is what was checked
    verifyUnchanged: () => {
      for (const f of files) {
        if (sha(path.join(dir, f)) !== hashesBefore.get(f)) throw conflict(`${f.split('/').pop()} changed while it was being validated. Nothing was published; try again.`, 'CHANGED_DURING_VALIDATION');
      }
    },
  };
}

registerPublishCheck({ format: 's1000d', owns: () => true, check: assertS1000dPublishable }, { asDefault: true });
