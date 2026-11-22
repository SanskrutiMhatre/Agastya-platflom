// =============================================================================
// Identity of data modules and publication modules, read from text.
//
// This mirrors services/csdb.parseIdent on purpose (same `dmc`, same `language` form) but lives apart from
// it: csdb pulls in the whole server context (database, workspace directory), and a scanner that creates a
// workspace as a side effect is not a scanner. The HTTP test checks that both agree on the modules it imports.
// =============================================================================

import { vendor } from '../../config';
import { headOf } from '../xmlHead';
import { parseAttrs, decodeText, rootTag } from './xmlScan';
import type { DmIdent, PmEntry, PmModel } from './types';

const ws = (s: string): string => decodeText(s).replace(/\s+/g, ' ').trim();

export function dmcFromAttrs(a: Record<string, string>): string {
  const g = (k: string) => a[k] ?? '';
  return [g('modelIdentCode'), g('systemDiffCode'), g('systemCode'), `${g('subSystemCode')}${g('subSubSystemCode')}`, g('assyCode'),
    `${g('disassyCode')}${g('disassyCodeVariant')}`, `${g('infoCode')}${g('infoCodeVariant')}`, g('itemLocationCode')].join('-');
}

/** Identity used to match a dmRef to a file: the code, plus the extension producer when there is one (as resolveDmRefs does). */
export function dmKey(code: Record<string, string>, ext?: Record<string, string>): string {
  const base = dmcFromAttrs(code);
  return ext && (ext.extensionProducer || ext.extensionCode) ? `${ext.extensionProducer ?? ''}-${ext.extensionCode ?? ''}-${base}` : base;
}

/** `RDR-A-A00-00-00-02A-001A-D` -> dmCode attributes. Null when the string is not a data module code. */
export function parseDmcString(s: string): Record<string, string> | null {
  const m = /^([A-Z0-9]{2,14})-([A-Z0-9]{1,4})-([A-Z0-9]{2,3})-([A-Z0-9])([A-Z0-9])-([A-Z0-9]{2,4})-([A-Z0-9]{2})([A-Z0-9]{1,3})-([A-Z0-9]{3})([A-Z0-9])-([A-Z0-9])$/i.exec(s.trim());
  if (!m) return null;
  return {
    modelIdentCode: m[1], systemDiffCode: m[2], systemCode: m[3], subSystemCode: m[4], subSubSystemCode: m[5], assyCode: m[6],
    disassyCode: m[7], disassyCodeVariant: m[8], infoCode: m[9], infoCodeVariant: m[10], itemLocationCode: m[11],
  };
}

/** The same shape, to search free text (a PDF line) for a data module code. */
export const DMC_IN_TEXT = /(?<![A-Z0-9-])[A-Z0-9]{2,14}-[A-Z0-9]{1,4}-[A-Z0-9]{2,3}-[A-Z0-9]{2}-[A-Z0-9]{2,4}-[A-Z0-9]{3,4}-[A-Z0-9]{3,4}-[A-Z0-9](?![A-Z0-9-])/g;

const ISSUE_OF_SCHEMA = (loc: string): string => {
  const m = /S1000D[_-]?(\d+)(?:[-._](\d+))?\//i.exec(loc);
  if (!m) return '';
  return m[2] === undefined ? m[1] : `${m[1]}.${m[2]}`;
};

/** The S1000D issue a document's root element declares through its schema location (`4.2`), or ''. Works for modules and publication modules. */
export function schemaIssueOf(text: string): string {
  const root = rootTag(text);
  const loc = root ? parseAttrs(root.rawAttrs)['xsi:noNamespaceSchemaLocation'] : undefined;
  return loc ? ISSUE_OF_SCHEMA(loc) : '';
}

/** A `<dmodule>`'s identity. Everything is optional in broken input; a missing part comes back as ''. */
export function parseDmIdent(text: string): DmIdent {
  const head = headOf(text, 'dmodule', 20000);
  const scope = (/<dmIdent>([\s\S]*?)<\/dmIdent>/.exec(head) ?? [null, head])[1] as string;
  const attrsOf = (re: RegExp, s: string): Record<string, string> => { const m = re.exec(s); return m ? parseAttrs(m[1]) : {}; };
  const code = attrsOf(/<dmCode\b([^>]*)\/?>/, scope);
  const ext = /<identExtension\b([^>]*)\/?>/.exec(scope);
  const issue = attrsOf(/<issueInfo\b([^>]*)\/?>/, scope);
  const lang = attrsOf(/<language\b([^>]*)\/?>/, scope);
  const tech = /<techName>([\s\S]*?)<\/techName>/.exec(head);
  const info = /<infoName>([\s\S]*?)<\/infoName>/.exec(head);
  const sec = attrsOf(/<security\b([^>]*)\/?>/, head);
  const loc = /noNamespaceSchemaLocation\s*=\s*"([^"]+)"/.exec(head);
  const date = attrsOf(/<issueDate\b([^>]*)\/?>/, head);
  const orig = /<originator\b([^>]*)\/?>/.exec(head);
  const rpc = /<responsiblePartnerCompany\b([^>]*)\/?>/.exec(head);
  const brexRef = /<brexDmRef>[\s\S]*?<\/brexDmRef>/.exec(head);
  const brexCode = brexRef ? attrsOf(/<dmCode\b([^>]*)\/?>/, brexRef[0]) : {};
  const content = /<content\b[^>]*>([\s\S]*)<\/content>/.exec(text);
  // "Empty": the content element holds a single childless child (`<description />`), as a heading-only divider does.
  const emptyContent = !!content && /^\s*<[A-Za-z][\w:-]*\s*\/>\s*$|^\s*<([A-Za-z][\w:-]*)>\s*<\/\1>\s*$/.test(content[1]);
  const lang2 = lang.languageIsoCode ? `${lang.languageIsoCode}-${(lang.countryIsoCode ?? '').toUpperCase()}` : '';
  return {
    dmCodeAttrs: code,
    identExtension: ext ? parseAttrs(ext[1]) : undefined,
    dmc: code.modelIdentCode ? dmcFromAttrs(code) : '',
    infoCode: code.infoCode ?? '',
    issueNumber: issue.issueNumber ?? '', inWork: issue.inWork ?? '',
    language: lang2, languageIsoCode: lang.languageIsoCode ?? '', countryIsoCode: (lang.countryIsoCode ?? '').toUpperCase(),
    techName: tech ? ws(tech[1]) : '', infoName: info ? ws(info[1]) : '',
    schema: loc ? (loc[1].split('/').pop() ?? '').replace(/\.xsd$/i, '') : '',
    issue: loc ? ISSUE_OF_SCHEMA(loc[1]) : '',
    security: sec.securityClassification ?? '',
    issueDate: date.year ? { year: date.year, month: date.month ?? '', day: date.day ?? '' } : undefined,
    originatorCode: orig ? parseAttrs(orig[1]).enterpriseCode : undefined,
    rpcCode: rpc ? parseAttrs(rpc[1]).enterpriseCode : undefined,
    brexDmc: brexCode.modelIdentCode ? dmcFromAttrs(brexCode) : undefined,
    emptyContent,
  };
}

/** Every `<pmCode ...>` quoted in the BODY of a module (a title page prints its publication's code). */
export function pmCodesInBody(text: string): Array<Record<string, string>> {
  const out: Array<Record<string, string>> = [];
  const content = /<content\b/.exec(text);
  const body = content ? text.slice(content.index) : text;
  const re = /<pmCode\b([^>]*)\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) out.push(parseAttrs(m[1]));
  return out;
}

// ── publication modules ─────────────────────────────────────────────────────

const pmcEngine = (): { parsePm(xml: string): PmModel & { warnings: string[] }; serialisePm(m: PmModel): string; countEntries(e: unknown[]): { folders: number; dms: number; total: number } } => vendor('engine/pmc');

export function parsePmText(text: string): PmModel & { warnings: string[] } { return pmcEngine().parsePm(text); }
export function serialisePm(model: PmModel): string { return pmcEngine().serialisePm(model); }

/** A PM header that was never filled in: the plugin's template defaults, not an identity. */
export function isPlaceholderPmCode(code: Record<string, string> | undefined): boolean {
  if (!code) return true;
  return !code.modelIdentCode || code.modelIdentCode.toUpperCase() === 'MODEL' || code.pmIssuer === '00000' || !code.pmIssuer;
}

/** Walk every entry of a PM tree, parents first. */
export function walkEntries(entries: PmEntry[], visit: (e: PmEntry, path: number[], parent: PmEntry | null) => void, prefix: number[] = [], parent: PmEntry | null = null): void {
  entries.forEach((e, i) => {
    const p = [...prefix, i];
    visit(e, p, parent);
    if (e.type === 'folder') walkEntries(e.children ?? [], visit, p, e);
  });
}

