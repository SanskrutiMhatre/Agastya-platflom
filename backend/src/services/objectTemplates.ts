// =============================================================================
// Templates for the CSDB objects an author creates by hand: Comment (COM), Data update file (UPF), ICN metadata (IMF).
// (DML and DDN are generated - services/dispatch.ts; the SCORM content package is imported, not authored.)
//
// Each template is built per issue from the bundled schema, takes its identification from the project (model identification code, responsible partner
// company, language, default BREX) and is VALIDATED against the schema before it is returned, so a template that does not fit an issue fails loudly
// instead of producing an invalid file. Issue 7.0 has no Comment / Update schema (kept MISSING): asking for one is an error.
// =============================================================================

import { bad } from './http';
import { getConfig, DEFAULT_COUNTRY, DEFAULT_LANGUAGE } from './projectConfig';
import { hasSchema } from './registry';
import { ISSUE_LABEL, type IssueKey } from './s1000dRef';
import { expectedFileName, type ObjectKind } from './csdbObjects';
import { listDms, csdbDir } from './csdb';
import fs from 'fs';
import path from 'path';
import { escAttr as esc } from '../lib/xml';

const { validateDocument } = require('../../vendor/engine/validateSchema');
const NS = 'xmlns:dc="http://www.purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const ymd = () => { const d = new Date(); return { year: String(d.getFullYear()), month: pad(d.getMonth() + 1, 2), day: pad(d.getDate(), 2) }; };

export interface ObjectParams { title?: string; text?: string; commentType?: 'q' | 'i' | 'r'; priority?: string; senderIdent?: string; seqNumber?: number; refDm?: string; icn?: string; icnTitle?: string; partNumber?: string; manufacturer?: string }

function brexRef(projectId: string): string {
  const dir = csdbDir(projectId);
  for (const d of listDms(projectId)) { const m = /<brexDmRef>[\s\S]*?<\/brexDmRef>/.exec(fs.readFileSync(path.join(dir, d.file), 'utf8').slice(0, 40000)); if (m) return m[0]; }
  throw bad('No data module in this project names a BREX, so the new file cannot say which BREX applies.', 'NO_BREX_REF');
}
const dmRefOf = (projectId: string, file: string): string => {
  const d = listDms(projectId).find((x) => x.file.toLowerCase() === file.toLowerCase()); if (!d) throw bad(`${file} is not a data module of this project.`, 'UNKNOWN_FILE');
  const a = d.dmCodeAttrs; const code = ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'].map((k) => `${k}="${esc(a[k] ?? '')}"`).join(' ');
  return `<dmRef><dmRefIdent><dmCode ${code}/></dmRefIdent></dmRef>`;
};

export async function buildObject(projectId: string, kind: ObjectKind, p: ObjectParams = {}): Promise<{ file: string; xml: string }> {
  const cfg = getConfig(projectId);
  if (!cfg.issue) throw bad('This project has no single S1000D issue.', 'NO_ISSUE');
  const issue: IssueKey = cfg.issue; const schemaName = { comment: 'comment', update: 'update', imf: 'icnmetadata', dml: 'dml', ddn: 'ddn', scorm: 'scormcontentpackage' }[kind];
  if (!hasSchema(issue, schemaName)) throw bad(`S1000D ${ISSUE_LABEL[issue]}: no ${schemaName} schema is bundled, so this document cannot be created (not invented).`, 'NO_SCHEMA');
  if (kind !== 'comment' && kind !== 'update' && kind !== 'imf') throw bad(kind === 'scorm' ? 'SCORM content packages are imported, not authored.' : `${kind.toUpperCase()} files are generated, not authored (use the generate action).`, 'NOT_AUTHORED');
  if (!cfg.mic) throw bad('The project has no model identification code yet.', 'NO_MIC');
  const url = `http://www.s1000d.org/S1000D_${issue}/xml_schema_flat/${schemaName}.xsd`; const { year, month, day } = ymd();
  const lang = DEFAULT_LANGUAGE.toLowerCase(); const ctry = (cfg.country || DEFAULT_COUNTRY).toUpperCase(); const language = `<language languageIsoCode="${esc(cfg.language || lang)}" countryIsoCode="${esc(ctry)}"/>`;
  const rpc = cfg.responsiblePartner; const orig = cfg.originator.code ? cfg.originator : rpc; const sec = esc(cfg.security || '01');
  const enterprises = `<responsiblePartnerCompany enterpriseCode="${esc(rpc.code)}">${rpc.name ? `<enterpriseName>${esc(rpc.name)}</enterpriseName>` : ''}</responsiblePartnerCompany><originator enterpriseCode="${esc(orig.code)}">${orig.name ? `<enterpriseName>${esc(orig.name)}</enterpriseName>` : ''}</originator>`;
  const brex = brexRef(projectId); const qa = '<qualityAssurance><unverified/></qualityAssurance>';
  let xml: string;
  if (kind === 'comment') {
    const sender = (p.senderIdent || rpc.code || '').toUpperCase(); if (!/^[A-Z0-9]{5}$/.test(sender)) throw bad('The comment needs a 5-character originator code.', 'BAD_ENTERPRISE_CODE');
    const t = p.commentType ?? 'q'; if (!['q', 'i', 'r'].includes(t)) throw bad('commentType must be q, i or r.', 'BAD_TYPE');
    const ref = p.refDm ? dmRefOf(projectId, p.refDm) : (() => { const d = listDms(projectId)[0]; if (!d) throw bad('Name the data module the comment is about (refDm).', 'REF_REQUIRED'); return dmRefOf(projectId, d.file); })();
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<comment ${NS} xsi:noNamespaceSchemaLocation="${url}"><identAndStatusSection><commentAddress><commentIdent><commentCode modelIdentCode="${esc(cfg.mic)}" senderIdent="${sender}" yearOfDataIssue="${year}" seqNumber="${pad(p.seqNumber ?? 1, 5)}" commentType="${t}"/>${language}</commentIdent><commentAddressItems><commentTitle>${esc(p.title || 'Comment')}</commentTitle><issueDate year="${year}" month="${month}" day="${day}"/><commentOriginator><dispatchAddress><enterprise><enterpriseName>${esc(orig.name || orig.code)}</enterpriseName></enterprise><address><city>-</city><country>-</country></address></dispatchAddress></commentOriginator></commentAddressItems></commentAddress><commentStatus><security securityClassification="${sec}"/><commentPriority commentPriorityCode="${esc(p.priority || 'cp01')}"/><commentRefs><dmRefGroup>${ref}</dmRefGroup></commentRefs>${brex}</commentStatus></identAndStatusSection><commentContent><simplePara>${esc(p.text || 'Type the comment here.')}</simplePara></commentContent></comment>`;
  } else if (kind === 'update') {
    const src = p.refDm ? dmRefOf(projectId, p.refDm).replace(/<\/?dmRef>/g, '').replace(/<\/?dmRefIdent>/g, '') : null; if (!src) throw bad('Name the repository data module this update changes (refDm).', 'REF_REQUIRED');
    const code = /<dmCode[^>]*\/>/.exec(src)![0];
    const d = listDms(projectId).find((x) => x.file.toLowerCase() === p.refDm!.toLowerCase())!; const a = d.dmCodeAttrs;
    const upd = `modelIdentCode="${esc(a.modelIdentCode)}" systemDiffCode="${esc(a.systemDiffCode)}" systemCode="${esc(a.systemCode)}" subSystemCode="${esc(a.subSystemCode)}" subSubSystemCode="${esc(a.subSubSystemCode)}" assyCode="${esc(a.assyCode)}" disassyCode="${esc(a.disassyCode)}" disassyCodeVariant="${esc(a.disassyCodeVariant)}" infoCode="${esc(a.infoCode)}" infoCodeVariant="${esc(a.infoCodeVariant)}" itemLocationCode="${esc(a.itemLocationCode)}"`;
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<dataUpdateFile ${NS} xsi:noNamespaceSchemaLocation="${url}"><updateIdentAndStatusSection><updateAddress><updateIdent><updateCode objectIdentCode="UPF" ${upd}/>${language}<issueInfo issueNumber="001" inWork="00"/></updateIdent><issueDate year="${year}" month="${month}" day="${day}"/></updateAddress><updateStatus><sourceDmIdent>${code}${language}<issueInfo issueNumber="${esc(d.issueNumber)}" inWork="${esc(d.inWork)}"/></sourceDmIdent><targetDmIssueInfo issueNumber="${esc(d.issueNumber)}" inWork="${esc(d.inWork)}"/>${enterprises}${brex}${qa}</updateStatus><targetDmStatus><security securityClassification="${sec}"/>${enterprises}<applic><displayText><simplePara>All</simplePara></displayText></applic>${brex}${qa}</targetDmStatus></updateIdentAndStatusSection><content><update><deleteObjectGroup><deleteObject><partIdent manufacturerCodeValue="${esc(p.manufacturer || '00000')}" partNumberValue="${esc(p.partNumber || 'PART-NUMBER')}"/></deleteObject></deleteObjectGroup></update></content></dataUpdateFile>`;
  } else {
    const icn = String(p.icn ?? '').trim(); if (!/^ICN-[A-Z0-9-]+-\d{3}-\d{2}$/i.test(icn)) throw bad('Give the ICN this file describes (ICN-…-<issue>-<security>).', 'BAD_ICN');
    xml = `<?xml version="1.0" encoding="UTF-8"?>\n<icnMetadataFile ${NS} xsi:noNamespaceSchemaLocation="${url}"><imfIdentAndStatusSection><imfAddress><imfIdent><imfCode imfIdentIcn="${esc(icn.toUpperCase())}"/><issueInfo issueNumber="001" inWork="00"/></imfIdent><imfAddressItems><icnTitle>${esc(p.icnTitle || p.title || icn)}</icnTitle></imfAddressItems></imfAddress><imfStatus><security securityClassification="${sec}"/>${enterprises}${brex}${qa}</imfStatus></imfIdentAndStatusSection></icnMetadataFile>`;
  }
  const file = expectedFileName(kind, xml);
  const r = await validateDocument(file, xml, { issue: ISSUE_LABEL[issue] });
  if (r.note || !r.schema) throw bad(`${file} could not be schema-checked (${r.note ?? 'schema not installed'}).`, 'NOT_VALIDATED');
  if (r.diagnostics.length) throw bad(`The template is not valid against S1000D ${ISSUE_LABEL[issue]}: ${r.diagnostics.slice(0, 3).map((d: any) => `line ${d.line}: ${d.message}`).join(' | ')}`, 'TEMPLATE_INVALID');
  return { file, xml };
}
