// =============================================================================
// DML and DDN generation.
//
//   DML  (data management list) - generated from the publication module or from selected data modules: one <dmlEntry> per module
//        (and one for the publication module itself). Entry and list attributes use only values the schema enumerates.
//   DDN  (data dispatch note)    - generated for a delivery package: sender and receiver come from the Administrator's enterprise
//        lists (RPC / originator CAGE codes) or a controlled free entry (a 5-character upper-case/digit code, as the schema's
//        senderIdent/receiverIdent patterns require); the delivery list names every dispatched file.
//
// Both are built per issue from the bundled schemas (4.2 / 5.0 / 6.0 have a DDN schema; 7.0 does not - a DDN for a 7.0 project is
// refused, never invented). They are validated against the schema before they are returned.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { nowIso } from '../config';
import { projectDirFor } from '../context';
import { bad } from './http';
import { listDms, csdbDir, type DmSummary } from './csdb';
import { pmPath, publicationSources } from './pm';
import { getConfig } from './projectConfig';
import { hasSchema } from './registry';
import { listItems } from './adminConfig';
import { readProjectJson } from './projects';
import { ISSUE_LABEL, type IssueKey } from './s1000dRef';
import { expectedFileName, listObjects } from './csdbObjects';
import { escAttr as esc } from '../lib/xml';

const { validateDocument } = require('../../vendor/engine/validateSchema');

const SCHEMA_URL = (issue: IssueKey, schema: string) => `http://www.s1000d.org/S1000D_${issue}/xml_schema_flat/${schema}.xsd`;
const NS = 'xmlns:dc="http://www.purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"';
const CAGE_RE = /^[A-Z0-9]{5}$/;
const pad = (n: number, w: number) => String(n).padStart(w, '0');
const ymd = (d = new Date()) => ({ year: String(d.getFullYear()), month: pad(d.getMonth() + 1, 2), day: pad(d.getDate(), 2) });

export interface Party { code: string; name: string; address?: { city: string; country: string } }

/** An enterprise for DDN: a registered one (by code) or a free entry whose code has the schema's shape. */
export function resolveParty(code: string, free?: { name?: string; city?: string; country?: string }, known: Array<{ code: string; name: string }> = []): Party {
  const c = String(code ?? '').trim().toUpperCase();
  if (!CAGE_RE.test(c)) throw bad(`Enterprise code “${code}” must be exactly 5 upper-case letters or digits.`, 'BAD_ENTERPRISE_CODE');
  const reg = [...(listItems('rpc-cages') as any[]), ...(listItems('originator-cages') as any[])].find((r) => String(r.cage).toUpperCase() === c);
  const own = known.find((k) => k.code.toUpperCase() === c && k.name);
  if (!reg && own) return { code: c, name: own.name, address: free?.city ? { city: free.city, country: free.country ?? '' } : undefined };
  if (reg) return { code: c, name: reg.name || c, address: free?.city ? { city: free.city, country: free.country ?? '' } : undefined };
  if (!free?.name) throw bad(`Enterprise code ${c} is not in the Administrator's lists. Register it, or give a name for a free entry.`, 'UNREGISTERED_ENTERPRISE');
  return { code: c, name: free.name.trim(), address: { city: free.city?.trim() || '-', country: free.country?.trim() || '-' } };
}

const dmRefXml = (d: DmSummary) => {
  const a = d.dmCodeAttrs; const i = d.issueInfoAttrs; const l = d.languageAttrs;
  const code = ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'].map((k) => `${k}="${esc(a[k] ?? '')}"`).join(' ');
  const ext = d.identExtension?.extensionProducer ? `<identExtension extensionProducer="${esc(d.identExtension.extensionProducer)}" extensionCode="${esc(d.identExtension.extensionCode ?? '')}"/>` : '';
  return `<dmRef><dmRefIdent>${ext}<dmCode ${code}/><issueInfo issueNumber="${esc(i.issueNumber ?? '')}" inWork="${esc(i.inWork ?? '')}"/><language languageIsoCode="${esc(l.languageIsoCode ?? '')}" countryIsoCode="${esc(l.countryIsoCode ?? '')}"/></dmRefIdent></dmRef>`;
};

function brexRefOf(projectId: string, dms: DmSummary[]): string {
  const dir = csdbDir(projectId);
  for (const d of dms) {
    const m = /<brexDmRef>[\s\S]*?<\/brexDmRef>/.exec(fs.readFileSync(path.join(dir, d.file), 'utf8').slice(0, 40000));
    if (m) return m[0];
  }
  throw bad('No data module in this project names a BREX (brexDmRef), so the list cannot say which BREX applies.', 'NO_BREX_REF');
}

async function assertValid(issue: IssueKey, schemaName: string, file: string, xml: string): Promise<void> {
  const r = await validateDocument(file, xml, { issue: ISSUE_LABEL[issue] });
  if (r.note || !r.schema) throw bad(`${file} could not be schema-checked (${r.note ?? 'schema not installed'}).`, 'NOT_VALIDATED');
  if (r.diagnostics.length) throw bad(`The generated ${schemaName} is not valid against the S1000D ${ISSUE_LABEL[issue]} schema: ${r.diagnostics.slice(0, 3).map((d: any) => `line ${d.line}: ${d.message}`).join(' | ')}`, 'GENERATED_INVALID');
}

export interface DmlOptions { type?: 'c' | 'p' | 's'; senderIdent?: string; seqNumber?: number; issueNumber?: string; inWork?: string; files?: string[]; remarks?: string }

/** Next free sequence number for (model, sender, type, year) among the project's DMLs. */
function nextSeq(projectId: string, mic: string, sender: string, type: string, year: string): number {
  let max = 0;
  for (const o of listObjects(projectId, 'dml')) { const m = new RegExp(`^${mic}-${sender}-${type}-${year}-(\\d{5})_`, 'i').exec(o.control); if (m) max = Math.max(max, Number(m[1])); }
  return max + 1;
}

export async function generateDml(projectId: string, o: DmlOptions = {}): Promise<{ file: string; xml: string; entries: number }> {
  const cfg = getConfig(projectId);
  if (!cfg.issue) throw bad('This project has no single S1000D issue, so a list cannot be generated for it.', 'NO_ISSUE');
  if (!hasSchema(cfg.issue, 'dml')) throw bad(`No DML schema is installed for S1000D ${ISSUE_LABEL[cfg.issue]}.`, 'NO_SCHEMA');
  if (!cfg.mic) throw bad('The project has no model identification code yet.', 'NO_MIC');
  const all = listDms(projectId);
  let dms: DmSummary[];
  if (o.files?.length) {
    const want = new Set(o.files.map((f) => f.toLowerCase()));
    dms = all.filter((d) => want.has(d.file.toLowerCase()));
    const missing = o.files.filter((f) => !dms.some((d) => d.file.toLowerCase() === f.toLowerCase()));
    if (missing.length) throw bad(`Not in this project: ${missing.join(', ')}.`, 'UNKNOWN_FILE');
  } else {
    const inPub = new Set(publicationSources(projectId).map((p) => p.split('/').pop()!.toLowerCase()));
    dms = all.filter((d) => inPub.has(d.file.toLowerCase()));
    if (!dms.length) dms = all;                                       // no publication module yet: list everything
  }
  if (!dms.length) throw bad('There are no data modules to list.', 'NOTHING_TO_LIST');
  const sender = resolveParty(o.senderIdent || cfg.responsiblePartner.code || '', undefined, [cfg.responsiblePartner, cfg.originator]).code;
  const type = o.type ?? 'p'; const { year, month, day } = ymd();
  const seq = o.seqNumber ?? nextSeq(projectId, cfg.mic, sender, type, year);
  const issueNumber = o.issueNumber ?? '001'; const inWork = o.inWork ?? '00';
  const rpc = cfg.responsiblePartner;
  const entry = (d: DmSummary) => `<dmlEntry dmlEntryType="n" issueType="new">${dmRefXml(d)}<security securityClassification="${esc(d.security || cfg.security || '01')}"/><responsiblePartnerCompany enterpriseCode="${esc(rpc.code)}"${rpc.name ? '' : '/'}>${rpc.name ? `<enterpriseName>${esc(rpc.name)}</enterpriseName></responsiblePartnerCompany>` : ''}</dmlEntry>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<dml ${NS} xsi:noNamespaceSchemaLocation="${SCHEMA_URL(cfg.issue, 'dml')}"><identAndStatusSection><dmlAddress><dmlIdent><dmlCode modelIdentCode="${esc(cfg.mic)}" senderIdent="${sender}" dmlType="${type}" yearOfDataIssue="${year}" seqNumber="${pad(seq, 5)}"/><issueInfo issueNumber="${issueNumber}" inWork="${inWork}"/></dmlIdent><dmlAddressItems><issueDate year="${year}" month="${month}" day="${day}"/></dmlAddressItems></dmlAddress><dmlStatus><security securityClassification="${esc(cfg.security || '01')}"/>${brexRefOf(projectId, dms)}${o.remarks ? `<remarks><simplePara>${esc(o.remarks)}</simplePara></remarks>` : ''}</dmlStatus></identAndStatusSection><dmlContent>${dms.map(entry).join('')}</dmlContent></dml>\n`;
  const file = expectedFileName('dml', xml);
  await assertValid(cfg.issue, 'DML', file, xml);
  return { file, xml, entries: dms.length };
}

export interface DeliveryItem { file: string; control: string; issueNumber?: string; inWork?: string }
export interface DdnOptions { /** <authorization> is a required text element; when none is given the sender's enterprise name is used (and the package notes say so). */ authorization?: string; sender: Party; receiver: Party; items: DeliveryItem[]; mediaLabel?: string; remarks?: string; seqNumber?: number }

/** DDN: the delivery list names each dispatched file with its control number (S1000D 4.2 Chap 7.5.1 para 2.3.1). */
export async function generateDdn(projectId: string, o: DdnOptions): Promise<{ file: string; xml: string }> {
  const cfg = getConfig(projectId);
  if (!cfg.issue) throw bad('This project has no single S1000D issue.', 'NO_ISSUE');
  if (!hasSchema(cfg.issue, 'ddn')) throw bad(`S1000D ${ISSUE_LABEL[cfg.issue]}: no DDN schema is bundled, so no data dispatch note can be produced (the package is delivered with its manifest only).`, 'NO_DDN_SCHEMA');
  if (!cfg.mic) throw bad('The project has no model identification code yet.', 'NO_MIC');
  const { year, month, day } = ymd();
  let max = 0; for (const x of listObjects(projectId, 'ddn')) { const m = new RegExp(`^${cfg.mic}-${o.sender.code}-${o.receiver.code}-${year}-(\\d{5})$`, 'i').exec(x.control); if (m) max = Math.max(max, Number(m[1])); }
  const seq = o.seqNumber ?? max + 1;
  const addr = (p: Party) => `<dispatchAddress><enterprise><enterpriseName>${esc(p.name)}</enterpriseName></enterprise><address><city>${esc(p.address?.city || '-')}</city><country>${esc(p.address?.country || '-')}</country></address></dispatchAddress>`;
  const dms = listDms(projectId);
  const brexRef = dms.length ? brexRefOf(projectId, dms) : '';
  if (!brexRef) throw bad('No data module names a BREX, so the dispatch note cannot say which BREX applies.', 'NO_BREX_REF');
  const item = (i: DeliveryItem) => `<deliveryListItem><dispatchFileName>${esc(i.file)}</dispatchFileName><entityControlNumber>${esc(i.control)}</entityControlNumber>${i.issueNumber ? `<issueInfo issueNumber="${esc(i.issueNumber)}" inWork="${esc(i.inWork ?? '00')}"/>` : ''}</deliveryListItem>`;
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<ddn ${NS} xsi:noNamespaceSchemaLocation="${SCHEMA_URL(cfg.issue, 'ddn')}"><identAndStatusSection><ddnAddress><ddnIdent><ddnCode modelIdentCode="${esc(cfg.mic)}" senderIdent="${o.sender.code}" receiverIdent="${o.receiver.code}" yearOfDataIssue="${year}" seqNumber="${pad(seq, 5)}"/></ddnIdent><ddnAddressItems><issueDate year="${year}" month="${month}" day="${day}"/><dispatchTo>${addr(o.receiver)}</dispatchTo><dispatchFrom>${addr(o.sender)}</dispatchFrom></ddnAddressItems></ddnAddress><ddnStatus><security securityClassification="${esc(cfg.security || '01')}"/><authorization>${esc(o.authorization || o.sender.name)}</authorization>${brexRef}${o.remarks ? `<remarks><simplePara>${esc(o.remarks)}</simplePara></remarks>` : ''}</ddnStatus></identAndStatusSection><ddnContent><mediaIdent label="${esc(o.mediaLabel || 'ZIP')}"/><deliveryList>${o.items.map(item).join('')}</deliveryList></ddnContent></ddn>\n`;
  const file = expectedFileName('ddn', xml);
  await assertValid(cfg.issue, 'DDN', file, xml);
  return { file, xml };
}

