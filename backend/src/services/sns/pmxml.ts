// =============================================================================
// A derived structure as a publication module (S1000D 4.2 <pm>).
//
// The entries (nested <pmEntry>, <dmRef> per module) are written by the vendored pmc module - the one writer every
// publication in the platform goes through, which is tested to read back identically. What pmc.serialisePm does NOT
// write is a header the Issue 4.2 schema accepts (no <applic>, no <brexDmRef>: its output fails pm.xsd), so this file
// writes its own header around pmc's entries, and can instead keep an existing publication's header verbatim and replace only
// its <content> (`spliceContent`) - which is what applying a derived structure to a project that already has a PM does.
// =============================================================================

import { vendor } from '../../config';
import type { StructDm, StructModule, Structure } from './derive';
import { escAttr as esc } from '../../lib/xml';

export interface PmEntryOut {
  type: 'folder' | 'dm';
  title?: string;
  children?: PmEntryOut[];
  dmCode?: Record<string, string>;
  identExtension?: Record<string, string>;
  issueInfo?: Record<string, string>;
  language?: Record<string, string>;
  techName?: string;
  infoName?: string;
  issueDate?: Record<string, string>;
}

export interface TitleOptions {
  /** 'title' (default): the SNS title. 'code-title': "A05 - System Maintenance". */
  titleFormat?: 'title' | 'code-title';
}

const entryTitle = (m: StructModule, o: TitleOptions): string => {
  const t = m.title || m.code || '(untitled)';
  return o.titleFormat === 'code-title' && m.code && m.level !== 'unclassified' ? `${m.code} - ${t}` : t;
};

/** The structure as publication-module entries (what `pm.writePm` and `pmc.serialisePm` take). */
export function structureToPmEntries(s: Structure, o: TitleOptions = {}): PmEntryOut[] {
  const dm = (d: StructDm): PmEntryOut => ({
    type: 'dm', dmCode: d.dmCode, identExtension: d.identExtension, issueInfo: d.issueInfo, language: d.language,
    techName: d.techName, infoName: d.infoName, issueDate: d.issueDate,
  });
  const walk = (m: StructModule): PmEntryOut => ({ type: 'folder', title: entryTitle(m, o), children: m.children.map((c) => (c.kind === 'dm' ? dm(c) : walk(c))) });
  return s.roots.map(walk);
}

const attrs = (o: Record<string, string>, keys: string[]): string => keys.filter((k) => o[k] !== undefined && o[k] !== '').map((k) => ` ${k}="${esc(o[k])}"`).join('');

/** <content>'s inner XML, written by the vendored pmc module. */
export function pmContentXml(entries: PmEntryOut[]): string {
  if (!entries.length) return '';                                  // the writer emits no <content> block for nothing
  const full: string = vendor('engine/pmc').serialisePm({ meta: {}, entries });
  const m = /\n {2}<content>\n([\s\S]*?)\n {2}<\/content>/.exec(full);
  if (!m) throw new Error('The publication writer produced no <content> block.');
  return m[1];
}

export interface PmMeta {
  modelIdentCode: string;
  pmIssuer: string;
  pmNumber: string;
  pmVolume: string;
  language: { languageIsoCode: string; countryIsoCode: string };
  issueInfo: { issueNumber: string; inWork: string };
  issueDate: { year: string; month: string; day: string };
  pmTitle: string;
  shortPmTitle?: string;
  securityClassification: string;
  rpc: { enterpriseCode: string; enterpriseName: string };
  originator?: { enterpriseCode: string; enterpriseName: string };
  /** dmCode attributes of the BREX this publication cites. Default: the bundled S1000D 4.2 default BREX. */
  brex?: Record<string, string>;
}

/** The bundled official default BREX of Issue 4.2 (backend/brex/DMC-S1000D-F-04-10-0301-00A-022A-D). */
export const DEFAULT_BREX_42: Record<string, string> = {
  modelIdentCode: 'S1000D', systemDiffCode: 'F', systemCode: '04', subSystemCode: '1', subSubSystemCode: '0', assyCode: '0301',
  disassyCode: '00', disassyCodeVariant: 'A', infoCode: '022', infoCodeVariant: 'A', itemLocationCode: 'D',
};

const DM_CODE_ORDER = ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'];

/** Sensible header values for a publication that has none; `title` is the book title. */
export function defaultPmMeta(title: string, over: Partial<PmMeta> = {}, now: Date = new Date()): PmMeta {
  return {
    modelIdentCode: 'MODEL', pmIssuer: '00000', pmNumber: '00001', pmVolume: '00',
    language: { languageIsoCode: 'en', countryIsoCode: 'IN' }, issueInfo: { issueNumber: '001', inWork: '00' },
    issueDate: { year: String(now.getFullYear()), month: String(now.getMonth() + 1).padStart(2, '0'), day: String(now.getDate()).padStart(2, '0') },
    pmTitle: title, securityClassification: '01', rpc: { enterpriseCode: '00000', enterpriseName: 'Unspecified' },
    ...over,
  };
}

/** A complete Issue 4.2 publication module around `entries`. */
export function buildPmXml(entries: PmEntryOut[], meta: PmMeta): string {
  const org = (tag: string, o: { enterpriseCode: string; enterpriseName: string }) =>
    `      <${tag} enterpriseCode="${esc(o.enterpriseCode)}">\n        <enterpriseName>${esc(o.enterpriseName)}</enterpriseName>\n      </${tag}>`;
  const brex = meta.brex ?? DEFAULT_BREX_42;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/pm.xsd">',
    '  <identAndStatusSection>',
    '    <pmAddress>',
    '      <pmIdent>',
    `        <pmCode modelIdentCode="${esc(meta.modelIdentCode)}" pmIssuer="${esc(meta.pmIssuer)}" pmNumber="${esc(meta.pmNumber)}" pmVolume="${esc(meta.pmVolume)}"/>`,
    `        <language languageIsoCode="${esc(meta.language.languageIsoCode)}" countryIsoCode="${esc(meta.language.countryIsoCode)}"/>`,
    `        <issueInfo issueNumber="${esc(meta.issueInfo.issueNumber)}" inWork="${esc(meta.issueInfo.inWork)}"/>`,
    '      </pmIdent>',
    '      <pmAddressItems>',
    `        <issueDate year="${esc(meta.issueDate.year)}" month="${esc(meta.issueDate.month)}" day="${esc(meta.issueDate.day)}"/>`,
    `        <pmTitle>${esc(meta.pmTitle)}</pmTitle>`,
    ...(meta.shortPmTitle ? [`        <shortPmTitle>${esc(meta.shortPmTitle)}</shortPmTitle>`] : []),
    '      </pmAddressItems>',
    '    </pmAddress>',
    '    <pmStatus>',
    `      <security securityClassification="${esc(meta.securityClassification)}"/>`,
    org('responsiblePartnerCompany', meta.rpc),
    org('originator', meta.originator ?? meta.rpc),
    '      <applic>',
    '        <displayText>',
    '          <simplePara>All</simplePara>',
    '        </displayText>',
    '      </applic>',
    '      <brexDmRef>',
    '        <dmRef>',
    '          <dmRefIdent>',
    `            <dmCode${attrs(brex, DM_CODE_ORDER)}/>`,
    '          </dmRefIdent>',
    '        </dmRef>',
    '      </brexDmRef>',
    '      <qualityAssurance>',
    '        <unverified/>',
    '      </qualityAssurance>',
    '    </pmStatus>',
    '  </identAndStatusSection>',
    '  <content>',
    pmContentXml(entries),
    '  </content>',
    '</pm>',
    '',
  ].join('\n');
}

/**
 * `existingXml` with its <content> replaced by `entries`: the header (security, restrictions, BREX reference, comments)
 * stays exactly as the author left it. null when the text has no <content> block to replace.
 */
export function spliceContent(existingXml: string, entries: PmEntryOut[]): string | null {
  const re = /(<content\b[^>]*>)[\s\S]*(<\/content>)/;
  if (!re.test(existingXml)) return null;
  const body = pmContentXml(entries);
  return existingXml.replace(re, (_m, open: string, close: string) => `${open}\n${body}\n  ${close}`);
}
