// JSG authoring: the project's source document and its validation.
//
// The source of truth is ONE XML file per project (`jsg-document.xml`, root <jsgdoc>, validated against schemas/jsg/jsg-1.0.xsd). It is separate from
// `publication.xml` on purpose: a JSG project has no S1000D publication module and no JSS book. The PDF is made by the JSG engine (./engine.ts).
//
// Saving is permissive the way the other two formats are: malformed XML is refused; well-formed XML that breaks the schema or a rule is a draft and is saved.
// A PDF is only built from a document that has just been checked (assertJsgPublishable).

import fs from 'fs';
import path from 'path';
import { config } from '../../config';
import { projectDirFor, content } from '../../context';
import { bad, conflict, HttpError } from '../http';
import { checkXmlSafetyOf } from '../csdbGuard';
import { syncIdentity } from '../xengine/project';
import { parseTree, walk, type MNode } from '../miniXml';
import { wellFormedError } from '../wellFormed';
import { readProjectJson, updateProjectJson } from '../projectRecord';
import { registerDocumentCreator } from '../documentCreators';
import { jsgTypeById, ISPL_PREFACE, UHB_FRONT_COUNTS, UHB_PREFACE, type JsgDocType } from './registry';
import { escText as esc } from '../../lib/xml';
import { sha256 as sha } from '../../lib/hash';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateXML } = require('xmllint-wasm');

export const JSG_SCHEMA_VERSION = '1.0';
export const JSG_XSD = path.join(config.schemasDir, 'jsg', 'jsg-1.0.xsd');
export const JSG_ENGINE_DIR = path.join(config.schemasDir, 'jsg', 'engine');
export const SOURCE_NAME = 'jsg-document.xml';

export interface JsgFinding { severity: 'error' | 'warning'; rule: string; message: string; line: number; location: string }
export interface JsgReport { docType: string | null; valid: boolean; errors: number; warnings: number; findings: JsgFinding[]; validatedAt: string }

export { esc };
const escAttr = (s: string): string => esc(s).replace(/"/g, '&quot;');
export { sha };

/** A project whose source is a JSG document written in the JSG editor. */
export const isJsgProject = (projectId: string): boolean => readProjectJson(projectId).format === 'jsg';
export const jsgTypeOfProject = (projectId: string): JsgDocType | undefined => jsgTypeById(readProjectJson(projectId).jsgDocType);
export const sourcePath = (projectId: string): string => path.join(projectDirFor(projectId), SOURCE_NAME);
/** The document's place inside the project, for the ContentStore (WP-10). */
const sourceInProject = (projectId: string): string => path.relative(content.projectDir(projectId), sourcePath(projectId));

// ── A new document ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface NewDocInput { projectName?: string }

// ── The stencil's own example blocks ────────────────────────────────────────────────────────────────────────────────────────────

const tcell = (t = '', align?: string, bold = false): string => `<cell${align ? ` align="${align}"` : ''}${bold ? ' bold="true"' : ''}><text>${esc(t)}</text></cell>`;
const trow = (...cells: string[]): string => `<row>${cells.join('')}</row>`;
/** A three-column table the stencil way: Sr. No. / Parameter / Value, numbered rows, empty cells to fill. */
function specTable(title: string | null, rows: number, widths: string): string {
  const body = Array.from({ length: rows }, (_, i) => trow(tcell(String(i + 1), 'center'), tcell(), tcell())).join('');
  return `<table${title ? ` title="${escAttr(title)}"` : ''} widths="${widths}"><head>${trow(tcell('Sr. No.', 'center', true), tcell('Parameter', 'left', true), tcell('Value', 'left', true))}</head><body>${body}</body></table>`;
}
/** 1.1 General holds a captioned figure, 1.2 Special Features a lettered list and "Table 1: Technical Specifications", 1.3 System Tree Chart a captioned figure. */
const STENCIL_EXAMPLES: Record<string, string> = {
  'General': '<figure title="FIGURE NAME"/>',
  'Special Features and Specifications': `<list type="alpha"><item><text/></item></list>${specTable('Technical Specifications', 5, '988 3402 5240')}`,
  'System Tree Chart': '<figure title="System Tree Chart"/>',
};
/** Appendix H (System Specification): the stencil's 17-row table. */
const APPENDIX_H_TABLE = specTable(null, 16, '704 3687 5241');

function uhbSkeleton(type: JsgDocType, input: NewDocInput): string {
  const now = new Date();
  const issue = `${now.toLocaleString('en-GB', { month: 'long' }).toUpperCase()}, ${now.getFullYear()}`;
  let n = 0;
  const items = (k: number): string => Array.from({ length: k }, () => '      <item></item>').join('\n');       // the stencil's numbered, empty lines
  const chapters = (type.chapters ?? []).map((c) => {
    const sections = c.sections.map((s) => {
      const clauses = (s.clauses ?? []).map((t) => {
        const example = c.title === 'General Description' && s.title === 'Introduction' ? STENCIL_EXAMPLES[t] : undefined;     // the stencil's own placeholders in 1.1 - 1.3
        const orient = t === 'System Tree Chart' && example ? ' orientation="landscape"' : '';          // the stencil sets 1.3 on a landscape page
        return `        <clause id="k${++n}" title="${escAttr(t)}"${orient}>${example ?? '<para/>'}</clause>`;
      }).join('\n');
      return `      <section id="s${++n}" title="${escAttr(s.title)}">${clauses ? '\n' + clauses + '\n      ' : ''}</section>`;
    }).join('\n');
    return `  <chapter id="c${++n}" title="${escAttr(c.title)}">\n${sections}\n  </chapter>`;
  }).join('\n');
  const appendices = (type.appendices ?? []).map((a) => `    <appendix id="a${++n}" label="${escAttr(a.label)}" title="${escAttr(a.title)}">${a.label === 'H' ? APPENDIX_H_TABLE : '<para/>'}</appendix>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="${JSG_SCHEMA_VERSION}" type="${type.id}">
  <meta>
    <docNo>DOCUMENT NO.</docNo>
    <title>${esc(type.coverTitle)}</title>
    <projectName>${esc(input.projectName ?? 'PROJECT NAME')}</projectName>
    <atNo></atNo>
    <dated></dated>
    <nsn></nsn>
    <issuedBy><line>GOVERNMENT OF INDIA</line></issuedBy>
    <issueDate>${issue}</issueDate>
    <equipmentLife></equipmentLife>
    <classification>RESTRICTED</classification>
  </meta>
  <front>
    <amendments minRows="${UHB_FRONT_COUNTS.amendmentRows}"/>
    <warning>
${items(UHB_FRONT_COUNTS.warning)}
    </warning>
    <abbreviations minRows="${UHB_FRONT_COUNTS.abbreviationRows}"/>
    <preface>
${UHB_PREFACE.map((t) => `      <para>${esc(t)}</para>`).join('\n')}
    </preface>
    <dos>
${items(UHB_FRONT_COUNTS.dos)}
    </dos>
    <donts>
${items(UHB_FRONT_COUNTS.donts)}
    </donts>
    <important>
${items(UHB_FRONT_COUNTS.important)}
    </important>
    <photos/>
  </front>
${chapters}
  <appendices>
${appendices}
  </appendices>
</jsgdoc>
`;
}

function isplSkeleton(type: JsgDocType, input: NewDocInput): string {
  const now = new Date();
  const issue = `${now.toLocaleString('en-GB', { month: 'long' }).toUpperCase()}, ${now.getFullYear()}`;
  const preface = ISPL_PREFACE.map((p) => {
    if (p.kind === 'list') return `      <list type="alpha" indent="3">\n${(p.items ?? []).map((t) => `        <item><text>${esc(t)}</text></item>`).join('\n')}\n      </list>`;
    if (p.kind === 'note') return `      <para indent="3">${esc(p.text ?? '')}</para>`;
    return `      <para>${esc(p.text ?? '')}</para>`;
  }).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<jsgdoc version="${JSG_SCHEMA_VERSION}" type="${type.id}">
  <meta>
    <docNo></docNo>
    <title>${esc(type.coverTitle)}</title>
    <projectName>${esc(input.projectName ?? 'EQUIPMENT NAME')}</projectName>
    <atNo></atNo>
    <dated></dated>
    <nsn></nsn>
    <issuedBy><line>GOVERNMENT OF INDIA</line></issuedBy>
    <issueDate>${issue}</issueDate>
    <equipmentLife></equipmentLife>
    <qtyUnit></qtyUnit>
    <classification>RESTRICTED</classification>
  </meta>
  <front>
    <certificate>Certified that this document no. <b>{docNo}</b> contains {total} pages which have been serially numbered from (i) to (___) as ancillary pages and from 1 to {mainLast} as main content.</certificate>
    <preface>
${preface}
    </preface>
    <amendments minRows="20"/>
    <abbreviations/>
    <supplied equipment=""/>
  </front>
  <plates>
    <plate id="p1" ref="I" title="General Assembly" divider="true" setColumn="true" caption="GENERAL ASSY OF EQUIPMENT NAME">
      <view caption="GENERAL ASSEMBLY (VIEW 1)"/>
    </plate>
  </plates>
</jsgdoc>
`;
}

export function skeletonXml(type: JsgDocType, input: NewDocInput = {}): string {
  if (!type.ready) throw bad(`${type.label}: ${type.notReady ?? 'not available yet'}`, 'JSG_TYPE_NOT_READY');
  if (type.id === 'ispl') return isplSkeleton(type, input);
  if (type.id === 'uhb') return uhbSkeleton(type, input);
  throw bad(`${type.label}: not available yet`, 'JSG_TYPE_NOT_READY');
}

// WP-10 (ARC-006): projects.ts creates a JSG project's first document through this registration, not through a require() of this file.
registerDocumentCreator('jsg', (projectId, typeId, o) => createInitialDocument(projectId, jsgTypeById(typeId)!, { projectName: o.projectName }));

/** Create the project's first document. Called by project creation. */
export function createInitialDocument(projectId: string, type: JsgDocType, input: NewDocInput): void {
  fs.writeFileSync(sourcePath(projectId), skeletonXml(type, input), 'utf8');
  updateProjectJson(projectId, (pj) => { pj.format = 'jsg'; pj.jsgDocType = type.id; pj.jsgSchemaVersion = JSG_SCHEMA_VERSION; });
}

// ── Reading and writing ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export function readSource(projectId: string): { xml: string; hash: string } {
  const at = sourceInProject(projectId);
  if (!content.exists(projectId, at)) throw bad('This project has no JSG document yet.', 'NO_JSG_DOCUMENT');
  const xml = content.readText(projectId, at);
  return { xml, hash: sha(xml) };
}

/** Save the authored XML. Malformed text is refused; a draft that breaks the schema is kept and reported. `baseHash` guards against saving over a newer save. */
export async function writeSource(projectId: string, xml: string, baseHash?: string): Promise<{ hash: string; report: JsgReport }> {
  if (typeof xml !== 'string' || !xml.trim()) throw bad('There is no document to save.', 'EMPTY');
  if (Buffer.byteLength(xml) > 50 * 1024 * 1024) throw bad('The document is larger than 50 MB.', 'TOO_LARGE');
  checkXmlSafetyOf(xml);                         // WP-02: the same guard as every S1000D write (XXE, xi:include, entity bombs)
  if (/<!DOCTYPE/i.test(xml.replace(/<!--[\s\S]*?-->/g, '').replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, ''))) throw bad('A JSG document may not declare a DOCTYPE: the engine needs none, and entities are not supported in it.', 'DOCTYPE_REFUSED');   // PUB-014
  const wf = wellFormedError(xml);
  if (wf) throw new HttpError(400, `The document is not well-formed XML: ${wf}`, 'MALFORMED_XML');
  const at = sourceInProject(projectId);
  const current = content.exists(projectId, at) ? content.readText(projectId, at) : null;
  if (baseHash && current !== null && sha(current) !== baseHash) throw conflict('The document was saved by someone else since you opened it. Reload to see their changes.', 'STALE_DOCUMENT');
  const declared = /<jsgdoc\b[^>]*\btype="([^"]+)"/.exec(xml)?.[1];
  const type = jsgTypeOfProject(projectId);
  if (type && declared && declared !== type.id) throw bad(`This project is a ${type.label}; the document says it is "${declared}".`, 'DOCTYPE_MISMATCH');
  content.writeText(projectId, at, xml);
  syncIdentity(projectId, 'jsg', xml);                 // the document codes kept in the backend (services/xengine) follow the document; never refuses a save
  return { hash: sha(xml), report: await validateJsg(xml) };
}

// ── Validation: the schema, then the JSG rules ──────────────────────────────────────────────────────────────────────────────────

let xsdText: string | null = null;
const schemaText = (): string => (xsdText ??= fs.readFileSync(JSG_XSD, 'utf8'));
const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();
const loc = (n: MNode): string => n.path.replace(/\[1\]/g, '');

export async function validateJsg(xml: string): Promise<JsgReport> {
  const findings: JsgFinding[] = [];
  const add = (severity: JsgFinding['severity'], rule: string, message: string, n: MNode | null, line = n?.line ?? 1): void => { findings.push({ severity, rule, message, line, location: n ? loc(n) : '/' }); };
  const done = (docType: string | null): JsgReport => {
    const errors = findings.filter((f) => f.severity === 'error').length;
    return { docType, valid: errors === 0, errors, warnings: findings.length - errors, findings, validatedAt: new Date().toISOString() };
  };

  const wf = wellFormedError(xml);
  if (wf) { add('error', 'JSG-WELLFORMED', `Not well-formed XML: ${wf}`, null); return done(null); }

  // 1. the schema
  try {
    const res = await validateXML({ xml: [{ fileName: 'document.xml', contents: xml }], schema: [{ fileName: 'jsg-1.0.xsd', contents: schemaText() }] });
    for (const e of res.errors || []) {
      add('error', 'JSG-SCHEMA', String(e.message).replace(/^Schemas validity error\s*:\s*/, '').replace(/^Element '([^']+)'/, '<$1>').slice(0, 400), null, (e.loc && e.loc.lineNumber) || 1);
    }
  } catch (e) {
    add('error', 'JSG-SCHEMA-RUN', `The schema check could not run: ${(e as Error).message.slice(0, 200)}`, null);
    return done(null);
  }

  // 2. the rules (only when the structure was readable)
  let root: MNode;
  try { root = parseTree(xml); } catch { return done(null); }
  if (root.name !== 'jsgdoc') return done(null);
  const docType = root.attrs.type ?? null;
  const type = jsgTypeById(docType);
  if (!type) { add('error', 'JSG-DOCTYPE', `Unknown document type "${docType}".`, root); return done(docType); }
  if (!type.ready) { add('error', 'JSG-DOCTYPE-NOT-READY', `${type.label}: ${type.notReady}`, root); return done(docType); }

  // the body must be the type's own: a User Handbook has chapters, not plates
  const has = (name: string): boolean => root.children.some((c) => c.name === name);
  if (type.id === 'uhb' && has('plates')) add('error', 'JSG-BODY', 'A User Handbook has chapters and appendices, not plates.', root);
  if (type.id === 'ispl' && has('chapter')) add('error', 'JSG-BODY', 'An Illustrated Spare Parts List has plates and appendices, not chapters.', root);
  if (type.id === 'ispl') validatePlates(root, add);

  // a figure or table entering the lists needs a title; cross-references need a target (libxml2 does not resolve IDREFs in this setup)
  const ids = new Set<string>();
  for (const n of walk(root)) if (n.attrs.id) ids.add(n.attrs.id);
  for (const n of walk(root)) {
    if (n.name === 'xref' && n.attrs.to && !ids.has(n.attrs.to)) add('error', 'JSG-XREF', `A cross-reference points at "${n.attrs.to}", which is not in this document.`, n);
    if (n.name === 'graphic' && n.attrs.src && /^(https?:|file:|[a-z]:[\\/]|\/)/i.test(n.attrs.src)) add('error', 'JSG-GRAPHIC-PATH', `The picture "${n.attrs.src}" must be a file of this project (a relative path such as Media/name.png).`, n);
  }

  // a captioned figure with no picture is the stencil's placeholder: printed as its caption alone, so say so (a warning, never a block)
  for (const n of walk(root)) if (n.name === 'figure' && !n.children.some((c) => c.name === 'graphic')) add('warning', 'JSG-FIGURE-EMPTY', `The figure "${n.attrs.title ?? ''}" has no picture yet.`, n);

  // table grid: every row of a table has the same number of columns (rowspan / colspan aware)
  for (const n of walk(root)) {
    if (n.name !== 'table') continue;
    const rows = n.children.flatMap((s) => s.children.filter((r) => r.name === 'row'));
    const widthsAttr = n.attrs.widths ? norm(n.attrs.widths).split(' ').length : 0;
    const g = gridOf(rows);
    if (g.problem) add('error', 'JSG-TABLE', `${n.attrs.title ? `Table "${n.attrs.title}"` : 'A table'}: ${g.problem}`, n);
    else if (widthsAttr && widthsAttr !== g.columns) add('error', 'JSG-TABLE-WIDTHS', `${n.attrs.title ? `Table "${n.attrs.title}"` : 'A table'} has ${g.columns} columns but ${widthsAttr} widths.`, n);
  }

  // unfinished placeholders are a warning, never a block
  const meta = root.children.find((c) => c.name === 'meta');
  for (const key of ['docNo', 'atNo', 'dated']) {
    const el = meta?.children.find((c) => c.name === key);
    if (!el || !norm(el.text)) add('warning', 'JSG-META-EMPTY', `The cover field "${key}" is empty.`, meta ?? root);
  }
  return done(docType);
}

/** The ISPL rules: plate references are unique and well-formed, every plate sits under a plate that exists, every view that lists parts has a picture. */
function validatePlates(root: MNode, add: (sev: JsgFinding['severity'], rule: string, msg: string, n: MNode | null, line?: number) => void): void {
  const plates = [...walk(root)].filter((n) => n.name === 'plate');
  const seen = new Map<string, MNode>();
  const refs = new Set(plates.map((p) => p.attrs.ref ?? ''));
  for (const p of plates) {
    const ref = norm(p.attrs.ref ?? '');
    if (!ref) { add('error', 'JSG-PLATE-REF', `The plate "${p.attrs.title ?? ''}" has no reference.`, p); continue; }
    if (seen.has(ref)) add('error', 'JSG-PLATE-DUP', `Two plates have the reference "${ref}".`, p);
    seen.set(ref, p);
    const parent = parentRef(ref);
    if (parent && !refs.has(parent)) add('warning', 'JSG-PLATE-PARENT', `Plate ${ref} belongs under plate ${parent}, which is not in this document.`, p);
    const views = p.children.filter((c) => c.name === 'view');
    if (!views.length) add('warning', 'JSG-PLATE-EMPTY', `Plate ${ref} has no view (no picture and no parts table).`, p);
    for (const v of views) {
      const pics = v.children.filter((c) => c.name === 'graphic');
      const parts = v.children.filter((c) => c.name === 'part');
      if (parts.length && !pics.length) add('warning', 'JSG-VIEW-NOPICTURE', `A view of plate ${ref} lists ${parts.length} part${parts.length === 1 ? '' : 's'} but has no picture.`, v);
      const items = new Set<string>();
      for (const part of parts) {
        const it = norm(part.attrs.item ?? '');
        if (items.has(it)) add('warning', 'JSG-PART-DUP', `Item No. ${it} appears twice in one view of plate ${ref}.`, part);
        items.add(it);
      }
    }
  }
}
/** The plate a reference sits under: I-A/1 under I-A, I-A under I, I-B/2/9 under I-B/2. */
export function parentRef(ref: string): string {
  const slash = ref.lastIndexOf('/');
  if (slash >= 0) return ref.slice(0, slash);
  const dash = ref.lastIndexOf('-');
  return dash >= 0 ? ref.slice(0, dash) : '';
}

/** How many columns a table's rows make once merged cells are counted, and whether the cells fit exactly. */
export function gridOf(rows: MNode[]): { columns: number; problem: string | null } {
  const occupied: number[] = [];
  let columns = 0;
  for (let r = 0; r < rows.length; r++) {
    let col = 0;
    for (const cell of rows[r].children.filter((c) => c.name === 'cell')) {
      while ((occupied[col] ?? 0) > 0) col++;
      const cs = Number(cell.attrs.colspan ?? 1) || 1;
      const rs = Number(cell.attrs.rowspan ?? 1) || 1;
      for (let k = 0; k < cs; k++) occupied[col + k] = rs;
      col += cs;
    }
    while ((occupied[col] ?? 0) > 0) col++;
    if (r === 0) columns = col;
    else if (col !== columns) return { columns, problem: `row ${r + 1} has ${col} columns, row 1 has ${columns}.` };
    for (let k = 0; k < occupied.length; k++) if ((occupied[k] ?? 0) > 0) occupied[k]--;
  }
  return { columns, problem: null };
}

export const reportErrors = (r: JsgReport): JsgFinding[] => r.findings.filter((f) => f.severity === 'error');

/** The publish gate: the document must be valid RIGHT NOW. Returns a check that the file did not change while it was rendered. */
export async function assertJsgPublishable(projectId: string): Promise<{ validatedAt: string; warnings: string[]; verifyUnchanged: () => void }> {
  const { xml, hash } = readSource(projectId);
  const report = await validateJsg(xml);
  const errors = reportErrors(report);
  if (errors.length) {
    throw new HttpError(422, `The document has ${errors.length} error${errors.length === 1 ? '' : 's'} and cannot be published: ${errors[0].message}`, 'VALIDATION_FAILED', { findings: errors, validatedAt: report.validatedAt });
  }
  return {
    validatedAt: report.validatedAt,
    warnings: report.findings.filter((f) => f.severity === 'warning').map((f) => f.message),
    verifyUnchanged: () => { if (sha(fs.readFileSync(sourcePath(projectId), 'utf8')) !== hash) throw conflict('The document changed while it was being built.', 'CHANGED_DURING_VALIDATION'); },
  };
}
