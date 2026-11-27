// =============================================================================
// The engine's front-matter settings  ->  Xignal-convention S1000D 4.2 data modules.
//
//   dmsFromFrontMatter(frontMatter, publication, ids, options)
//
// The reverse of frontMatterFromDms (fromDms.ts), written to its reading rules so that reading what this writes gives back the
// settings it was given. Each module follows the structure the JSS-0251 sample uses (verified there): reserved information code, the
// zero SNS code, positional <levelledPara> blocks on the title page, a CALS table for the lists, ICN graphics declared as
// <!ENTITY ... NDATA> in the DOCTYPE. The modules are Issue 4.2 flat-schema descript.xsd and validate against the bundled schema
// (tested offline).
//
// Every generated module is FLAGGED so nobody mistakes it for something an author wrote: a processing instruction
// (<?agastya-generated ... ?>, schema-neutral) in the prolog, and - kept by the route - a sidecar entry with the checksum of
// the text as written. The flag is how regenerating knows which files it owns.
//
// Pure: no filesystem, no project. The caller decides where the files go.
// =============================================================================

import path from 'path';
import { vendor } from '../../config';
import { DEFAULT_BREX_42, type PmEntryOut, type PmMeta } from '../sns/pmxml';
import { LABEL_DEFAULTS, securityCodeOf, type MappingEntry, type ModuleIds, type Publisher } from './fromDms';
import { PAGE_DEFS, pageDef, type PageDef, type PageId } from './reserved';
import { generatedMarker } from './sidecar';
import { escText as esc, escAttr } from '../../lib/xml';

export interface GeneratedDm {
  file: string;
  xml: string;
  page: PageId;
  infoCode: string;
  /** DMC string, e.g. DMC-JSS0251-A-00-00-00-00A-001A-A */
  dmc: string;
  techName: string;
  infoName: string;
  dmCodeAttrs: Record<string, string>;
}

export interface GenIds extends ModuleIds {
  disassyCodeVariant?: string;
  infoCodeVariant?: string;
  itemLocationCode?: string;
  /** The first line of the <dmTitle> (techName); default: the model identification code. */
  techName?: string;
}

export interface GenOptions {
  /** Publishers and emblem live outside `frontMatter` (project.json `publishers`, the house template's emblem). */
  branding?: { publishers?: Publisher[]; emblem?: string };
  /** Where the project's data modules and graphics are, project-relative (default 'csdb'): ICN paths are written relative to it. */
  csdbDir?: string;
  /** Only these pages. Default: the enabled pages of frontMatter.pages, or every page the settings have content for. */
  pages?: PageId[];
}

export interface GenerateResult {
  dms: GeneratedDm[];
  /** One "Front matter" folder with a <dmRef> per module, in running order, for the project's publication module. */
  pmEntries: PmEntryOut[];
  /** What the publication header must carry for the settings to read back (book name, system name, date, classification). */
  pmMeta: Pick<PmMeta, 'pmTitle' | 'shortPmTitle' | 'securityClassification' | 'issueDate'>;
  /** Pages enabled but not generated, and why. */
  skipped: Array<{ page: PageId; reason: string }>;
  report: MappingEntry[];
}

// ── small writers ──────────────────────────────────────────────────────────────────────────────

const para = (text: unknown): string => (String(text ?? '').trim() ? `<para>${esc(String(text).trim())}</para>` : '<para />');
/** A label override. The engine stores them NESTED ({ labels: { handbooks: { colSr } } }); a flat "handbooks.colSr" key is accepted too. */
const labelAt = (labels: Record<string, any>, key: string): string | undefined => {
  if (typeof labels?.[key] === 'string') return labels[key];
  let cur: any = labels;
  for (const k of key.split('.')) cur = cur && typeof cur === 'object' ? cur[k] : undefined;
  return typeof cur === 'string' ? cur : undefined;
};
const label = (labels: Record<string, any>, key: string, fallback?: string): string => {
  const v = labelAt(labels, key);
  return typeof v === 'string' && v.trim() ? v : fallback ?? LABEL_DEFAULTS[key] ?? '';
};
const linesOfValue = (v: unknown): string[] =>
  (Array.isArray(v) ? v : [v]).flatMap((x) => String(x ?? '').split(/\r?\n/)).map((s) => s.trim()).filter(Boolean);

/** A page's graphics: ICN names declared in the DOCTYPE (`<!ENTITY name SYSTEM "file" NDATA fmt>`). */
class Graphics {
  readonly entities = new Map<string, { file: string; fmt: string }>();
  private byPath = new Map<string, string>();
  /** Graphics that live outside the CSDB folder: a data module cannot point at them (an entity path may not leave the CSDB), so they are left out and reported. */
  readonly outside = new Set<string>();
  constructor(private readonly csdbDir: string) {}

  private norm(projectPath: string): string { return String(projectPath).replace(/\\/g, '/').replace(/^\.\//, ''); }
  private inside(p: string): boolean {
    const rel = path.posix.relative(this.csdbDir || '.', p);
    return !!rel && !rel.startsWith('..') && !path.posix.isAbsolute(rel);
  }

  /** The entity name for a project-relative graphic path; declares it on first use. */
  ident(projectPath: string): string {
    const p = String(projectPath).replace(/\\/g, '/').replace(/^\.\//, '');
    const have = this.byPath.get(p);
    if (have) return have;
    const ext = path.posix.extname(p);
    const base = path.posix.basename(p, ext);
    let name = base.replace(/[^A-Za-z0-9._-]/g, '-');
    if (!/^[A-Za-z_]/.test(name)) name = `ICN-${name}`;
    let candidate = name;
    for (let n = 2; this.entities.has(candidate); n++) candidate = `${name}-${n}`;
    const fmt = (ext.slice(1) || 'png').toLowerCase().replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'png';
    const rel = path.posix.relative(this.csdbDir || '.', p) || path.posix.basename(p);
    this.entities.set(candidate, { file: rel, fmt });
    this.byPath.set(p, candidate);
    return candidate;
  }

  symbol(projectPath: string, scale?: string): string {
    const p = this.norm(projectPath);
    if (!this.inside(p)) { this.outside.add(p); return ''; }
    return `<symbol infoEntityIdent="${escAttr(this.ident(projectPath))}"${scale ? ` reproductionScale="${escAttr(scale)}"` : ''} />`;
  }

  doctype(): string {
    const fmts = [...new Set([...this.entities.values()].map((e) => e.fmt))];
    if (!this.entities.size) return '<!DOCTYPE dmodule []>';
    const pub: Record<string, string> = {
      png: '-//W3C//NOTATION Portable Network Graphics//EN',
      jpg: '+//ISBN 0-7923-9432-1::Graphic Notation//NOTATION Joint Photographic Experts Group Raster//EN',
      gif: '-//CompuServe//NOTATION Graphics Interchange Format 89a//EN',
      tif: '-//AIIM//NOTATION Tagged Image File Format//EN',
      svg: '-//W3C//NOTATION Scalable Vector Graphics//EN',
    };
    const lines = [
      ...fmts.map((f) => `<!NOTATION ${f} PUBLIC "${pub[f] ?? `-//Agastya//NOTATION ${f}//EN`}">`),
      ...[...this.entities].map(([n, e]) => `<!ENTITY ${n} SYSTEM "${escAttr(e.file).replace(/%/g, '%25')}" NDATA ${e.fmt}>`),
    ];
    return `<!DOCTYPE dmodule [${lines.join('\n')}]>`;
  }
}

/** The BREX the modules cite: the project's own when known, else the bundled default BREX of Issue 4.2. */
const brexOf = (ids: GenIds): Record<string, string> => (ids.brex && ids.brex.modelIdentCode ? ids.brex : { ...DEFAULT_BREX_42 });

const ATTR_ORDER = ['modelIdentCode', 'systemDiffCode', 'systemCode', 'subSystemCode', 'subSubSystemCode', 'assyCode', 'disassyCode', 'disassyCodeVariant', 'infoCode', 'infoCodeVariant', 'itemLocationCode'];
const dmCodeElement = (a: Record<string, string>): string => `<dmCode ${ATTR_ORDER.filter((k) => a[k] !== undefined).map((k) => `${k}="${escAttr(a[k])}"`).join(' ')} />`;

interface Context {
  fm: Record<string, any>;
  pub: Record<string, string>;
  labels: Record<string, any>;
  xign: Record<string, any>;
  branding: NonNullable<GenOptions['branding']>;
  g: Graphics;
  report: MappingEntry[];
}

// ── pages ──────────────────────────────────────────────────────────────────────────────────────

const lp = (inner: string): string => `<levelledPara>\n${inner}\n</levelledPara>`;
const lpTitle = (text: string, em03 = false): string => `<title>${em03 ? `<emphasis emphasisType="em03">${esc(text)}</emphasis>` : esc(text)}</title>`;
const cell = (inner: string, attrs = ''): string => `<entry${attrs ? ` ${attrs}` : ''}>${inner}</entry>`;
const row = (...cells: string[]): string => `<row>${cells.join('')}</row>`;

function titlePage(c: Context): string {
  const { fm, pub, labels, xign, branding, g } = c;
  const tp = fm.titlePage ?? {};
  const out: string[] = [];
  const add = (n: number, name: string, inner: string) => out.push(`<!-- [${n}] ${name} -->`, lp(inner));

  const pubLabel = (() => { const l = (labelAt(labels, 'titleJoint.publicationNo') || labelAt(labels, 'title.inbrNo') || '').trim(); return l && !l.includes('<<') ? l : 'Publication No.:'; })();
  const no = pub.publicationNo || pub.inbrNo || '';
  const one = [para(`${pubLabel} ${no}`.trim())];
  if (fm.revNo) one.push(para(`Rev. No.: ${fm.revNo}`));
  if (fm.codeNo) one.push(para(`Code No.: ${fm.codeNo}`));
  add(1, 'Publication No', one.join('\n'));
  add(2, 'First red text', para(tp.disclosureNotice));
  add(3, 'Logo', branding.emblem ? `<para>${g.symbol(branding.emblem)}</para>` : '<para />');
  add(4, 'Standard text', [para(tp.documentType), para(label(labels, 'title.for')), para(pub.systemName)].join('\n'));
  add(5, 'Pub Title', para(tp.repairNotice));

  const publishers = branding.publishers ?? [];
  const joint = !!fm.titlePageJoint || publishers.length > 1;
  const nsn = pub.nsn ? para(`${label(labels, 'titleJoint.nsn').trim()} ${pub.nsn}`) : '';
  const contract = pub.contractNo ? para(`${label(labels, 'titleJoint.contractNo').trim()} ${pub.contractNo}`) : '';
  if (joint) {
    add(6, 'NSN', nsn || '<para />');
    add(7, 'Contract', contract || '<para />');
  } else {
    add(6, 'Prepared & Published by', [para(label(labels, 'title.publishedBy')), nsn].filter(Boolean).join('\n'));
    const p = publishers[0];
    const block: string[] = [];
    if (p) {
      if (p.name) block.push(para(p.name));
      if (p.logo) block.push(`<para>${g.symbol(p.logo)}</para>`);
      for (const l of p.addressLines ?? []) block.push(para(l));
    }
    if (contract) block.push(contract);
    add(7, 'Publisher and contract', block.join('\n') || '<para />');
  }
  add(8, 'Second red text', para(xign.titlePage?.secondRedText));
  add(9, 'Jointly Prepared & Published by:', joint ? para(label(labels, 'titleJoint.publishedBy')) : '<para />');

  const parties: Array<{ logo?: string; lines: string[] }> = joint
    ? publishers.map((p) => ({ logo: p.logo, lines: [p.name, ...(p.addressLines ?? [])].filter(Boolean) }))
    : (Array.isArray(xign.titlePage?.parties) ? xign.titlePage.parties : []);
  if (parties.length) {
    const cols = Math.min(3, parties.length);
    const rows: string[] = [];
    for (let i = 0; i < parties.length; i += cols) {
      const chunk = parties.slice(i, i + cols);
      while (chunk.length < cols) chunk.push({ lines: [] });
      rows.push(row(...chunk.map((p) => cell([p.logo ? `<para>${g.symbol(p.logo)}</para>` : '', ...(p.lines ?? []).map(para)].filter(Boolean).join('') || '<para />'))));
    }
    const width = Math.floor(100 / cols);
    add(10, 'Parties', `<table pgwide="1">\n<tgroup cols="${cols}">\n${Array.from({ length: cols }, (_v, i) => `<colspec colname="col${i + 1}" align="center" colwidth="${width}*" />`).join('\n')}\n<tbody>\n${rows.join('\n')}\n</tbody>\n</tgroup>\n</table>`);
  } else add(10, 'Parties', '<para />');
  return out.join('\n');
}

function proprietary(c: Context): string {
  const p = c.fm.proprietary ?? {};
  const first = lp(`${lpTitle(pageDef('proprietary').label, true)}\n${para(p.text)}`);
  return p.applicability ? `${first}\n${lp(lpTitle(p.applicability))}` : first;
}

const hasText = (s: unknown): boolean => String(s ?? '').trim().length > 0;

function foreword(c: Context): string {
  const f = c.fm.foreword ?? {};
  const rows: string[] = [];
  const spacer = () => row(cell('<para />', 'namest="col1" nameend="col3"'));
  const item = (name: string, value: unknown) => {
    const lines = linesOfValue(value);
    rows.push(row(cell(para(name)), cell(para(':'), 'align="center"'), cell(lines.length ? lines.map(para).join('') : '<para />')));
  };
  item('E-mail Address', f.email);
  rows.push(spacer()); item('Postal Address', f.postalAddress);
  rows.push(spacer()); item('Telephone No.', f.telephone);
  rows.push(spacer()); item('Fax No.', f.fax);
  const table = `<table>\n<tgroup cols="3">\n<colspec colname="col1" colwidth="22*" />\n<colspec colname="col2" colwidth="10*" />\n<colspec colname="col3" colwidth="68*" />\n<tbody>\n${rows.join('\n')}\n</tbody>\n</tgroup>\n</table>`;
  const text = hasText(f.text) ? `<para><emphasis>${esc(String(f.text).trim())}</emphasis></para>\n` : '';
  return lp(`${lpTitle('Foreword', true)}\n${text}${table}`);
}

function recordOfChanges(c: Context): string {
  const n = Math.max(0, Math.min(200, Number(c.fm.recordOfChanges?.rows ?? 20) || 0));
  const heads = ['roc.colChangeNotice', 'roc.colAuthority', 'roc.colIncorporatedBy', 'roc.colInitials'].map((k) => label(c.labels, k));
  const widths = ['20*', '20*', '40*', '20*'];
  const thead = `<thead>\n${row(...heads.map((h) => cell(para(h), 'align="center"')))}\n</thead>`;
  const numbering = row(...[1, 2, 3, 4].map((i) => cell(para(`(${i})`), 'align="center"')));
  const blank = row(...[1, 2, 3, 4].map(() => cell('<para />')));
  const body = [numbering, ...Array.from({ length: n }, () => blank)].join('\n');
  return lp(`${lpTitle('Record of changes')}\n<table frame="all" colsep="1" rowsep="1">\n<tgroup cols="4">\n${widths.map((w, i) => `<colspec colname="col${i + 1}" colwidth="${w}" />`).join('\n')}\n${thead}\n<tbody>\n${body}\n</tbody>\n</tgroup>\n</table>`);
}

function associatedHandbooks(c: Context): string {
  const items: Array<Record<string, any>> = Array.isArray(c.fm.associatedHandbooks) ? c.fm.associatedHandbooks : [];
  const heads = ['handbooks.colSr', 'handbooks.colTitle', 'handbooks.colInbr'].map((k) => label(c.labels, k));
  const rows = items.map((h) => (h.group
    ? row(cell('<para>&#160;</para>', 'align="center"'), cell(`<para><emphasis>${esc(h.title)}</emphasis></para>`, 'namest="col2" nameend="col3"'))
    : row(cell(para(h.sr), 'align="center"'), cell(para(h.title)), cell(para(h.inbr), 'align="center"'))));
  const intro = c.xign.associatedHandbooks?.intro;
  const table = `<table frame="top" colsep="1" rowsep="1">\n<tgroup cols="3">\n<colspec colnum="1" colname="col1" colwidth="2cm" />\n<colspec colnum="2" colname="col2" colwidth="50*" />\n<colspec colnum="3" colname="col3" colwidth="30*" />\n<thead>\n${row(cell(para(heads[0]), 'align="center"'), cell(para(heads[1]), 'align="left"'), cell(para(heads[2]), 'align="center"'))}\n</thead>\n<tbody>\n${rows.join('\n') || row(cell('<para />'), cell('<para />'), cell('<para />'))}\n</tbody>\n</tgroup>\n</table>`;
  return lp(`${lpTitle('Associated handbooks')}\n${hasText(intro) ? `${para(intro)}\n` : ''}${table}`);
}

function safetyWarning(c: Context): string {
  const lines: Array<Record<string, any>> = Array.isArray(c.fm.safetyWarning) ? c.fm.safetyWarning : [];
  const heading = label(c.labels, 'safety.heading', 'Safety warning');
  const footer = label(c.labels, 'safety.footer');
  const inner = lines.filter((l) => hasText(l.text)).map((l) => lp(`<title>${l.strong ? `<emphasis>${esc(l.text)}</emphasis>` : esc(l.text)}</title>`)).join('\n');
  const first = lp(`${lpTitle(heading, true)}${inner ? `\n${inner}` : ''}`);
  return footer ? `${first}\n${lp(lpTitle(footer, true))}` : first;
}

function firstAid(c: Context): string {
  const fa = c.fm.firstAid ?? {};
  const figures: string[] = (Array.isArray(fa.figures) && fa.figures.length ? fa.figures : fa.figure ? [fa.figure] : []).filter(Boolean);
  const steps: Array<{ paras?: string[] }> = Array.isArray(fa.steps) ? fa.steps : [];
  const closing: string[] = (Array.isArray(fa.closing) ? fa.closing : []).filter(hasText);
  const total = Math.max(steps.length, 1) + (closing.length ? 1 : 0);
  const figCell = (): string => cell(figures.length ? figures.map((f) => `<para>${c.g.symbol(f)}</para>`).join('') : '<para />', `morerows="${total - 1}"`);
  const rows: string[] = [row(cell('<para />'), cell('<para />', 'rowsep="1"'), cell('<para />', 'rowsep="1"'))];
  if (!steps.length) rows.push(row(figCell(), cell('<para />', 'colsep="1" rowsep="1"'), cell('<para />', 'colsep="1" rowsep="1"')));
  steps.forEach((s, i) => {
    const ps = (s.paras ?? []).filter(hasText);
    rows.push(row(...(i === 0 ? [figCell()] : []), cell(para(`${i + 1}.`), 'colsep="1" rowsep="1"'), cell(ps.length ? ps.map(para).join('') : '<para />', 'colsep="1" rowsep="1"')));
  });
  if (closing.length) rows.push(row(cell(closing.map((t) => `<para><emphasis>${esc(t)}</emphasis></para>`).join(''), 'namest="col2" nameend="col3" colsep="1" rowsep="1"')));
  const table = `<table frame="none">\n<tgroup cols="3">\n<colspec colname="col1" colwidth="35*" />\n<colspec colname="col2" colwidth="5*" />\n<colspec colname="col3" colwidth="60*" />\n<tbody>\n${rows.join('\n')}\n</tbody>\n</tgroup>\n</table>`;
  return lp(`${lpTitle('First aid in case of electric shock')}\n${table}`);
}

function cautionsNotes(c: Context): string {
  const items = (Array.isArray(c.fm.cautionsNotes) ? c.fm.cautionsNotes : []).filter(hasText);
  const list = items.length ? `\n<para><randomList>${items.map((t: string) => `<listItem>${para(t)}</listItem>`).join('')}</randomList></para>` : '';
  return lp(`${lpTitle('Cautions/ Notes')}${list}`);
}

function demolition(c: Context): string {
  const parts: Array<Record<string, any>> = Array.isArray(c.fm.demolition?.parts) ? c.fm.demolition.parts : [];
  const items = parts.map((p) => {
    const inner: string[] = [];
    if (hasText(p.title)) inner.push(`<para><emphasis>${esc(String(p.title).trim())}</emphasis></para>`);
    for (const t of (p.paras ?? []).filter(hasText)) inner.push(para(t));
    const sub = (p.items ?? []).filter(hasText);
    if (sub.length && p.listType && p.listType !== 'roman') c.report.push({ page: 'demolition', field: `list type "${p.listType}"`, status: 'ignored', detail: 'Xignal writes a demolition sub-list as a sequential list; the type is not carried in the module, so it reads back as "roman".' });
    if (sub.length) inner.push(`<para><sequentialList>${sub.map((t: string) => `<listItem>${para(t)}</listItem>`).join('')}</sequentialList></para>`);
    return `<listItem>${inner.join('') || '<para />'}</listItem>`;
  });
  return lp(`${lpTitle('Demolition of material to prevent enemy use')}${items.length ? `\n<para><sequentialList>${items.join('')}</sequentialList></para>` : ''}`);
}

function changeNotice(c: Context): string {
  const cn = c.xign.changeNotice ?? {};
  const inner = `${cn.logo ? c.g.symbol(cn.logo) : ''}${cn.logo && cn.text ? ' ' : ''}${cn.text ? esc(cn.text) : ''}`;
  return lp(`${lpTitle('Change notice')}${inner ? `\n<para>${inner}</para>` : ''}`);
}

function listOfAbbreviations(c: Context): string {
  const items: Array<{ term: string; meaning: string }> = (Array.isArray(c.fm.listOfAbbreviations) ? c.fm.listOfAbbreviations : []).filter((a: any) => a && hasText(a.term));
  if (!items.length) return '<!-- List of abbreviations: the table is built from the <acronym> markup of the publication and from the entries in the front-matter settings. -->';
  const heads = ['abbrev.colTerm', 'abbrev.colMeaning'].map((k) => label(c.labels, k));
  return `<table frame="top" rowsep="1">\n<tgroup cols="2">\n<colspec colnum="1" colname="col1" colwidth="20*" />\n<colspec colnum="2" colname="col2" colwidth="80*" />\n<thead>\n${row(cell(para(heads[0])), cell(para(heads[1])))}\n</thead>\n<tbody>\n${items.map((a) => row(cell(para(a.term)), cell(para(a.meaning)))).join('\n')}\n</tbody>\n</tgroup>\n</table>`;
}

function descriptionOfSymbols(c: Context): string {
  const symbols: Array<{ icon: string; text: string }> = Array.isArray(c.fm.descriptionOfSymbols) ? c.fm.descriptionOfSymbols : [];
  const lg = c.fm.noticeLegends;
  const legends = lg && (hasText(lg.note) || hasText(lg.warning) || hasText(lg.caution))
    ? `${hasText(lg.note) ? `<note><notePara>${esc(lg.note)}</notePara></note>` : ''}${hasText(lg.warning) ? `<warning><warningAndCautionPara>${esc(lg.warning)}</warningAndCautionPara></warning>` : ''}${hasText(lg.caution) ? `<caution><warningAndCautionPara>${esc(lg.caution)}</warningAndCautionPara></caution>` : ''}`
    : '';
  const rows = symbols.map((s, i) => row(
    cell(s.icon ? `<para>${c.g.symbol(s.icon)}</para>` : '<para />'),
    cell(para(s.text)),
    ...(i === 0 && legends ? [cell(legends, `morerows="${Math.max(symbols.length - 1, 0)}"`)] : [])));
  if (!rows.length && legends) rows.push(row(cell('<para />'), cell('<para />'), cell(legends)));
  if (!rows.length) return '<!-- Description of symbols: no symbols are defined in the front-matter settings. -->';
  return `<table>\n<tgroup cols="3">\n<colspec colnum="1" colwidth="10*" />\n<colspec colnum="2" colwidth="40*" />\n<colspec colnum="3" colwidth="50*" />\n<tbody>\n${rows.join('\n')}\n</tbody>\n</tgroup>\n</table>`;
}

function systemName(c: Context): string {
  const imgs: string[] = (Array.isArray(c.fm.systemImages) ? c.fm.systemImages : []).map((v: any) => (v && v.src ? v.src : v)).filter((v: unknown) => typeof v === 'string' && v);
  return lp(`${lpTitle('System Name')}${imgs.length ? `\n${imgs.map((i) => `<para>${c.g.symbol(i)}</para>`).join('\n')}` : ''}`);
}

const placeholder = (what: string): string => `<!-- ${what}: built by the publisher from the publication; the module only marks the page as present. -->`;

const BUILDERS: Record<PageId, (c: Context) => string> = {
  titlePage, proprietary, foreword, recordOfChanges, associatedHandbooks, safetyWarning, firstAid, cautionsNotes, demolition, changeNotice,
  listOfAbbreviations, listOfContents: () => placeholder('List of contents'), listOfFigures: () => placeholder('List of figures'),
  listOfTables: () => placeholder('List of tables'), systemNamePage: systemName, descriptionOfSymbols,
  listOfAnnexures: () => placeholder('List of annexures'),
};

/** Pages that exist in the engine only when their settings key does (frontmatter.js writes a page "ONLY when its settings key exists"). */
const NEEDS_KEY: Partial<Record<PageId, string>> = {
  proprietary: 'proprietary', foreword: 'foreword', recordOfChanges: 'recordOfChanges', associatedHandbooks: 'associatedHandbooks', safetyWarning: 'safetyWarning',
  firstAid: 'firstAid', cautionsNotes: 'cautionsNotes', demolition: 'demolition', changeNotice: 'changeNotice', listOfAbbreviations: 'listOfAbbreviations', descriptionOfSymbols: 'descriptionOfSymbols',
};

const TITLES: Record<PageId, { tech?: (c: Context) => string; info: (c: Context) => string }> = Object.fromEntries(
  PAGE_DEFS.map((d) => [d.page, { info: () => d.label }]),
) as never;

/** The pages a generation covers, in running order. */
export function pagesToGenerate(fm: Record<string, any>, only?: PageId[]): PageId[] {
  const enginePages: Array<{ id: string; enabled: boolean }> = vendor('engine/frontMatterPages').resolvePages(Array.isArray(fm.pages) && fm.pages.length ? { pages: fm.pages } : null);
  const hasPages = Array.isArray(fm.pages) && fm.pages.length;
  const order: PageId[] = [];
  for (const p of enginePages) {
    if (!p.enabled) continue;
    if (p.id === 'titlePageJoint') continue;                                // the joint and the single title page are one Xignal module
    if (PAGE_DEFS.some((d) => d.page === p.id)) order.push(p.id as PageId);
  }
  // Xignal's list of annexures has no engine page: it travels in frontMatter.xignal and is placed after the page it followed.
  const an = fm.xignal?.listOfAnnexures;
  if (an && an.enabled !== false) {
    const at = an.after ? order.indexOf(an.after) : -1;
    order.splice(at >= 0 ? at + 1 : order.length, 0, 'listOfAnnexures');
  }
  const wanted = only ? order.filter((p) => only.includes(p)) : order;
  // Without a saved page list nothing says what the author wants, so only pages with content (or that need none) are made.
  return wanted.filter((p) => hasPages || only || !NEEDS_KEY[p] || fm[NEEDS_KEY[p]!] !== undefined);
}

// ── the generator ──────────────────────────────────────────────────────────────────────────────

const pad = (n: string, width: number): string => String(n).padStart(width, '0');

export function dmsFromFrontMatter(frontMatter: Record<string, any>, publication: Record<string, any>, idsIn: GenIds = {}, options: GenOptions = {}): GenerateResult {
  const fm = frontMatter && typeof frontMatter === 'object' ? frontMatter : {};
  const pub: Record<string, string> = Object.fromEntries(Object.entries(publication ?? {}).map(([k, v]) => [k, String(v ?? '')]));
  const csdbDir = (options.csdbDir ?? 'csdb').replace(/\\/g, '/').replace(/\/+$/, '');
  const report: MappingEntry[] = [];
  const model = String(idsIn.modelIdentCode || 'JSS0251').toUpperCase();
  const diff = String(idsIn.systemDiffCode || 'A').toUpperCase();
  const lang = String(idsIn.languageIsoCode || 'en').toLowerCase();
  const ctry = String(idsIn.countryIsoCode || 'US').toUpperCase();
  const issue = pad(idsIn.issueNumber || '1', 3);
  const inWork = pad(idsIn.inWork || '0', 2);
  const infoVar = idsIn.infoCodeVariant || 'A';
  const disVar = idsIn.disassyCodeVariant || 'A';
  const loc = idsIn.itemLocationCode || 'A';
  const security = /^\d{2}$/.test(idsIn.security ?? '') ? (idsIn.security as string) : '01';
  const rpc = idsIn.rpc ?? { enterpriseCode: '00000', enterpriseName: 'Agastya' };
  const originator = idsIn.originator ?? rpc;
  const now = new Date();
  const issueDate = idsIn.issueDate ?? { year: String(now.getUTCFullYear()), month: pad(String(now.getUTCMonth() + 1), 2), day: pad(String(now.getUTCDate()), 2) };
  const brex = brexOf(idsIn);

  const pages = pagesToGenerate(fm, options.pages);
  const skipped: GenerateResult['skipped'] = [];
  if (fm.pages === undefined && !options.pages) {
    for (const d of PAGE_DEFS) if (!pages.includes(d.page) && NEEDS_KEY[d.page]) skipped.push({ page: d.page, reason: `frontMatter.${NEEDS_KEY[d.page]} is not set: the engine prints its own default page and there is nothing to write.` });
  }

  const dms: GeneratedDm[] = [];
  const pmEntries: PmEntryOut[] = [];
  for (const page of pages) {
    const def: PageDef = pageDef(page);
    const g = new Graphics(csdbDir);
    const ctx: Context = {
      fm, pub, labels: (fm.labels && typeof fm.labels === 'object' ? fm.labels : {}) as Record<string, any>, xign: (fm.xignal && typeof fm.xignal === 'object' ? fm.xignal : {}) as Record<string, any>,
      branding: options.branding ?? {}, g, report,
    };
    const body = BUILDERS[page](ctx);
    for (const p of g.outside) report.push({ page, field: `graphic ${p}`, status: 'ignored', detail: `Not in the CSDB folder (${csdbDir || '.'}): a data module cannot reference a graphic outside it, so it is left out of this page. Put the file in the CSDB folder to include it.` });
    const codeAttrs: Record<string, string> = {
      modelIdentCode: model, systemDiffCode: diff, systemCode: '00', subSystemCode: '0', subSubSystemCode: '0', assyCode: '00',
      disassyCode: def.disassy, disassyCodeVariant: disVar, infoCode: def.infoCode, infoCodeVariant: infoVar, itemLocationCode: loc,
    };
    const techName = idsIn.techName || model;
    const infoName = TITLES[page].info(ctx);
    const dmc = `DMC-${[model, diff, '00', '00', '00', `${def.disassy}${disVar}`, `${def.infoCode}${infoVar}`, loc].join('-')}`;
    const file = `${dmc}_${issue}-${inWork}_${lang.toUpperCase()}-${ctry}.xml`;
    const xml = [
      '<?xml version="1.0" encoding="utf-8"?>',
      '<!-- S1000D Issue 4.2 [xml_schema_flat]. Generated by Agastya Platform from the publication front-matter settings (Xignal JSS-0251 convention). Edit the settings and generate again. -->',
      generatedMarker(page),
      g.doctype(),
      '<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dc="http://www.purl.org/dc/elements/1.1/" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/descript.xsd">',
      '<identAndStatusSection>',
      '<dmAddress>',
      '<dmIdent>',
      dmCodeElement(codeAttrs),
      `<language languageIsoCode="${escAttr(lang)}" countryIsoCode="${escAttr(ctry)}" />`,
      `<issueInfo issueNumber="${issue}" inWork="${inWork}" />`,
      '</dmIdent>',
      '<dmAddressItems>',
      `<issueDate year="${escAttr(issueDate.year)}" month="${escAttr(issueDate.month)}" day="${escAttr(issueDate.day)}" />`,
      `<dmTitle><techName>${esc(techName)}</techName><infoName>${esc(infoName)}</infoName></dmTitle>`,
      '</dmAddressItems>',
      '</dmAddress>',
      '<dmStatus issueType="new">',
      `<security securityClassification="${escAttr(security)}" />`,
      `<responsiblePartnerCompany enterpriseCode="${escAttr(rpc.enterpriseCode)}"><enterpriseName>${esc(rpc.enterpriseName)}</enterpriseName></responsiblePartnerCompany>`,
      `<originator enterpriseCode="${escAttr(originator.enterpriseCode)}"><enterpriseName>${esc(originator.enterpriseName)}</enterpriseName></originator>`,
      '<applic><displayText><simplePara>All</simplePara></displayText></applic>',
      `<brexDmRef><dmRef><dmRefIdent>${dmCodeElement(brex)}</dmRefIdent></dmRef></brexDmRef>`,
      '<qualityAssurance><unverified /></qualityAssurance>',
      '</dmStatus>',
      '</identAndStatusSection>',
      '<content>',
      '<description>',
      body,
      '</description>',
      '</content>',
      '</dmodule>',
      '',
    ].join('\n');
    dms.push({ file, xml, page, infoCode: def.infoCode, dmc, techName, infoName, dmCodeAttrs: codeAttrs });
    pmEntries.push({
      type: 'dm', title: def.label, dmCode: codeAttrs, issueInfo: { issueNumber: issue, inWork }, language: { languageIsoCode: lang, countryIsoCode: ctry },
      techName, infoName,
    });
    report.push({ page, field: def.label, status: 'mapped', detail: `-> ${file}`, file });
  }
  for (const s of skipped) report.push({ page: s.page, field: pageDef(s.page).label, status: 'defaulted', detail: s.reason });

  const sec = pub.securityClassification ? securityCodeOf(pub.securityClassification) : security;
  const validSec = /^\d{2}$/.test(sec) ? sec : security;
  if (pub.securityClassification && validSec !== sec) report.push({ page: 'pm', field: 'securityClassification', status: 'not-understood', detail: `"${pub.securityClassification}" is not a two-digit S1000D security class; ${validSec} is written to the publication header.` });
  const pmMeta: GenerateResult['pmMeta'] = {
    pmTitle: pub.bookName || '',
    shortPmTitle: pub.systemName || undefined,
    securityClassification: validSec,
    issueDate: { year: pub.year || issueDate.year, month: pub.month ? pad(pub.month, 2) : issueDate.month, day: issueDate.day },
  };
  return { dms, pmEntries: dms.length ? [{ type: 'folder', title: 'Front matter', children: pmEntries }] : [], pmMeta, skipped, report };
}
