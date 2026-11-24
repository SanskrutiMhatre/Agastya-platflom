// JSS authoring: the project's source document, its validation, and the book the publishing pipeline is fed.
//
// The source of truth is ONE XML file per project (`publication.xml`, root <jssbook>, validated against schemas/jss/jss-1.0.xsd). It holds
// only what the author writes: the identity of the publication and the body. The shared frame (title pages ... symbols), the emblem
// and publishers come from the project's Settings and are added when a PDF is built (composeBook), so the same frame is printed for every document
// type and the author cannot let one type drift from another.
//
// Saving is permissive in the same way the S1000D side is: malformed XML is refused; well-formed XML that breaks the schema or the
// stencil's rules is a draft and is saved. A PDF is only built from a document that has just been checked (assertJssPublishable).
import fs from 'fs';
import crypto from 'crypto';
import path from 'path';
import { config, vendor } from '../../config';
import { projectDirFor } from '../../context';
import { bad, conflict, HttpError } from '../http';
import { parseTree, walk, norm, type MNode } from '../miniXml';
import { wellFormedError } from '../wellFormed';
import { readProjectJson, updateProjectJson, pmRel } from '../projects';
import { jssTypeById, type JssDocType, type OutlineNode, type TableTemplate } from './registry';

const { validateXML } = require('xmllint-wasm');
const { bookmetaXml } = vendor('engine/frontmatterInject');
const { enabledPages } = vendor('engine/frontMatterPages');
const { generateFrontMatter } = vendor('engine/frontmatter');

export const JSS_SCHEMA_VERSION = '1.0';
export const JSS_XSD = path.join(config.schemasDir, 'jss', 'jss-1.0.xsd');
export const COMPOSED_NAME = '_jss-book.xml';

export interface JssFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JssReport { docType: string | null; valid: boolean; errors: number; warnings: number; findings: JssFinding[]; validatedAt: string }

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;');
export const sha = (text: string): string => crypto.createHash('sha256').update(text).digest('hex');

// ── Which projects are JSS-authored ─────────────────────────────────────────────────────────────────────────────────────────────

/** A project whose source is a JSS document written in the JSS editor (not S1000D data modules, and not an imported jssbook). */
export function isJssAuthored(projectId: string): boolean {
  return readProjectJson(projectId).authoring === 'jss-xml';
}
export const jssTypeOfProject = (projectId: string): JssDocType | undefined => jssTypeById(readProjectJson(projectId).jssDocType);

export function sourcePath(projectId: string): string {
  return path.join(projectDirFor(projectId), pmRel(readProjectJson(projectId)));
}

// ── A new document ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface NewDocInput { bookName?: string; systemName?: string }

/** The columns of a stencil table: the cells of the first head row, each as wide as it spans. */
export const columnsOf = (t: TableTemplate): number => t.head[0].reduce((n, c) => n + (c.colspan ?? 1), 0);

/** A stencil table as XML: its head as the stencil merges it, and `blankRows` empty rows for the author to fill. */
export function tableXml(t: TableTemplate, id: string, pad: string): string {
  const cell = (c: { text: string; colspan?: number; rowspan?: number }): string =>
    `<cell${c.colspan && c.colspan > 1 ? ` colspan="${c.colspan}"` : ''}${c.rowspan && c.rowspan > 1 ? ` rowspan="${c.rowspan}"` : ''}>${esc(c.text)}</cell>`;
  const head = t.head.map((r) => `${pad}    <row>${r.map(cell).join('')}</row>`).join('\n');
  const empty = `${pad}    <row>${'<cell/>'.repeat(columnsOf(t))}</row>`;
  const body = Array.from({ length: Math.max(1, t.blankRows) }, () => empty).join('\n');
  return `${pad}<table id="${id}" widths="${t.widths}">\n${t.caption ? `${pad}  <title>${esc(t.caption)}</title>\n` : ''}${pad}  <thead>\n${head}\n${pad}  </thead>\n${pad}  <tbody>\n${body}\n${pad}  </tbody>\n${pad}</table>`;
}

interface Skeleton { ids: { n: number }; page?: string }

/** The starting outline of a type: the stencil's own headings and the tables it puts under them, and nothing the stencil does not have. Examples ("Assembly-1") are left out. */
function outlineXml(nodes: OutlineNode[], depth: number, sk: Skeleton): string {
  const pad = '  '.repeat(depth + 1);
  return nodes.filter((n) => !n.example).map((n, i) => {
    const id = `${depth === 0 ? 'c' : 's'}${++sk.ids.n}`;
    const open = depth === 0 ? `<chapter number="${i + 1}" id="${id}"${sk.page ? ` orientation="${sk.page}"` : ''}>` : `<section id="${id}">`;
    const close = depth === 0 ? '</chapter>' : '</section>';
    const own: string[] = [];
    if (n.intro) own.push(`${pad}  <para>${esc(n.intro)}</para>`);
    if (n.table) own.push(tableXml(n.table, `t${++sk.ids.n}`, `${pad}  `));
    if (n.figuresHeading) own.push(`${pad}  <pageBreak/>`, `${pad}  <para align="center"><b>${esc(n.figuresHeading)}</b></para>`);
    const kids = n.children?.some((c) => !c.example) ? outlineXml(n.children, depth + 1, sk) : '';
    const inner = [...own, kids].filter(Boolean).join('\n');
    return `${pad}${open}<title>${esc(n.title)}</title>${inner ? '\n' + inner + '\n' + pad : ''}${close}`;
  }).join('\n');
}

/** The starting document for a type: the stencil's own chapters and sections, and nothing the stencil does not have. */
export function skeletonXml(type: JssDocType, input: NewDocInput = {}): string {
  if (!type.ready || !type.chapters) throw bad(`${type.label}: ${type.notReady ?? 'not available yet'}`, 'JSS_TYPE_NOT_READY');
  const now = new Date();
  const month = now.toLocaleString('en-GB', { month: 'long' });
  const sk: Skeleton = { ids: { n: 0 }, page: type.bodyPage };
  return `<?xml version="1.0" encoding="UTF-8"?>
<jssbook docType="${type.id}" schemaVersion="${JSS_SCHEMA_VERSION}">
  <bookmeta>
    <bookName>${esc(input.bookName?.trim() || type.defaultBookName)}</bookName>
    <systemName>${esc(input.systemName?.trim() ?? '')}</systemName>
    <month>${month}</month>
    <year>${now.getFullYear()}</year>
  </bookmeta>
  <body>
${outlineXml(type.chapters, 0, sk)}
  </body>
</jssbook>
`;
}

// ── Reading and writing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function readSource(projectId: string): { xml: string; hash: string } {
  const abs = sourcePath(projectId);
  if (!fs.existsSync(abs)) throw bad('This project has no JSS document yet.', 'NO_JSS_DOCUMENT');
  const xml = fs.readFileSync(abs, 'utf8');
  return { xml, hash: sha(xml) };
}

/** Save the authored XML. Malformed text is refused; a draft that breaks the schema is kept and reported. `baseHash` guards against saving over someone else's newer save. */
export async function writeSource(projectId: string, xml: string, baseHash?: string): Promise<{ hash: string; report: JssReport }> {
  if (typeof xml !== 'string' || !xml.trim()) throw bad('There is no document to save.', 'EMPTY');
  if (Buffer.byteLength(xml) > 50 * 1024 * 1024) throw bad('The document is larger than 50 MB.', 'TOO_LARGE');
  const wf = wellFormedError(xml);
  if (wf) throw new HttpError(400, `The document is not well-formed XML: ${wf}`, 'MALFORMED_XML');
  const abs = sourcePath(projectId);
  const current = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (baseHash && current !== null && sha(current) !== baseHash) throw conflict('The document was saved by someone else since you opened it. Reload to see their changes.', 'STALE_DOCUMENT');
  const declared = /<jssbook\b[^>]*\bdocType="([^"]+)"/.exec(xml)?.[1];
  const type = jssTypeOfProject(projectId);
  if (type && declared && declared !== type.id) throw bad(`This project is a ${type.label}; the document says it is "${declared}".`, 'DOCTYPE_MISMATCH');
  fs.writeFileSync(abs, xml, 'utf8');
  return { hash: sha(xml), report: await validateJss(projectId, xml) };
}

// ── Validation: the schema, then the stencil's rules ────────────────────────────────────────────────────────────────────────────

const apos = (s: string): string => s.replace(/[‘’]/g, "'");
const sameTitle = (a: string, b: string): boolean => apos(norm(a)).toLowerCase() === apos(norm(b)).toLowerCase();
const titleOf = (n: MNode): string => { const t = n.children.find((c) => c.name === 'title'); return t ? norm(t.text) : ''; };
const loc = (n: MNode): string => n.path.replace(/\[1\]/g, '');

let xsdText: string | null = null;
const schemaText = (): string => (xsdText ??= fs.readFileSync(JSS_XSD, 'utf8'));

/**
 * The grid a table's rows make once merged cells are taken into account: how many columns it has, and whether the cells fit it exactly (no gap, no overlap, no row span that runs
 * past the last row). A table without merged cells is the simple case of the same rule: every row must have the same number of columns.
 */
export function gridOf(rows: MNode[]): { columns: number; problem: string | null } {
  const occupied: number[] = [];                       // for each column, how many further rows a cell from above still covers
  let columns = 0; let problem: string | null = null;
  const widths: number[] = [];
  rows.forEach((row, r) => {
    let col = 0;
    for (const cell of row.children.filter((c) => c.name === 'cell')) {
      while ((occupied[col] ?? 0) > 0) col += 1;
      const cs = Number(cell.attrs.colspan) || 1; const rs = Number(cell.attrs.rowspan) || 1;
      if (r + rs > rows.length && !problem) problem = `a cell in row ${r + 1} spans ${rs} rows but only ${rows.length - r} remain.`;
      for (let k = 0; k < cs; k += 1) { if ((occupied[col + k] ?? 0) > 0 && !problem) problem = `cells overlap in row ${r + 1}.`; occupied[col + k] = rs; }
      col += cs;
    }
    while ((occupied[col] ?? 0) > 0) col += 1;         // columns still covered from above, at the end of the row
    widths.push(col); columns = Math.max(columns, col);
    for (let k = 0; k < occupied.length; k += 1) if ((occupied[k] ?? 0) > 0) occupied[k] -= 1;
  });
  if (!problem && widths.some((w) => w !== widths[0])) problem = `the rows do not all have the same number of columns (${[...new Set(widths)].join(', ')}).`;
  return { columns, problem };
}

/** Validate a JSS document: well-formedness, the XSD, then the rules of its document type. `projectId` lets the check also see that pictures exist. */
export async function validateJss(projectId: string | null, xml: string): Promise<JssReport> {
  const findings: JssFinding[] = [];
  const add = (severity: JssFinding['severity'], rule: string, message: string, n: MNode | null, line = n?.line ?? 1) => findings.push({ severity, rule, message, line, location: n ? loc(n) : '/' });
  const done = (docType: string | null): JssReport => {
    const errors = findings.filter((f) => f.severity === 'error').length;
    return { docType, valid: errors === 0, errors, warnings: findings.length - errors, findings, validatedAt: new Date().toISOString() };
  };

  const wf = wellFormedError(xml);
  if (wf) { add('error', 'JSS-WELLFORMED', `Not well-formed XML: ${wf}`, null); return done(null); }

  // 1. the schema
  try {
    const res = await validateXML({ xml: [{ fileName: 'document.xml', contents: xml }], schema: [{ fileName: 'jss-1.0.xsd', contents: schemaText() }] });
    for (const e of res.errors || []) {
      add('error', 'JSS-SCHEMA', String(e.message).replace(/^Schemas validity error\s*:\s*/, '').replace(/^Element '([^']+)'/, "<$1>").slice(0, 400), null, (e.loc && e.loc.lineNumber) || 1);
    }
  } catch (e) {
    add('error', 'JSS-SCHEMA-RUN', `The schema check could not run: ${(e as Error).message.slice(0, 200)}`, null);
    return done(null);
  }

  // 2. the document type's rules (only when the structure was readable)
  let root: MNode;
  try { root = parseTree(xml); } catch { return done(null); }
  if (root.name !== 'jssbook') return done(null);
  const docType = root.attrs.docType ?? null;
  const type = jssTypeById(docType);
  if (!type) { add('error', 'JSS-DOCTYPE', `Unknown document type "${docType}".`, root); return done(docType); }
  if (!type.ready) { add('error', 'JSS-DOCTYPE-NOT-READY', `${type.label}: ${type.notReady}`, root); return done(docType); }

  const body = root.children.find((c) => c.name === 'body');
  const chapters = body?.children.filter((c) => c.name === 'chapter') ?? [];
  const expected = type.chapters ?? [];

  // A table the stencil fixes: the columns must be the stencil's (the pipeline lays the table out on them), the head should be (its wording is the author's to adapt:
  // figures and brackets are not compared, and a cell the stencil marks `open` ("Recommended Nos. for 52 Systems for Two Years") is only required to be there).
  const headKey = (s: string): string => norm(s).toLowerCase().replace(/\([^)]*\)/g, '').replace(/[^a-z]/g, '');
  const headOf = (t: MNode): string[] => (t.children.find((c) => c.name === 'thead')?.children ?? []).filter((r) => r.name === 'row').flatMap((r) => r.children.filter((c) => c.name === 'cell').map((c) => headKey(c.text)));
  const checkTemplate = (t: MNode, tpl: TableTemplate, what: string): void => {
    let cols = 0;
    for (const g of t.children.filter((c) => c.name === 'thead' || c.name === 'tbody')) cols = Math.max(cols, gridOf(g.children.filter((r) => r.name === 'row')).columns);
    const want = columnsOf(tpl);
    if (cols !== want) { add('error', 'JSS-TABLE-TEMPLATE', `${what} has ${cols} column${cols === 1 ? '' : 's'}; the stencil's has ${want}.`, t); return; }
    if (!t.children.some((c) => c.name === 'thead')) { add('error', 'JSS-TABLE-TEMPLATE', `${what} has no head row; the stencil's head is: ${tpl.head[0].map((c) => c.text).join(' | ')}.`, t); return; }
    const have = headOf(t); const exp = tpl.head.flatMap((r) => r.map((c) => (c.open ? '' : headKey(c.text))));
    if (have.length !== exp.length || exp.some((e, i) => e && e !== have[i])) add('warning', 'JSS-TABLE-HEAD', `${what}: the head differs from the stencil's (${tpl.head[0].map((c) => c.text).join(' | ')}).`, t);
  };

  if (type.chapterRule === 'free') {
    // the chapters are the author's (one per system or sub-system); the stencil only requires that there is at least one
    if (!chapters.length) add('error', 'JSS-CHAPTERS', `A ${type.label} has at least one chapter (one for each system or sub-system it covers).`, body ?? root);
  } else if (chapters.length !== expected.length || chapters.some((c, i) => !sameTitle(titleOf(c), expected[i].title))) {
    // the stencil fixes the chapters and their order
    const have = chapters.map(titleOf);
    const missing = expected.filter((e) => !have.some((h) => sameTitle(h, e.title))).map((e) => e.title);
    const extra = have.filter((h) => !expected.some((e) => sameTitle(h, e.title)));
    const why = [missing.length ? `missing: ${missing.join('; ')}` : '', extra.length ? `not in the stencil: ${extra.join('; ')}` : '', !missing.length && !extra.length ? 'the order differs' : ''].filter(Boolean).join(' | ');
    add('error', 'JSS-CHAPTERS', `A ${type.label} has the ${expected.length} chapter${expected.length === 1 ? '' : 's'} of its stencil, in order (${why}).`, body ?? root);
  }
  chapters.forEach((c, i) => { if (Number(c.attrs.number) !== i + 1) add('error', 'JSS-CHAPTER-NUMBER', `Chapter "${titleOf(c)}" is numbered ${c.attrs.number}; its position makes it chapter ${i + 1}.`, c); });
  // a stencil on landscape pages sets every chapter on them (the pipeline reads it from the chapter)
  if (type.bodyPage) chapters.forEach((c) => { if (c.attrs.orientation !== type.bodyPage) add('warning', 'JSS-PAGE', `The stencil of a ${type.label} sets its pages ${type.bodyPage}; chapter "${titleOf(c)}" is ${c.attrs.orientation ?? 'portrait'}.`, c); });
  // the Complete Equipment Schedule's stencil also fixes the sections under its chapter
  if (type.sectionsFixed && type.chapterRule !== 'free') {
    chapters.forEach((c, i) => {
      const want = (expected[i]?.children ?? []).filter((n) => !n.example).map((n) => n.title);
      const have = c.children.filter((k) => k.name === 'section').map(titleOf);
      if (want.length !== have.length || want.some((w, k) => !sameTitle(w, have[k]))) add('error', 'JSS-SECTIONS', `Chapter "${titleOf(c)}" has the sections of its stencil, in order: ${want.join('; ')}.`, c);
      // each of those sections holds the table the stencil gives it
      (expected[i]?.children ?? []).filter((n) => !n.example && n.table).forEach((n) => {
        const sec = c.children.find((k) => k.name === 'section' && sameTitle(titleOf(k), n.title));
        if (!sec) return;
        const tables = sec.children.filter((k) => k.name === 'table');
        if (!tables.length) add('error', 'JSS-TABLE-MISSING', `The section "${n.title}" has no table; the stencil puts one there.`, sec);
        tables.forEach((tb) => checkTemplate(tb, n.table!, `The table of "${n.title}"`));
      });
    });
  }

  // headings: depth
  const depthOf = (n: MNode): number => { let d = 1; for (let p = n.parent; p; p = p.parent) if (p.name === 'section' || p.name === 'chapter') d++; return d; };
  for (const n of walk(root)) {
    if (n.name === 'section' && depthOf(n) > type.maxDepth) add('error', 'JSS-DEPTH', `"${titleOf(n)}" is heading level ${depthOf(n)}; the stencil defines headings to level ${type.maxDepth}.`, n);
  }

  // cross-references: libxml2's schema check does not resolve IDREFs, so a reference to nothing is caught here
  const ids = new Set<string>();
  for (const n of walk(root)) if (n.attrs.id) ids.add(n.attrs.id);
  for (const n of walk(root)) if (n.name === 'xref' && n.attrs.to && !ids.has(n.attrs.to)) add('error', 'JSS-XREF', `A cross-reference points at "${n.attrs.to}", which is not in this document.`, n);

  // tables: the stencil captions every table; rows must agree on the number of columns
  for (const t of walk(root)) {
    if (t.name === 'table') {
      if (type.captionTables !== false && !t.children.some((c) => c.name === 'title')) add('warning', 'JSS-TABLE-CAPTION', 'A table without a caption: the stencil numbers and captions every table ("Table 11: ...").', t);
      if (type.tableTemplate) checkTemplate(t, type.tableTemplate, 'This table');
      const spec = t.attrs.widths && t.attrs.widths.trim().split(/\s+/).length;
      let cols = 0; const byGroup: Record<string, number> = {};
      for (const g of t.children.filter((c) => c.name === 'thead' || c.name === 'tbody')) {
        const grid = gridOf(g.children.filter((r) => r.name === 'row'));
        if (grid.problem) add('error', 'JSS-TABLE-SHAPE', `${g.name === 'thead' ? 'The header' : 'The table body'}: ${grid.problem}`, t);
        byGroup[g.name] = grid.columns; cols = Math.max(cols, grid.columns);
      }
      if (byGroup.thead && byGroup.tbody && byGroup.thead !== byGroup.tbody) add('error', 'JSS-TABLE-SHAPE', `The header has ${byGroup.thead} columns and the body ${byGroup.tbody}: they must be the same.`, t);
      if (spec && cols && spec !== cols) add('error', 'JSS-TABLE-WIDTHS', `The column widths name ${spec} columns; the table has ${cols}.`, t);
    } else if (t.name === 'figure') {
      if (!t.children.some((c) => c.name === 'title')) add('warning', 'JSS-FIGURE-CAPTION', 'A figure without a caption: the stencil numbers and captions every figure ("Figure 11: ...").', t);
      if (projectId) for (const g of t.children.filter((c) => c.name === 'graphic')) {
        const src = g.attrs.src ?? '';
        if (src && !/^(\.\.|\/|[a-z]:)/i.test(src) && !fs.existsSync(path.join(projectDirFor(projectId), src))) add('error', 'JSS-GRAPHIC-MISSING', `The picture "${src}" is not in the project.`, g);
      }
    } else if (t.name === 'section' && !t.children.some((c) => c.name !== 'title')) {
      add('warning', 'JSS-SECTION-EMPTY', `The section "${titleOf(t)}" has no content yet.`, t);
    }
  }
  // order: a chapter's or section's own content comes before its sub-sections (the pipeline prints it that way)
  for (const n of walk(root)) {
    if (n.name !== 'chapter' && n.name !== 'section') continue;
    const kids = n.children.filter((c) => c.name !== 'title'); const firstSub = kids.findIndex((c) => c.name === 'section');
    const late = firstSub < 0 ? undefined : kids.slice(firstSub).find((c) => c.name !== 'section');
    if (late) add('error', 'JSS-ORDER', `"${titleOf(n)}" has a <${late.name}> after a sub-section. A ${n.name}'s own content comes first and its sub-sections after it, which is how the PDF prints it.`, late);
  }
  return done(docType);
}

export const reportErrors = (r: JssReport): JssFinding[] => r.findings.filter((f) => f.severity === 'error');

// ── The publication gate ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A PDF is built from a document that has just been checked; the same applies to a release. Throws 422 VALIDATION_FAILED with the findings. */
export async function assertJssPublishable(projectId: string): Promise<{ validatedAt: string; warnings: string[]; verifyUnchanged: () => void }> {
  const { xml, hash } = readSource(projectId);
  const report = await validateJss(projectId, xml);
  const errors = reportErrors(report);
  if (errors.length) {
    const first = errors.slice(0, 5).map((f) => `line ${f.line}: ${f.message}`).join(' | ');
    throw new HttpError(422, `The document does not pass its checks (${errors.length} error${errors.length === 1 ? '' : 's'}): ${first}`, 'VALIDATION_FAILED', { findings: errors, validatedAt: report.validatedAt });
  }
  return {
    validatedAt: report.validatedAt,
    warnings: report.findings.filter((f) => f.severity === 'warning').map((f) => `line ${f.line}: ${f.message}`),
    verifyUnchanged: () => { if (readSource(projectId).hash !== hash) throw conflict('The document changed while the PDF was being prepared; build again.', 'CHANGED_DURING_VALIDATION'); },
  };
}

// ── The book the pipeline renders ───────────────────────────────────────────────────────────────────────────────────────────────

const META_FIELDS = ['bookName', 'systemName', 'security', 'publicationNo', 'inbrNo', 'nsn', 'contractNo', 'projectCode', 'ltDocumentNo', 'month', 'year'] as const;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** What the author wrote in <bookmeta>, as a plain object. */
export function authoredMeta(xml: string): Record<string, string> {
  const root = parseTree(xml);
  const meta = root.children.find((c) => c.name === 'bookmeta');
  const out: Record<string, string> = {};
  for (const c of meta?.children ?? []) out[c.name] = norm(c.text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>'));
  return out;
}

// ── What the stencils set that the pipeline's own defaults do not ────────────────────────────────────────────────────────────────

/** Heading 2 is Arial Narrow in the stencils; the rest of the stack is the fallback when the (proprietary) Arial Narrow files are not installed. */
export const STENCIL_HEADING_FONT = 'Arial Narrow,Arial,Liberation Sans,DejaVu Sans,Symbol,ZapfDingbats';

/**
 * Layout parameters a JSS-authored document sends to the pipeline, over the ones Settings produced (a name already there is replaced, never doubled).
 * Every one of them is a parameter whose DEFAULT in the stylesheets is the old behaviour, so a build that does not send it (S1000D, the old JSS path) is unchanged.
 *   para.after                 the stencils' paragraph styles have no space after
 *   heading.1.font             Heading 2 is Arial Narrow
 *   heading.1.bodyIndent       text under a first-level heading starts at 7 mm (the style's indent)
 *   heading.1.gap              while the heading's own text starts at 8 mm from its number (the engine otherwise ties the two together)
 *   cover.title.split          the MM and ORM covers set their title on two lines
 *   foreword.documentNo.show   the Land stencils' foreword has no "L&T Document No." line; the Naval handbooks' has (the registry says which)
 *   cover.inbr.show            only a cover whose stencil has an INBR No. line (UHB2) keeps it
 *   roc.layout, abbrev.layout, safety.footer.show   the list stencils' Amendments table, numbered abbreviations and safety warning without the first-aid line (registry: listFrame)
 *   chapter.divider            the list stencils and Part IV have no chapter divider page: the chapter opens with its heading (registry: chapterDivider)
 *   chapter.pageBreak          a page break the author places directly in a chapter (the figure sheet of the SMT / STE list) breaks the page, as it does in a section
 */
export function layoutParamsFor(type: JssDocType, base: Array<[string, string]>): Array<[string, string]> {
  const set: Array<[string, string]> = [
    ['para.after', '0mm'], ['heading.1.font', STENCIL_HEADING_FONT], ['heading.1.bodyIndent', '7mm'], ['heading.1.gap', '8mm'], ['cover.title.split', '1'], ['foreword.documentNo.show', type.forewordDocumentNo ? '1' : '0'], ['chapter.pageBreak', '1'],
  ];
  if (!type.coverInbr) set.push(['cover.inbr.show', '0']);
  if (type.listFrame) set.push(['roc.layout', 'amendments'], ['abbrev.layout', 'numbered'], ['safety.footer.show', '0']);
  if (type.chapterDivider === false) set.push(['chapter.divider', '0']);
  const names = new Set(set.map(([n]) => n));
  return [...base.filter(([n]) => !names.has(n)), ...set];
}

/**
 * The folder of the project's front-matter page files, filled in: the hand-edited stencil pages that ship with the app are copied in once, and the
 * settings-driven pages are written from Settings (a page the author edited by hand is kept, see engine/frontmatter.js). Used by the build and by the
 * Ancillary pages editor, so both look at the same files.
 */
export function prepareFrontMatterFiles(projectId: string, effective: any): string {
  const fmAbs = path.join(projectDirFor(projectId), 'jss', 'frontmatter');
  fs.mkdirSync(fmAbs, { recursive: true });
  const statics = path.join(config.pipelineDir, 'jss', 'frontmatter');
  if (fs.existsSync(statics)) for (const f of fs.readdirSync(statics)) { const dest = path.join(fmAbs, f); if (!fs.existsSync(dest)) fs.copyFileSync(path.join(statics, f), dest); }
  generateFrontMatter(effective?.frontMatter, fmAbs, 's1000dtojss');
  return fmAbs;
}

/**
 * The authored document with the shared frame added: <bookmeta> (the author's identity over Settings' defaults, with the emblem and publishers
 * from Settings) and <frontmatter> (the pages Settings turns on, in Settings' order). The body is the author's, unchanged.
 * Code No. and Rev No. travel as layout parameters, so they are returned for the build to apply rather than written into the book.
 */
export function composeBook(projectId: string, effective: any): { text: string; codeNo: string; revNo: string; pages: number } {
  const { xml } = readSource(projectId);
  const meta = authoredMeta(xml);
  const monthIdx = MONTHS.findIndex((m) => m.toLowerCase() === (meta.month ?? '').toLowerCase());
  let block: string = bookmetaXml(effective, `<issueDate year="${meta.year ?? ''}" month="${monthIdx >= 0 ? String(monthIdx + 1).padStart(2, '0') : ''}"/>`);
  for (const f of META_FIELDS) {
    if (!meta[f]) continue;
    block = block.replace(new RegExp(`<${f}>[^<]*</${f}>`), `<${f}>${esc(meta[f])}</${f}>`);
  }

  const dir = projectDirFor(projectId);
  const type = jssTypeOfProject(projectId);
  // The stencil has ONE cover. The "jointly prepared" cover (stencil Cover_page) is printed only when the book really has more than one publisher.
  const joint = ((effective?.branding?.publishers as unknown[] | undefined)?.length ?? 0) > 1;
  const fmRel = 'jss/frontmatter';
  const fmAbs = prepareFrontMatterFiles(projectId, effective);
  const have = new Set(fs.readdirSync(fmAbs));
  const rows: string[] = [];
  for (const page of enabledPages(effective?.frontMatter) as any[]) {
    if (page.id === 'titlePageJoint' && !joint) continue;
    if (type?.omitPages?.includes(page.id)) continue;                                                       // this stencil has no such page
    if (page.element) rows.push(page.file && have.has(page.file) ? `    <xi:include href="${fmRel}/${page.file}"/>` : `    <${page.element}/>`);
    else if (page.file && have.has(page.file)) rows.push(`    <xi:include href="${fmRel}/${page.file}"/>`);
  }

  const bodyStart = xml.indexOf('<body');
  const bodyEnd = xml.lastIndexOf('</body>');
  if (bodyStart < 0 || bodyEnd < 0) throw bad('The document has no body.', 'NO_BODY');
  const docType = /\bdocType="([^"]+)"/.exec(xml)?.[1] ?? '';
  const text = `<?xml version="1.0" encoding="UTF-8"?>
<jssbook xmlns:xi="http://www.w3.org/2001/XInclude" docType="${escAttr(docType)}" schemaVersion="${JSS_SCHEMA_VERSION}">
${block}
  <frontmatter>
${rows.join('\n')}
  </frontmatter>
  ${xml.slice(bodyStart, bodyEnd + '</body>'.length)}
</jssbook>
`;
  return { text, codeNo: meta.codeNo ?? '', revNo: meta.revNo ?? '', pages: rows.length };
}

/** Create the project's first document. Called by project creation. */
export function createInitialDocument(projectId: string, type: JssDocType, input: NewDocInput): void {
  const abs = sourcePath(projectId);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, skeletonXml(type, input), 'utf8');
  // the publisher block of this stencil's cover, with the default publisher logo in the project's Media folder (Settings > Branding can change both)
  let logo: string | undefined;
  if (type.publisher) {
    const source = path.resolve(__dirname, '..', '..', '..', 'assets', 'default-publisher-logo.png');
    if (fs.existsSync(source)) {
      fs.mkdirSync(path.join(projectDirFor(projectId), 'Media'), { recursive: true });
      fs.copyFileSync(source, path.join(projectDirFor(projectId), 'Media', 'publisher-logo.png'));
      logo = 'Media/publisher-logo.png';
    }
  }
  updateProjectJson(projectId, (pj) => {
    pj.authoring = 'jss-xml'; pj.jssDocType = type.id; pj.jssSchemaVersion = JSS_SCHEMA_VERSION;
    if (type.publisher) pj.publishers = [{ ...type.publisher, ...(logo ? { logo } : {}) }];
  });
}
