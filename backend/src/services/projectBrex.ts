// =============================================================================
// The project's own BREX data module.
//
// Every S1000D data module names the BREX it follows. A project created here, or one imported without its BREX, names a BREX of its own model
// (for example DMC-RDR-A-00-00-00-00A-022A-D) that does not exist, and the publication gate then refuses to publish: the rules it asked for cannot be read.
//
// This creates that data module. It adds NO rules of its own: it names the S1000D default BREX of the project's issue as its parent (the chain the
// engine already follows), so the rules enforced are exactly the official defaults, and a rule the organisation wants can be added to it later.
// Only a BREX that some module actually names and that the project does not hold is created; nothing is overwritten.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { bad } from './http';
import { getConfig, DEFAULT_COUNTRY } from './projectConfig';
import { ISSUE_LABEL } from './s1000dRef';
import { csdbDir, listDms, createDm } from './csdb';
import { declaredBrexDmc, defaultLetterFor } from './brex';
import { hasSchema } from './registry';
import { FileMemo } from './fileMemo';

const { validateDocument } = require('../../vendor/engine/validateSchema');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const DEFAULT_PARENT = /^DMC-S1000D-[A-Z]-04-10-0301-00A-022A-D$/;
const NS = 'xmlns:dc="http://www.purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';

// WP-18 (FE-028, PERF-016): the BREX a module names is read once per version of the file (size, mtime, ctime), not on every poll.
const declaredMemo = new FileMemo<string | null>();

/** The BREX data modules that project modules name, are not S1000D defaults, and are not in the project. */
export function missingBrex(projectId: string): string[] {
  const dir = csdbDir(projectId);
  const dms = listDms(projectId);
  const have = dms.map((d) => d.file.toUpperCase());
  const out = new Set<string>();
  for (const d of dms) {
    let want: string | null = null;
    const abs = path.join(dir, d.file);
    try { want = declaredMemo.get(abs, fs.statSync(abs), () => declaredBrexDmc(fs.readFileSync(abs, 'utf8'))); } catch { /* unreadable: the other checks report it */ }
    if (!want || DEFAULT_PARENT.test(want)) continue;
    if (!have.some((f) => f.startsWith(want!.toUpperCase()))) out.add(want);
  }
  return [...out];
}

/** "DMC-RDR-A-00-00-00-00A-022A-D" to its attributes (the same split the engine joined them with). */
function parseDmc(dmc: string): Record<string, string> | null {
  const m = /^DMC-([A-Z0-9]{2,14})-([A-Z0-9]{1,4})-([A-Z0-9]{2,3})-([A-Z0-9])([A-Z0-9])-([A-Z0-9]{2,4})-([A-Z0-9]{2})([A-Z0-9]{1,3})-(\d{3})([A-Z0-9])-([A-D])$/.exec(dmc.toUpperCase());
  if (!m) return null;
  return { modelIdentCode: m[1], systemDiffCode: m[2], systemCode: m[3], subSystemCode: m[4], subSubSystemCode: m[5], assyCode: m[6], disassyCode: m[7], disassyCodeVariant: m[8], infoCode: m[9], infoCodeVariant: m[10], itemLocationCode: m[11] };
}
const codeAttrs = (a: Record<string, string>) => ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'].map((k) => `${k}="${esc(a[k])}"`).join(' ');

export async function createProjectBrex(projectId: string, actor: { id: string; role?: string }): Promise<{ created: string[]; notes: string[] }> {
  const cfg = getConfig(projectId);
  if (!cfg.issue) throw bad('This project has no single S1000D issue, so a BREX cannot be written for it.', 'NO_ISSUE');
  if (!hasSchema(cfg.issue, 'brex')) throw bad(`S1000D ${ISSUE_LABEL[cfg.issue]}: no BREX schema is bundled, so a BREX cannot be created.`, 'NO_SCHEMA');
  const want = missingBrex(projectId);
  if (!want.length) throw bad('Every BREX the data modules name is already in the project.', 'NOTHING_TO_CREATE');
  // the company comes from the project's settings, or (an imported project) from what its own data modules say
  const fromDms = (tag: 'responsiblePartnerCompany' | 'originator'): { code: string; name: string } => {
    for (const d of listDms(projectId)) {
      const x = fs.readFileSync(path.join(csdbDir(projectId), d.file), 'utf8').slice(0, 30000);
      const m = new RegExp(`<${tag}\\b[^>]*enterpriseCode="([^"]+)"[^>]*>(?:\\s*<enterpriseName>([^<]*)</enterpriseName>)?`).exec(x);
      if (m) return { code: m[1], name: (m[2] ?? '').trim() };
    }
    return { code: '', name: '' };
  };
  const rpc = cfg.responsiblePartner.code ? cfg.responsiblePartner : fromDms('responsiblePartnerCompany');
  const orig = cfg.originator.code ? cfg.originator : (fromDms('originator').code ? fromDms('originator') : rpc);
  if (!rpc.code) throw bad('The project has no responsible partner company code yet (Project settings > S1000D).', 'NO_RPC');
  const country = (cfg.country || DEFAULT_COUNTRY).toUpperCase(); const lang = (cfg.language || 'en').toLowerCase();
  const d = new Date(); const pad = (n: number) => String(n).padStart(2, '0');
  const created: string[] = []; const notes: string[] = [];
  for (const dmc of want) {
    const a = parseDmc(dmc);
    if (!a || a.infoCode !== '022') throw bad(`${dmc} is not a BREX code (information code 022), so it will not be created.`, 'NOT_A_BREX');
    const letter = defaultLetterFor(cfg.issue);
    const parent: Record<string, string> = { modelIdentCode: 'S1000D', systemDiffCode: letter, systemCode: '04', subSystemCode: '1', subSubSystemCode: '0', assyCode: '0301', disassyCode: '00', disassyCodeVariant: 'A', infoCode: '022', infoCodeVariant: 'A', itemLocationCode: 'D' };
    const url = `http://www.s1000d.org/S1000D_${cfg.issue}/xml_schema_flat/brex.xsd`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<dmodule ${NS} xsi:noNamespaceSchemaLocation="${url}"><identAndStatusSection><dmAddress><dmIdent><dmCode ${codeAttrs(a)}/><language languageIsoCode="${esc(lang)}" countryIsoCode="${esc(country)}"/><issueInfo issueNumber="001" inWork="00"/></dmIdent><dmAddressItems><issueDate year="${d.getFullYear()}" month="${pad(d.getMonth() + 1)}" day="${pad(d.getDate())}"/><dmTitle><techName>${esc(a.modelIdentCode)}</techName><infoName>Business rules exchange data module</infoName></dmTitle></dmAddressItems></dmAddress><dmStatus issueType="new"><security securityClassification="${esc(cfg.security || '01')}"/><responsiblePartnerCompany enterpriseCode="${esc(rpc.code)}">${rpc.name ? `<enterpriseName>${esc(rpc.name)}</enterpriseName>` : ''}</responsiblePartnerCompany><originator enterpriseCode="${esc(orig.code)}">${orig.name ? `<enterpriseName>${esc(orig.name)}</enterpriseName>` : ''}</originator><applic><displayText><simplePara>All</simplePara></displayText></applic><brexDmRef><dmRef><dmRefIdent><dmCode ${codeAttrs(parent)}/><issueInfo issueNumber="001" inWork="00"/></dmRefIdent></dmRef></brexDmRef><qualityAssurance><unverified/></qualityAssurance></dmStatus></identAndStatusSection><content><brex><commonInfo><para>Business rules of the ${esc(a.modelIdentCode)} project. It adds no rules of its own: the rules in force are the S1000D default business rules of the issue, named above as its BREX. A rule the organisation requires is added here as a context rule.</para></commonInfo><contextRules><structureObjectRuleGroup><structureObjectRule><objectPath allowedObjectFlag="1">//dmodule</objectPath><objectUse>Data modules of this project are allowed; this entry restricts nothing.</objectUse></structureObjectRule></structureObjectRuleGroup></contextRules></brex></content></dmodule>`;
    const file = `${dmc}_001-00_${lang.toUpperCase()}-${country}.xml`;
    // the module must be valid before it is written: a BREX that fails the schema would only move the refusal somewhere else
    const r = await validateDocument(file, xml, { issue: ISSUE_LABEL[cfg.issue] });
    if (r.note || !r.schema) throw bad(`${file} could not be schema-checked (${r.note ?? 'schema not installed'}), so it was not created.`, 'NOT_VALIDATED');
    if (r.diagnostics.length) throw bad(`The BREX is not valid against S1000D ${ISSUE_LABEL[cfg.issue]}: ${r.diagnostics.slice(0, 3).map((x: any) => `line ${x.line}: ${x.message}`).join(' | ')}`, 'TEMPLATE_INVALID');
    await createDm(projectId, file, xml, actor as any);
    created.push(file);
    notes.push(`${file} inherits the S1000D ${ISSUE_LABEL[cfg.issue]} default BREX and adds no rules of its own.`);
  }
  return { created, notes };
}
