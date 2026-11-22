// =============================================================================
// Xignal front-matter data modules  ->  the engine's front-matter settings.
//
//   frontMatterFromDms(dms, pm, options)
//
// Xignal's JSS export expresses the prelim pages as ordinary S1000D 4.2 data modules (reserved information codes, see reserved.ts) and
// takes the book's name, system name, date and classification from the publication module's header. The platform used to ignore
// those modules and print its own front matter from `project.json` settings. This reads them into those settings:
//
//   frontMatter   the project.json `frontMatter` shape (titlePage, proprietary, foreword, safetyWarning, cautionsNotes,
//                 descriptionOfSymbols + noticeLegends, recordOfChanges, associatedHandbooks, firstAid, demolition,
//                 listOfAbbreviations, systemImages, labels, pages, revNo ...). Anything Xignal can say that the engine has no key
//                 for is kept under `frontMatter.xignal` (the engine ignores unknown keys), so that generating the modules again
//                 gives back what was read.
//   publication   the PM-level fields: bookName, systemName, publicationNo (+ inbrNo), nsn, contractNo, month, year, securityClassification
//   branding      publishers (project.json `publishers`) and the emblem (a HOUSE-template setting, offered, never applied per project)
//   consumed      the modules whose content now lives in the settings: hide them from the publishable body
//   report        for every field, what was done with it: mapped / defaulted / ignored / not-understood, and why
//
// What the data says wins over what the brief or the PM comments say; where they differ the report says so. Pure: nothing is
// written, nothing is fetched.
// =============================================================================

import path from 'path';
import { vendor } from '../../config';
import { dmLikeFromXml } from '../sns/dms';
import { attr, collapse, descendants, elems, entityMap, first, inlineOf, linesOf, parseXml, readTable, textOf, type El, type Inline } from './dom';
import { PAGE_DEFS, classifyFrontMatter, pageDef, type PageId } from './reserved';

export interface FmDmInput { file: string; xml: string }

export type MapStatus = 'mapped' | 'defaulted' | 'ignored' | 'not-understood';
export interface MappingEntry { page: PageId | 'pm' | 'engine'; file?: string; field: string; status: MapStatus; detail: string }

export interface Publisher { name: string; addressLines: string[]; logo?: string }

export interface FrontMatterImport {
  frontMatter: Record<string, any>;
  publication: Record<string, string>;
  branding: { publishers?: Publisher[]; emblem?: string };
  /** Identity the modules carry (model, difference code, language, issue, enterprise, BREX), for generating them again. */
  ids: ModuleIds;
  consumed: Array<{ file: string; infoCode: string; page: PageId; via: string }>;
  /** Front-matter-shaped modules that were left alone, and why. */
  notConsumed: Array<{ file: string; infoCode: string; reason: string }>;
  report: MappingEntry[];
  summary: { pages: number; consumed: number; notConsumed: number; mapped: number; defaulted: number; ignored: number; notUnderstood: number };
}

export interface ModuleIds {
  modelIdentCode?: string;
  systemDiffCode?: string;
  languageIsoCode?: string;
  countryIsoCode?: string;
  issueNumber?: string;
  inWork?: string;
  security?: string;
  rpc?: { enterpriseCode: string; enterpriseName: string };
  originator?: { enterpriseCode: string; enterpriseName: string };
  brex?: Record<string, string>;
  issueDate?: { year: string; month: string; day: string };
}

export interface FromDmsOptions {
  /** The project's data module folder, as a project-relative path (default 'csdb'): where ICN files are looked for. */
  csdbDir?: string;
  /** File names available beside the data modules (and in Media/), to find an ICN that has no <!ENTITY> declaration. */
  files?: readonly string[];
}

/** The security labels the engine prints (frontmatterInject.js SECURITY) and back. */
export const SECURITY_LABEL: Record<string, string> = { '01': 'UNCLASSIFIED', '02': 'RESTRICTED', '03': 'CONFIDENTIAL', '04': 'SECRET', '05': 'TOP SECRET' };
export const securityLabelOf = (code: string): string => SECURITY_LABEL[code] ?? code;
export const securityCodeOf = (label: string): string => Object.entries(SECURITY_LABEL).find(([, v]) => v === String(label).toUpperCase())?.[0] ?? label;

/** Default wording of the labels the engine lets a project override (jsstofo/frontmatter.xsl); a label equal to its default is not stored. */
export const LABEL_DEFAULTS: Record<string, string> = {
  'title.for': 'FOR', 'title.publishedBy': 'Prepared & Published by', 'titleJoint.publishedBy': 'Jointly Prepared & Published by:',
  'titleJoint.publicationNo': '<<Publication No>>: ', 'title.inbrNo': 'INBR No.:', 'titleJoint.nsn': 'NSN: ', 'titleJoint.contractNo': 'Contract No.: ',
  'roc.colChangeNotice': 'Change Notice No.', 'roc.colAuthority': 'Authority', 'roc.colIncorporatedBy': 'Incorporated by "Name & Rank" in block letters', 'roc.colInitials': 'Initials with Date',
  'handbooks.colSr': 'Sr. No.', 'handbooks.colTitle': 'Document Title', 'handbooks.colInbr': 'INBR No.',
  'abbrev.colTerm': 'Abbreviations', 'abbrev.colMeaning': 'Description',
  'safety.heading': 'SAFETY WARNING', 'safety.footer': 'FOR FIRST AID IN CASE OF ELECTRIC SHOCK SEE THE FOLLOWING PAGE',
};

const setPath = (o: Record<string, any>, dotted: string, v: unknown): void => {
  const keys = dotted.split('.');
  let cur = o;
  keys.slice(0, -1).forEach((k) => { cur = (cur[k] ??= {}); });
  cur[keys[keys.length - 1]] = v;
};
const sameText = (a: string, b: string): boolean => collapse(a).toLowerCase() === collapse(b).toLowerCase();
const stripNbsp = (s: string): string => s.replace(/ /g, ' ').trim();

/** "Label: value" -> { label: 'Label:', value } (the label keeps its colon). */
export function splitLabelled(text: string): { label: string; value: string } | null {
  const m = /^\s*([^:：]{1,40}?)\s*([:：])\s*(.*)$/.exec(text);
  return m ? { label: `${m[1]}${m[2]}`, value: m[3].trim() } : null;
}

interface Found { file: string; xml: string; infoCode: string; page: PageId; via: string; issue: string; entityFiles: Map<string, string>; root: El }

export function frontMatterFromDms(dmsIn: ReadonlyArray<FmDmInput>, pmIn?: string | { meta?: any; entries?: any[] } | null, options: FromDmsOptions = {}): FrontMatterImport {
  const csdbDir = (options.csdbDir ?? 'csdb').replace(/\\/g, '/').replace(/\/+$/, '');
  const available = (options.files ?? []).map((f) => f);
  const report: MappingEntry[] = [];
  const fm: Record<string, any> = {};
  const pub: Record<string, string> = {};
  const branding: FrontMatterImport['branding'] = {};
  const consumed: FrontMatterImport['consumed'] = [];
  const notConsumed: FrontMatterImport['notConsumed'] = [];
  const add = (page: MappingEntry['page'], field: string, status: MapStatus, detail: string, file?: string) => { report.push({ page, field, status, detail, ...(file ? { file } : {}) }); };

  // ── the publication module: header fields, comments, and where each module is placed ────────────
  const pm = readPm(pmIn);
  const entryTitleOf = new Map<string, string>();                           // DMC string -> title of the publication entry that places it
  const pmOrder: string[] = [];                                             // DMC strings in publication order
  const { dmCodeString } = vendor('engine/resolveDmRefs');
  (function walk(list: any[], inFront: boolean) {
    for (const e of list ?? []) {
      if (e.type === 'folder') { walk(e.children ?? [], inFront); continue; }
      if (e.type !== 'dm' || !e.dmCode) continue;
      const code = dmCodeString(e.dmCode, e.identExtension ?? null);
      pmOrder.push(code);
      if (e.title && !entryTitleOf.has(code)) entryTitleOf.set(code, e.title);
    }
  })(pm.entries, true);

  // ── classify every module ────────────────────────────────────────────────────────────────────
  const found: Found[] = [];
  const idsFrom: Array<ReturnType<typeof dmLikeFromXml>> = [];
  for (const d of dmsIn) {
    const info = dmLikeFromXml(d.xml, d.file);
    if (!info) continue;
    const a = info.dmCodeAttrs;
    const c = classifyFrontMatter({
      infoCode: a.infoCode, disassyCode: a.disassyCode, systemCode: a.systemCode, subSystemCode: a.subSystemCode, subSubSystemCode: a.subSubSystemCode,
      assyCode: a.assyCode, infoName: info.infoName, techName: info.techName, entryTitle: entryTitleOf.get(dmcOf(info.dmCodeAttrs)),
    });
    if (c.kind === 'body') continue;
    if (c.kind === 'unknown') { notConsumed.push({ file: d.file, infoCode: a.infoCode, reason: c.reason }); add('engine', d.file, 'not-understood', c.reason, d.file); continue; }
    idsFrom.push(info);
    const root = parseXml(d.xml).documentElement as unknown as El;
    found.push({ file: d.file, xml: d.xml, infoCode: a.infoCode, page: c.page, via: c.via, issue: `${info.issueNumber}-${info.inWork}`, entityFiles: entityMap(d.xml), root });
  }
  // one module per page: the newest issue; the rest are reported
  const byPage = new Map<PageId, Found>();
  for (const f of [...found].sort((x, y) => (x.issue < y.issue ? 1 : x.issue > y.issue ? -1 : x.file < y.file ? -1 : 1))) {
    if (!byPage.has(f.page)) byPage.set(f.page, f);
    else { notConsumed.push({ file: f.file, infoCode: f.infoCode, reason: `${pageDef(f.page).label}: another module (${byPage.get(f.page)!.file}) is the newest issue of this page.` }); }
  }
  for (const f of byPage.values()) {
    if (f.via === 'convention') add(f.page, f.file, 'defaulted', `Information code ${f.infoCode} names no page; taken as "${pageDef(f.page).label}" by the numbering of the Xignal sample (X01 demolition, X02 change notice, X03 annexures, X04 system name). Check it.`, f.file);
  }

  // ── resolving graphics ───────────────────────────────────────────────────────────────────────
  const warnedIcn = new Set<string>();
  const iconPath = (f: Found, ident: string, field: string): string => {
    const declared = f.entityFiles.get(ident);
    if (declared) {
      const rel = declared.replace(/\\/g, '/');
      return path.posix.normalize(rel.startsWith('/') ? rel.slice(1) : `${csdbDir}/${rel}`).replace(/^\.\//, '');
    }
    const hit = available.find((n) => n.toLowerCase() === ident.toLowerCase() || n.toLowerCase().startsWith(`${ident.toLowerCase()}.`));
    if (hit) return hit.includes('/') ? hit : `${csdbDir}/${hit}`;
    if (!warnedIcn.has(ident)) { warnedIcn.add(ident); add(f.page, field, 'not-understood', `Graphic ${ident} has no <!ENTITY> declaration and no matching file; its path is a guess (${csdbDir}/${ident}).`, f.file); }
    return `${csdbDir}/${ident}`;
  };

  const setLabel = (key: string, value: string, page: PageId, file: string, field: string) => {
    const def = LABEL_DEFAULTS[key];
    if (def !== undefined && sameText(def, value)) return;
    setPath(fm, `labels.${key}`, value);
    add(page, field, 'mapped', `Label "${value}" (the engine prints "${def ?? 'its own wording'}") kept as labels.${key}.`, file);
  };
  const consume = (f: Found) => consumed.push({ file: f.file, infoCode: f.infoCode, page: f.page, via: f.via });
  const descOf = (f: Found): El | undefined => descendants(f.root, 'description')[0];
  const lpsOf = (f: Found): El[] => elems(descOf(f), 'levelledPara');
  /** Paragraph texts of a node, in order (a graphic-only paragraph contributes nothing). */
  const paras = (n: El | undefined): string[] => elems(n, 'para').map((p) => inlineOf(p).filter((i) => i.t === 'text').map((i) => i.v).join(' ')).filter(Boolean);
  const paraLines = (n: El | undefined): string[] => elems(n, 'para').flatMap((p) => linesOf(p));
  const ignoredContent = (f: Found, what: string) => add(f.page, what, 'ignored', `${what} is generated by the engine; the module's own content is not used.`, f.file);

  // ── title page ───────────────────────────────────────────────────────────────────────────────
  const tp = byPage.get('titlePage');
  const xign: Record<string, any> = {};
  let titlePageJoint = false;
  if (tp) {
    consume(tp);
    const lps = lpsOf(tp);
    const blocks = (i: number): Inline[] => (lps[i - 1] ? elems(lps[i - 1], 'para').flatMap(inlineOf) : []);
    const texts = (i: number): string[] => blocks(i).filter((b) => b.t === 'text').map((b) => b.v);
    const symbols = (i: number): Inline[] => blocks(i).filter((b) => b.t === 'symbol');
    if (lps.length !== 10) add('titlePage', 'levelledPara positions', 'defaulted', `The title page has ${lps.length} positional paragraphs; Xignal's layout has 10. Missing positions are read as empty.`, tp.file);
    const title: Record<string, string> = {};

    // [1] publication number / revision
    for (const t of texts(1)) {
      const l = splitLabelled(t);
      const kind = l ? (/pub|doc|inbr/i.test(l.label) ? 'pub' : /rev/i.test(l.label) ? 'rev' : /code/i.test(l.label) ? 'code' : '') : '';
      if (kind === 'pub' && l) {
        pub.publicationNo = l.value; pub.inbrNo = l.value;
        setLabel('titleJoint.publicationNo', `${l.label} `, 'titlePage', tp.file, '[1] publication number label');
        setLabel('title.inbrNo', `${l.label} `, 'titlePage', tp.file, '[1] publication number label');
        add('titlePage', '[1] publication no', 'mapped', `"${l.value}" -> publication.publicationNo, and publication.inbrNo (the single title page prints the number from inbrNo).`, tp.file);
      } else if (kind === 'rev' && l) { fm.revNo = l.value; add('titlePage', '[1] revision', 'mapped', `"${l.value}" -> frontMatter.revNo (the engine prints its own "Rev No.:" label).`, tp.file); }
      else if (kind === 'code' && l) { fm.codeNo = l.value; add('titlePage', '[1] code no', 'mapped', `"${l.value}" -> frontMatter.codeNo.`, tp.file); }
      else if (!l && !pub.publicationNo) { pub.publicationNo = t; pub.inbrNo = t; add('titlePage', '[1] publication no', 'mapped', `"${t}" -> publication.publicationNo / inbrNo (no label in the module).`, tp.file); }
      else add('titlePage', '[1]', 'not-understood', `Line "${t}" is not a publication number, revision or code number.`, tp.file);
    }
    // [2] first red notice
    const red1 = texts(2).join(' ');
    if (red1) { title.disclosureNotice = red1; add('titlePage', '[2] first red text', 'mapped', '-> titlePage.disclosureNotice', tp.file); }
    // [3] emblem
    const logo = symbols(3)[0];
    if (logo) { branding.emblem = iconPath(tp, logo.v, '[3] logo'); add('titlePage', '[3] logo', 'mapped', `${logo.v} -> branding.emblem (${branding.emblem}). The emblem is a house-template setting: it is offered, not applied to the project.`, tp.file); }
    // [4] standard text: document type / FOR / system name
    const p4 = lps[3] ? elems(lps[3], 'para').map((p) => textOf(p)) : [];          // by position: an empty line must not shift the others
    const std = p4.length >= 3 ? p4 : texts(4);
    if (std.length) {
      if (std[0]) { title.documentType = std[0]; add('titlePage', '[4] document type', 'mapped', `"${std[0]}" -> titlePage.documentType`, tp.file); }
      if (std.length >= 3 && std[1]) setLabel('title.for', std[1], 'titlePage', tp.file, '[4] "FOR"');
      const sys = std[std.length - 1];
      if (std.length >= 2 && sys) fm.__titleSystemName = sys;                // compared with the PM's short title below
    }
    // [5] repair notice
    const red2 = texts(5).join(' ');
    if (red2) { title.repairNotice = red2; add('titlePage', '[5] second text', 'mapped', '-> titlePage.repairNotice', tp.file); }
    // [6] NSN or the "Prepared & Published by" line (the module's own comment says NSN; the content decides)
    for (const t of texts(6)) {
      const l = splitLabelled(t);
      if (l && /nsn/i.test(l.label)) { pub.nsn = l.value; setLabel('titleJoint.nsn', `${l.label} `, 'titlePage', tp.file, '[6] NSN label'); add('titlePage', '[6] NSN', 'mapped', `"${l.value}" -> publication.nsn`, tp.file); }
      else if (/prepared|published/i.test(t) && !l) { setLabel('title.publishedBy', t, 'titlePage', tp.file, '[6] "Prepared & Published by"'); }
      else add('titlePage', '[6]', 'not-understood', `"${t}" is neither an NSN nor a "Prepared & Published by" line.`, tp.file);
    }
    // [7] contract number, or the publisher block (name, logo, address lines)
    const pb = blocks(7);
    const publisher: Publisher = { name: '', addressLines: [] };
    let hasPublisher = false;
    for (const b of pb) {
      if (b.t === 'symbol') { publisher.logo ??= iconPath(tp, b.v, '[7] publisher logo'); hasPublisher = true; if (b.scale) add('titlePage', '[7] logo scale', 'ignored', `reproductionScale="${b.scale}" on the publisher logo has no setting in the engine.`, tp.file); continue; }
      const l = splitLabelled(b.v);
      if (l && /contract/i.test(l.label)) { pub.contractNo = l.value; setLabel('titleJoint.contractNo', `${l.label} `, 'titlePage', tp.file, '[7] contract label'); add('titlePage', '[7] contract', 'mapped', `"${l.value}" -> publication.contractNo`, tp.file); continue; }
      hasPublisher = true;
      if (!publisher.name) publisher.name = b.v; else publisher.addressLines.push(b.v);
    }
    // [8] second red text, [9] joint heading, [10] parties
    const red8 = texts(8).join(' ');
    if (red8) { xign.titlePage = { ...(xign.titlePage ?? {}), secondRedText: red8 }; add('titlePage', '[8] second red text', 'mapped', 'kept as frontMatter.xignal.titlePage.secondRedText (the engine has no second notice).', tp.file); }
    const jointLabel = texts(9).join(' ');
    const partiesTable = lps[9] ? first(lps[9], 'table') : undefined;
    const parties: Array<{ logo?: string; lines: string[] }> = [];
    if (partiesTable) {
      for (const row of readTable(partiesTable).body) for (const cell of row) {
        if (!cell.origin || !cell.el) continue;
        const inl = elems(cell.el, 'para').flatMap(inlineOf);
        const p: { logo?: string; lines: string[] } = { lines: inl.filter((i) => i.t === 'text').map((i) => i.v) };
        const sym = inl.find((i) => i.t === 'symbol');
        if (sym) p.logo = iconPath(tp, sym.v, '[10] party logo');
        if (p.logo || p.lines.length) parties.push(p);
      }
    }
    if (jointLabel) {
      titlePageJoint = true;
      setLabel('titleJoint.publishedBy', jointLabel, 'titlePage', tp.file, '[9] joint heading');
      branding.publishers = parties.map((p) => ({ name: p.lines[0] ?? '', addressLines: p.lines.slice(1), ...(p.logo ? { logo: p.logo } : {}) }));
      add('titlePage', '[10] parties', 'mapped', `${parties.length} part${parties.length === 1 ? 'y' : 'ies'} -> branding.publishers (the joint title page).`, tp.file);
    } else {
      if (hasPublisher) { branding.publishers = [{ name: publisher.name, addressLines: publisher.addressLines, ...(publisher.logo ? { logo: publisher.logo } : {}) }]; add('titlePage', '[7] publisher', 'mapped', `"${publisher.name}" (+${publisher.addressLines.length} address line${publisher.addressLines.length === 1 ? '' : 's'}${publisher.logo ? ', logo' : ''}) -> branding.publishers[0].`, tp.file); }
      if (parties.length) { xign.titlePage = { ...(xign.titlePage ?? {}), parties }; add('titlePage', '[10] parties', 'ignored', `${parties.length} part${parties.length === 1 ? 'y' : 'ies'} found, but "Jointly Prepared & Published by" is empty, so the joint title page is not used; kept as frontMatter.xignal.titlePage.parties.`, tp.file); }
    }
    fm.titlePage = { documentType: title.documentType ?? '', disclosureNotice: title.disclosureNotice ?? '', repairNotice: title.repairNotice ?? '' };
    if (titlePageJoint) fm.titlePageJoint = { ...fm.titlePage };
  }

  // ── proprietary notice ───────────────────────────────────────────────────────────────────────
  const pr = byPage.get('proprietary');
  if (pr) {
    consume(pr);
    const lps = lpsOf(pr);
    const text = paras(lps[0]).join(' ');
    const applic = lps[1] ? textOf(first(lps[1], 'title')) : '';
    fm.proprietary = { text, applicability: applic };
    add('proprietary', 'text', 'mapped', '-> proprietary.text', pr.file);
    add('proprietary', 'applicability', applic ? 'mapped' : 'defaulted', applic ? '-> proprietary.applicability' : 'no second paragraph: applicability is empty', pr.file);
    if (lps.length > 2) add('proprietary', 'extra paragraphs', 'not-understood', `${lps.length - 2} further levelled paragraph(s) are not used.`, pr.file);
  }

  // ── foreword ─────────────────────────────────────────────────────────────────────────────────
  const fw = byPage.get('foreword');
  if (fw) {
    consume(fw);
    const lp = lpsOf(fw)[0];
    const out: Record<string, any> = { text: lp ? paras(lp).join(' ') : '' };
    const table = lp ? first(lp, 'table') : undefined;
    const seen = new Set<string>();
    if (table) {
      for (const row of readTable(table).body) {
        const cells = row.filter((c) => c.origin);
        if (cells.length < 2) continue;                                      // a spacer row
        const label = cells[0].text.replace(/[:\s]+$/, '');
        const valueCell = cells[cells.length - 1];
        const lines = valueCell.el ? elems(valueCell.el, 'para').flatMap((p) => linesOf(p)) : [];
        if (!label && !lines.length) continue;
        const key = /e-?\s*mail/i.test(label) ? 'email' : /post|address/i.test(label) ? 'postalAddress' : /tel|phone/i.test(label) ? 'telephone' : /fax/i.test(label) ? 'fax' : '';
        if (!key || seen.has(key)) { add('foreword', `row "${label}"`, 'not-understood', 'The engine\'s foreword has four contact rows (e-mail, postal address, telephone, fax); this row is not one of them (or repeats one) and is not kept.', fw.file); continue; }
        seen.add(key);
        out[key] = key === 'email' ? (lines.length > 1 ? lines : lines[0] ?? '') : lines;
        add('foreword', label, 'mapped', `-> foreword.${key} (${lines.length} line${lines.length === 1 ? '' : 's'})`, fw.file);
      }
    }
    for (const k of ['email', 'postalAddress', 'telephone', 'fax']) if (!(k in out)) out[k] = k === 'email' ? '' : [];
    fm.foreword = out;
    add('foreword', 'text', 'mapped', '-> foreword.text', fw.file);
  }

  // ── record of changes ────────────────────────────────────────────────────────────────────────
  const roc = byPage.get('recordOfChanges');
  if (roc) {
    consume(roc);
    const table = descendants(roc.root, 'table')[0];
    if (table) {
      const g = readTable(table);
      const head = g.head[0]?.map((c) => c.text) ?? [];
      (['roc.colChangeNotice', 'roc.colAuthority', 'roc.colIncorporatedBy', 'roc.colInitials'] as const).forEach((k, i) => { if (head[i]) setLabel(k, head[i], 'recordOfChanges', roc.file, `column ${i + 1} heading`); });
      const numbering = (cells: { text: string }[]) => cells.length >= 4 && cells.every((c, i) => c.text.replace(/\s/g, '') === `(${i + 1})`);
      const data = g.body.filter((r) => !numbering(r));
      const filled = data.filter((r) => r.some((c) => c.text));
      fm.recordOfChanges = { rows: data.length };
      add('recordOfChanges', 'rows', 'mapped', `${data.length} ruled row(s) -> recordOfChanges.rows`, roc.file);
      if (filled.length) add('recordOfChanges', 'entries', 'not-understood', `${filled.length} row(s) carry recorded changes; the engine prints a blank pro-forma, so only the number of rows is kept.`, roc.file);
    } else add('recordOfChanges', 'table', 'not-understood', 'No table found; the engine default (20 rows) applies.', roc.file);
  }

  // ── associated handbooks ─────────────────────────────────────────────────────────────────────
  const ah = byPage.get('associatedHandbooks');
  if (ah) {
    consume(ah);
    const lp = lpsOf(ah)[0];
    const intro = lp ? paras(lp).join(' ') : '';
    if (intro) { xign.associatedHandbooks = { intro }; add('associatedHandbooks', 'introduction', 'mapped', 'kept as frontMatter.xignal.associatedHandbooks.intro (the engine writes its own sentence around the system name).', ah.file); }
    const table = lp ? first(lp, 'table') : undefined;
    const items: Array<Record<string, any>> = [];
    if (table) {
      const g = readTable(table);
      const head = g.head[0]?.map((c) => c.text) ?? [];
      (['handbooks.colSr', 'handbooks.colTitle', 'handbooks.colInbr'] as const).forEach((k, i) => { if (head[i]) setLabel(k, head[i], 'associatedHandbooks', ah.file, `column ${i + 1} heading`); });
      for (const row of g.body) {
        const srCell = row[0];
        const titleCell = row[1];
        const docCell = row[2];
        const sr = stripNbsp(srCell?.origin ? srCell.text : '');
        const title = titleCell?.origin ? titleCell.lines.join('\n') : '';
        const inbr = docCell?.origin ? docCell.text : '';
        if (!sr && !title && !inbr) continue;
        const emphOnly = !!titleCell?.el && elems(titleCell.el, 'para').length === 1
          && elems(elems(titleCell.el, 'para')[0], 'emphasis').length > 0 && textOf(elems(elems(titleCell.el, 'para')[0], 'emphasis')[0]) === titleCell.text;
        const heading = !sr && !inbr && !!titleCell?.origin && (titleCell.colspan >= 2 || emphOnly);   // a group heading: spanned, or a bold-only line with no number
        items.push(heading ? { sr: '', title, inbr: '', group: true } : { sr, title, inbr });
      }
    }
    fm.associatedHandbooks = items;
    add('associatedHandbooks', 'rows', 'mapped', `${items.length} row(s) (${items.filter((i) => i.group).length} group heading(s)) -> associatedHandbooks`, ah.file);
  }

  // ── safety warning, first aid, cautions ──────────────────────────────────────────────────────
  const sw = byPage.get('safetyWarning');
  if (sw) {
    consume(sw);
    const lps = lpsOf(sw);
    const lines: Array<Record<string, any>> = [];
    const heading = lps[0] ? textOf(first(lps[0], 'title')) : '';
    const body = lps[0] ? elems(lps[0], 'levelledPara') : [];
    for (const b of body) {
      const t = first(b, 'title');
      const text = textOf(t);
      if (!text) continue;
      const strong = !!t && elems(t, 'emphasis').some((e) => (attr(e, 'emphasisType') || 'em01') === 'em01');
      lines.push(strong ? { text, strong: true } : { text });
    }
    fm.safetyWarning = lines;
    add('safetyWarning', 'lines', 'mapped', `${lines.length} line(s) -> safetyWarning`, sw.file);
    if (heading) setLabel('safety.heading', heading, 'safetyWarning', sw.file, 'heading');
    const trailer = lps[1] ? textOf(first(lps[1], 'title')) : '';
    if (trailer) setLabel('safety.footer', trailer, 'safetyWarning', sw.file, 'footer line');
  }

  const fa = byPage.get('firstAid');
  if (fa) {
    consume(fa);
    const lp = lpsOf(fa)[0];
    const table = lp ? first(lp, 'table') : undefined;
    const figures: string[] = [];
    const steps: Array<{ paras: string[] }> = [];
    let closing: string[] = [];
    if (table) {
      for (const row of readTable(table).body) {
        const cells = row.filter((c) => c.origin);
        for (const c of cells) if (c.el) for (const p of elems(c.el, 'para')) for (const i of inlineOf(p)) if (i.t === 'symbol') figures.push(iconPath(fa, i.v, 'figure'));
        const numIdx = cells.findIndex((c) => /^\d+\.?$/.test(c.text));
        if (numIdx >= 0 && cells[numIdx + 1]?.el) steps.push({ paras: elems(cells[numIdx + 1].el!, 'para').map((p) => textOf(p)).filter(Boolean) });
        else {
          const wide = cells.find((c) => c.colspan >= 2 && c.text);
          if (wide?.el) closing = elems(wide.el, 'para').map((p) => textOf(p)).filter(Boolean);
        }
      }
    }
    fm.firstAid = { ...(figures[0] ? { figure: figures[0] } : {}), figures, steps, closing };
    add('firstAid', 'steps', 'mapped', `${steps.length} step(s) -> firstAid.steps; ${closing.length} closing line(s) -> firstAid.closing (the engine writes none yet)`, fa.file);
    if (figures.length > 1) add('firstAid', 'figures', 'defaulted', `${figures.length} figures found; the engine's first-aid page prints ONE illustration: the first is firstAid.figure, all are kept in firstAid.figures.`, fa.file);
  }

  const cn = byPage.get('cautionsNotes');
  if (cn) {
    consume(cn);
    const items = descendants(cn.root, 'listItem').map((li) => paras(li).join(' ') || textOf(li)).filter(Boolean);
    fm.cautionsNotes = items;
    add('cautionsNotes', 'items', 'mapped', `${items.length} item(s) -> cautionsNotes`, cn.file);
  }

  // ── demolition ───────────────────────────────────────────────────────────────────────────────
  const dm = byPage.get('demolition');
  if (dm) {
    consume(dm);
    const outer = descendants(dm.root, 'sequentialList')[0];
    const parts: Array<Record<string, any>> = [];
    for (const li of elems(outer, 'listItem')) {
      const ps = elems(li, 'para');
      const titleEl = ps[0];
      const isTitle = !!titleEl && elems(titleEl, 'emphasis').length > 0 && !titleEl.getElementsByTagName('sequentialList').length;
      const part: Record<string, any> = { title: isTitle ? textOf(titleEl) : '', paras: [] as string[], items: [] as string[], listType: 'roman' };
      for (const p of isTitle ? ps.slice(1) : ps) {
        const nested = first(p, 'sequentialList') ?? first(p, 'randomList');
        if (nested) part.items.push(...elems(nested, 'listItem').map((x) => paras(x).join(' ') || textOf(x)).filter(Boolean));
        else { const t = textOf(p); if (t) part.paras.push(t); }
      }
      parts.push(part);
    }
    fm.demolition = { parts };
    add('demolition', 'parts', 'mapped', `${parts.length} part(s) -> demolition.parts`, dm.file);
  }

  // ── change notice, abbreviations, symbols, system image ──────────────────────────────────────
  const ch = byPage.get('changeNotice');
  if (ch) {
    consume(ch);
    const lp = lpsOf(ch)[0];
    const inl = lp ? elems(lp, 'para').flatMap(inlineOf) : [];
    const sym = inl.find((i) => i.t === 'symbol');
    const txt = inl.filter((i) => i.t === 'text').map((i) => i.v).join(' ');
    if (sym || txt) { xign.changeNotice = { ...(txt ? { text: txt } : {}), ...(sym ? { logo: iconPath(ch, sym.v, 'logo') } : {}) }; add('changeNotice', 'letterhead', 'mapped', 'kept as frontMatter.xignal.changeNotice; the engine prints its own change-notice pro-forma (settings key changeNotice.rows is not set).', ch.file); }
    else add('changeNotice', 'content', 'defaulted', 'no content: the engine\'s change-notice pro-forma is used.', ch.file);
    fm.changeNotice = { rows: 3 };                                          // the engine writes the page only when its key exists; 3 is its own default
  }

  const ab = byPage.get('listOfAbbreviations');
  if (ab) {
    consume(ab);
    const table = descendants(ab.root, 'table')[0];
    const items: Array<{ term: string; meaning: string }> = [];
    if (table) {
      const g = readTable(table);
      const head = g.head[0]?.map((c) => c.text) ?? [];
      (['abbrev.colTerm', 'abbrev.colMeaning'] as const).forEach((k, i) => { if (head[i]) setLabel(k, head[i], 'listOfAbbreviations', ab.file, `column ${i + 1} heading`); });
      for (const row of g.body) if (row[0]?.text) items.push({ term: row[0].text, meaning: row[1]?.text ?? '' });
    }
    fm.listOfAbbreviations = items;
    add('listOfAbbreviations', 'entries', items.length ? 'mapped' : 'defaulted', items.length ? `${items.length} entr${items.length === 1 ? 'y' : 'ies'} -> listOfAbbreviations` : 'no entries (the module holds only commented-out examples): the build harvests <acronym> terms and prints a blank pro-forma otherwise.', ab.file);
  }

  const sy = byPage.get('descriptionOfSymbols');
  if (sy) {
    consume(sy);
    const table = descendants(sy.root, 'table')[0];
    const symbols: Array<{ icon: string; text: string }> = [];
    const legends: Record<string, string> = {};
    if (table) {
      for (const row of readTable(table).body) {
        let icon = '';
        let text = '';
        for (const c of row) {
          if (!c.origin || !c.el) continue;
          const sym = descendants(c.el, 'symbol')[0];
          if (sym && !icon && !descendants(c.el, 'note').length) { icon = iconPath(sy, attr(sym, 'infoEntityIdent'), 'symbol'); continue; }
          for (const k of ['note', 'warning', 'caution'] as const) {
            const n = descendants(c.el, k)[0];
            if (n && !legends[k]) legends[k] = textOf(n);
          }
          if (!descendants(c.el, 'note').length && !descendants(c.el, 'warning').length && !descendants(c.el, 'caution').length && !text) text = c.text;
        }
        if (icon || text) symbols.push({ icon, text });
      }
    }
    fm.descriptionOfSymbols = symbols;
    if (Object.keys(legends).length) fm.noticeLegends = { note: legends.note ?? '', warning: legends.warning ?? '', caution: legends.caution ?? '' };
    add('descriptionOfSymbols', 'symbols', 'mapped', `${symbols.length} symbol(s) -> descriptionOfSymbols; ${Object.keys(legends).length} notice legend(s) -> noticeLegends`, sy.file);
  }

  const sn = byPage.get('systemNamePage');
  if (sn) {
    consume(sn);
    const imgs = descendants(sn.root, 'symbol').map((s) => iconPath(sn, attr(s, 'infoEntityIdent'), 'image'));
    if (imgs.length) { fm.systemImages = imgs; add('systemNamePage', 'images', 'mapped', `${imgs.length} image(s) -> systemImages`, sn.file); }
    else add('systemNamePage', 'images', 'defaulted', 'no image: the page keeps its ruled placeholder frame.', sn.file);
  }

  // lists the engine builds itself, and the one page it has no counterpart for
  for (const p of ['listOfContents', 'listOfFigures', 'listOfTables'] as const) {
    const f = byPage.get(p);
    if (!f) continue;
    consume(f);
    const real = descendants(f.root, 'levelledPara').length > 0 || descendants(f.root, 'table').length > 0;
    if (real) ignoredContent(f, pageDef(p).label); else add(p, 'page', 'mapped', `${pageDef(p).label}: enabled; the engine builds the list from the publication.`, f.file);
  }
  const an = byPage.get('listOfAnnexures');
  if (an) { consume(an); add('listOfAnnexures', 'page', 'ignored', 'The engine has no "list of annexures" page (Xignal builds it from the annexure sub-publications); the module is consumed so it is not printed as body. Its place in the order is kept as frontMatter.xignal.listOfAnnexures.', an.file); }

  // ── the page order and the set of pages: the publication's, as listed ────────────────────────
  const ordered: PageId[] = [];
  const dmcOfFound = (f: Found): string => dmcOf(dmLikeFromXml(f.xml, f.file)!.dmCodeAttrs);
  for (const code of pmOrder) { const f = [...byPage.values()].find((x) => dmcOfFound(x) === code); if (f && !ordered.includes(f.page)) ordered.push(f.page); }
  for (const d of PAGE_DEFS) if (byPage.has(d.page) && !ordered.includes(d.page)) ordered.push(d.page);
  const engineCatalogue: Array<{ id: string; required?: boolean }> = vendor('engine/frontMatterPages').CATALOGUE;
  if (byPage.has('listOfAnnexures')) {
    const at = ordered.indexOf('listOfAnnexures');
    const prev = ordered.slice(0, at).reverse().find((p) => engineCatalogue.some((c) => c.id === p));
    xign.listOfAnnexures = { enabled: true, ...(prev ? { after: prev } : {}) };
  }
  const pages: Array<{ id: string; enabled: boolean }> = [];
  if (byPage.size) {
    pages.push({ id: 'titlePageJoint', enabled: true });
    for (const p of ordered) if (engineCatalogue.some((c) => c.id === p)) pages.push({ id: p, enabled: true });
    for (const c of engineCatalogue) if (!pages.some((x) => x.id === c.id)) pages.push({ id: c.id, enabled: false });
    fm.pages = pages;
    const off = pages.filter((p) => !p.enabled).map((p) => p.id);
    add('engine', 'pages', 'mapped', `Running order of ${pages.filter((p) => p.enabled).length} page(s) from the publication; ${off.length ? `switched off (not in the Xignal front matter): ${off.join(', ')}` : 'none switched off'}. The joint title page is a required engine page: it stays on.`);
    fm.style = 'jss';
    add('engine', 'style', 'mapped', 'frontMatter.style = "jss": the direct S1000D engine prints the stencil prelims (title pages, proprietary notice, foreword ...) rather than its four-page default set.');
  }

  // ── publication header ───────────────────────────────────────────────────────────────────────
  const m = pm.meta;
  if (m) {
    const claims: Record<string, string> = {};                               // field -> source (comment-driven first)
    const put = (field: string, value: string, why: string) => {
      if (!value || claims[field]) return;
      pub[field] = value; claims[field] = why;
      add('pm', field, 'mapped', `"${value}" ${why}`);
    };
    for (const h of pm.hints) {                                              // the PM's own comments say what each element feeds
      const f = /book\s*name/i.test(h.comment) ? 'bookName' : /system\s*name/i.test(h.comment) ? 'systemName' : /classif/i.test(h.comment) ? 'securityClassification' : '';
      if (f && h.value) put(f, f === 'securityClassification' ? securityLabelOf(h.value) : h.value, `-> publication.${f}: <${h.element}> (its comment: "${h.comment}")`);
    }
    put('bookName', m.pmTitle, '-> publication.bookName: <pmTitle>');
    put('systemName', m.shortPmTitle, '-> publication.systemName: <shortPmTitle>');
    if (m.issueDate?.year) { pub.year = m.issueDate.year; pub.month = m.issueDate.month ?? ''; add('pm', 'issueDate', 'mapped', `${m.issueDate.year}-${m.issueDate.month ?? ''} -> publication.year / month (the cover prints the PM's own date).`); }
    if (m.securityClassification && !claims.securityClassification) {
      const label = securityLabelOf(m.securityClassification);
      pub.securityClassification = label;
      add('pm', 'securityClassification', SECURITY_LABEL[m.securityClassification] ? 'mapped' : 'defaulted', SECURITY_LABEL[m.securityClassification] ? `${m.securityClassification} -> "${label}"` : `Class "${m.securityClassification}" is not one of the engine's five (01-05); kept as written. The classification marking for it is customer configuration.`);
    }
    if (m.securityClassification && claims.securityClassification) { /* comment-driven, already reported */ }
  } else if (byPage.size) add('pm', 'header', 'defaulted', 'No publication module was given: bookName, systemName, date and classification are not set from it.');

  // the title page repeats the system name; the PM's short title feeds the header, so it is the one stored
  if (fm.__titleSystemName !== undefined) {
    if (pub.systemName && !sameText(pub.systemName, fm.__titleSystemName)) add('titlePage', '[4] system name', 'not-understood', `The title page says "${fm.__titleSystemName}" but the PM's short title is "${pub.systemName}"; the engine prints ONE system name (publication.systemName = the PM's). Check which is right.`, tp?.file);
    else if (!pub.systemName) { pub.systemName = fm.__titleSystemName; add('titlePage', '[4] system name', 'mapped', `"${fm.__titleSystemName}" -> publication.systemName (the PM gave none)`, tp?.file); }
    else add('titlePage', '[4] system name', 'mapped', 'matches the PM short title -> publication.systemName', tp?.file);
    delete fm.__titleSystemName;
  }

  if (Object.keys(xign).length) fm.xignal = xign;

  // ── identity of the modules, for generating them again ───────────────────────────────────────
  const ids = idsOf(found, idsFrom, pm.meta);

  const count = (s: MapStatus) => report.filter((r) => r.status === s).length;
  return {
    frontMatter: fm, publication: pub, branding, ids,
    consumed: consumed.sort((a, b) => (a.file < b.file ? -1 : 1)), notConsumed,
    report,
    summary: { pages: byPage.size, consumed: consumed.length, notConsumed: notConsumed.length, mapped: count('mapped'), defaulted: count('defaulted'), ignored: count('ignored'), notUnderstood: count('not-understood') },
  };
}

// ── helpers ────────────────────────────────────────────────────────────────────────────────────

const dmcOf = (a: Record<string, string>): string => [a.modelIdentCode, a.systemDiffCode, a.systemCode, `${a.subSystemCode}${a.subSubSystemCode}`, a.assyCode, `${a.disassyCode}${a.disassyCodeVariant}`, `${a.infoCode}${a.infoCodeVariant}`, a.itemLocationCode].join('-');

function idsOf(found: Found[], infos: Array<ReturnType<typeof dmLikeFromXml>>, pmMeta: any): ModuleIds {
  const f = found.find((x) => x.page === 'titlePage') ?? found[0];
  if (!f) return {};
  const info = infos[found.indexOf(f)] ?? infos[0]!;
  const a = info.dmCodeAttrs;
  // The issue number is not carried over: modules generated from these ids are new (issue 001), whatever issue the old ones were at.
  const out: ModuleIds = {
    modelIdentCode: a.modelIdentCode, systemDiffCode: a.systemDiffCode, languageIsoCode: info.languageAttrs?.languageIsoCode, countryIsoCode: info.languageAttrs?.countryIsoCode,
  };
  const head = f.xml.slice(0, 20000);
  const sec = /<security\b[^>]*securityClassification="([^"]*)"/.exec(head);
  if (sec) out.security = sec[1];
  const rpc = /<responsiblePartnerCompany\s+enterpriseCode="([^"]*)"[^>]*>\s*<enterpriseName>([^<]*)<\/enterpriseName>/.exec(head);
  if (rpc) out.rpc = { enterpriseCode: rpc[1], enterpriseName: rpc[2].trim() };
  const org = /<originator\s+enterpriseCode="([^"]*)"[^>]*>\s*<enterpriseName>([^<]*)<\/enterpriseName>/.exec(head);
  if (org) out.originator = { enterpriseCode: org[1], enterpriseName: org[2].trim() };
  const brex = /<brexDmRef>[\s\S]*?<dmCode\b([^>]*)\/?>/.exec(head);
  if (brex) { const at: Record<string, string> = {}; brex[1].replace(/([\w:.-]+)\s*=\s*"([^"]*)"/g, (_m, k, v) => (at[k] = v)); out.brex = at; }
  if (pmMeta?.issueDate?.year) out.issueDate = { year: pmMeta.issueDate.year, month: pmMeta.issueDate.month ?? '01', day: pmMeta.issueDate.day ?? '01' };
  return out;
}

interface PmRead { meta: any; entries: any[]; hints: Array<{ element: string; comment: string; value: string }> }

/** The publication module: header values, the placement of every module, and the comments that say what each header element feeds. */
function readPm(pm: string | { meta?: any; entries?: any[] } | null | undefined): PmRead {
  if (!pm) return { meta: null, entries: [], hints: [] };
  if (typeof pm !== 'string') return { meta: pm.meta ?? null, entries: pm.entries ?? [], hints: [] };
  let parsed: { meta: any; entries: any[] };
  try { parsed = vendor('engine/pmc').parsePm(pm); } catch { return { meta: null, entries: [], hints: [] }; }
  const hints: PmRead['hints'] = [];
  try {
    const doc = parseXml(pm);
    for (const tag of ['pmTitle', 'shortPmTitle', 'security', 'issueDate']) {
      for (const el of descendants(doc.documentElement as unknown as El, tag)) {
        let n: Node | null = el.nextSibling;
        while (n && n.nodeType === 3 && !(n.nodeValue ?? '').trim()) n = n.nextSibling;
        if (n && n.nodeType === 8) hints.push({ element: tag, comment: collapse(n.nodeValue ?? ''), value: tag === 'security' ? attr(el, 'securityClassification') : textOf(el) });
      }
    }
  } catch { /* the comments are a bonus */ }
  return { meta: parsed.meta, entries: parsed.entries, hints };
}
