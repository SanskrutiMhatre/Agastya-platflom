// Import a Word document (.docx) written in the JSG Illustrated Spare Parts List format into a <jsgdoc type="ispl">.
//
// The ISPL is read by what it looks like: the cover (blue title lines, NSN / A/T / DATED lines, SUPPLIED BY / ISSUED BY blocks, the EQUIPMENT LIFE table), each ancillary page by its
// blue title (CERTIFICATE, PREFACE, AMENDMENTS, ABBREVIATIONS, LIST OF EQUIPMENT ALREADY SUPPLIED), the plates by the "PLATE - <ref> <TITLE>" captions (a plate is a run of
// views; a view is a picture page - one picture or a table of pictures with their references, and the red caption under it - and the parts table that follows it, with the
// notes under the table), and the appendices by their "APPX 'A'" lines. The engine prints the contents; it is not read.
// Pictures are copied to the project's Media folder. Text boxes, shapes and EMF / WMF pictures are not read (the report says so).

import fs from 'fs';
import path from 'path';
import { ZipFileReader } from '../zipio';
import { Reader, W, PRINTABLE, esc, escA, inlineXml, plain, squash, titleCase, kids, type Para, type Tbl, type Token, type Picture, type Cell, type Inline } from './docx';
import type { ImportReport, ImportResult } from './docx';

interface Gfx { src: string; widthMm?: number; label?: string }
interface PartRow { item: string; plateRef: string; provide: string; nsn: string; designation: string; qty: string; qtySet: string; drg: string; firmPart: string; price: string; remark: string }
interface View { caption: string; graphics: Gfx[]; parts: PartRow[]; notes: Inline[][]; sawParts: boolean }
interface PlateM { ref: string; title: string; caption: string; divider: boolean; setColumn: boolean; views: View[] }
interface TCellM { colspan?: number; rowspan?: number; align?: string; text: string }
interface TableM { widths: string; head: TCellM[][]; body: TCellM[][] }
interface AppendixM { label: string; title: string; children: Array<{ k: 'para'; inline: Inline[] } | { k: 'table'; table: TableM }> }

const BLANK = /^this page is intentionally left blank\.?$/i;
const upper = (c?: string): string => (c ?? '').toUpperCase();
const cellText = (c: Cell): string => squash(c.paras.map((p) => p.text).join(' '));
const hasPicture = (t: Tbl): boolean => t.rows.some((r) => r.cells.some((c) => c.paras.some((p) => p.pictures.length)));

/** The width of every column from the Word grid, as the relative numbers the engine takes. */
const widthsOf = (grid: number[]): string => (grid.length ? grid.map((g) => Math.max(1, Math.round(g))).join(' ') : '');

/** A Word table as head rows + body rows (vertical merges lengthen the cell above; a header cell crossing into the body is kept in the head). */
function tableOf(t: Tbl, headRows: number): TableM {
  const rows: Array<{ cells: Array<TCellM & { open?: boolean }> }> = [];
  const open: Array<TCellM | undefined> = [];
  t.rows.forEach((r) => {
    const out: TCellM[] = []; let col = 0;
    for (const c of r.cells) {
      if (c.vmerge === 'continue') { const o = open[col]; if (o) o.rowspan = (o.rowspan ?? 1) + 1; col += c.span; continue; }
      const m: TCellM = { text: cellText(c) };
      if (c.span > 1) m.colspan = c.span;
      if (c.jc === 'center') m.align = 'center'; else if (c.jc === 'right') m.align = 'right';
      out.push(m); for (let k = 0; k < c.span; k++) open[col + k] = c.vmerge === 'restart' ? m : undefined; col += c.span;
    }
    rows.push({ cells: out });
  });
  // rows whose every cell was a continuation are gone; a rowspan reaching past the head is clamped so the head and the body stay separate tables
  const head = rows.slice(0, headRows).map((r) => r.cells); const body = rows.slice(headRows).map((r) => r.cells);
  head.forEach((r, i) => r.forEach((c) => { if (c.rowspan && i + c.rowspan > head.length) c.rowspan = Math.max(1, head.length - i); if (c.rowspan === 1) delete c.rowspan; }));
  body.forEach((r, i) => r.forEach((c) => { if (c.rowspan && i + c.rowspan > body.length) c.rowspan = Math.max(1, body.length - i); if (c.rowspan === 1) delete c.rowspan; }));
  return { widths: widthsOf(t.grid), head, body };
}

/** How many leading rows of a table are its heading (rows Word marks as repeating headers, else the first row). */
const headCount = (t: Tbl): number => { let n = 0; for (const r of t.rows) { if (r.header) n++; else break; } return n || 1; };

const tableXml = (t: TableM, pad: string): string => {
  const cell = (c: TCellM): string => `${pad}      <cell${c.colspan ? ` colspan="${c.colspan}"` : ''}${c.rowspan ? ` rowspan="${c.rowspan}"` : ''}${c.align ? ` align="${c.align}"` : ''}>${c.text ? `<text>${esc(c.text)}</text>` : ''}</cell>`;
  const rows = (rs: TCellM[][]): string => rs.map((r) => `${pad}    <row>\n${r.map(cell).join('\n')}\n${pad}    </row>`).join('\n');
  return `${pad}<table${t.widths ? ` widths="${escA(t.widths)}"` : ''}>\n${t.head.length ? `${pad}  <head>\n${rows(t.head)}\n${pad}  </head>\n` : ''}${pad}  <body>\n${rows(t.body)}\n${pad}  </body>\n${pad}</table>`;
};

export async function importIsplDocx(docxPath: string, opts: { projectDir: string; copyMedia?: boolean }): Promise<ImportResult> {
  const zip = ZipFileReader.open(docxPath);
  const warnings: string[] = []; const skipped: string[] = [];
  try {
    const rd = new Reader(zip);
    await rd.loadRelationships(); await rd.loadNumbering();
    const docBuf = await rd.entry('word/document.xml'); if (!docBuf) throw new Error('This is not a Word document: word/document.xml is missing.');
    const doc = rd.parse(docBuf);
    const body = doc.getElementsByTagNameNS(W, 'body')[0]; if (!body) throw new Error('The Word document has no body.');
    const tokens: Token[] = [];
    for (const e of kids(body)) { if (e.localName === 'p') tokens.push(rd.paragraph(e)); else if (e.localName === 'tbl') tokens.push(rd.table(e)); }

    const report: ImportReport = { chapters: 0, sections: 0, clauses: 0, paragraphs: 0, lists: 0, tables: 0, figures: 0, pictures: 0, frontPages: [], skipped, warnings };
    const media = new Set<string>();
    const usePicture = (pic: Picture): { src: string; widthMm?: number } | null => {
      if (!PRINTABLE.test(pic.src)) { skipped.push(`picture ${path.basename(pic.src)} (${path.extname(pic.src) || 'unknown'} cannot be printed)`); return null; }
      media.add(pic.src); report.pictures++; return { src: `Media/${path.basename(pic.src)}`, widthMm: pic.widthMm };
    };

    // ── where things start ──────────────────────────────────────────────────────────────────────────────────────────────────
    const isTitle = (t: Token, re: RegExp): boolean => t.k === 'p' && re.test(t.text.toUpperCase().replace(/\s+/g, ' '));
    const iCert = tokens.findIndex((t) => isTitle(t, /^C ?E ?R ?T ?I ?F ?I ?C ?A ?T ?E$/));
    const iDivider = tokens.findIndex((t) => t.k === 'p' && /^PLATE\s*[-–]\s*\S+/i.test(t.text) && (t.size ?? 0) >= 30);
    const iPlates = iDivider >= 0 ? iDivider : tokens.findIndex((t) => t.k === 'p' && /^PLATE\s*[-–]\s*\S+/i.test(t.text));
    const iAppx = tokens.findIndex((t, i) => i > Math.max(iPlates, 0) && t.k === 'p' && /^APPENDICES$/i.test(t.text));
    if (iPlates < 0) throw new Error('No plate was found: the plates are the pages captioned "PLATE - I-A ...".');
    const coverTokens = tokens.slice(0, iCert >= 0 ? iCert : iPlates);
    const frontTokens = iCert >= 0 ? tokens.slice(iCert, iPlates) : [];
    const plateTokens = tokens.slice(iPlates, iAppx >= 0 ? iAppx : tokens.length);
    const appxTokens = iAppx >= 0 ? tokens.slice(iAppx + 1) : [];

    // ── the cover ───────────────────────────────────────────────────────────────────────────────────────────────────────────
    const meta: Record<string, string> = {}; const supplier: string[] = []; const issuedBy: string[] = [];
    {
      const L = coverTokens.filter((t): t is Para => t.k === 'p' && !t.empty);
      const first = L.find((p) => p.jc === 'right' && p.bold); if (first) meta.docNo = first.text;
      const blue = L.filter((p) => upper(p.color) === '3333FF');
      const titles = blue.map((p) => p.text).filter((x) => x.toUpperCase() !== 'FOR');
      if (titles[0]) meta.title = titles[0]; if (titles[1]) meta.projectName = titles[1];
      for (const p of L) {
        let m = /^A\/T or S\/O No\.?:?\s*(.*)$/i.exec(p.text); if (m) { meta.atNo = m[1]; continue; }
        m = /^DATED:?\s*(.*)$/i.exec(p.text); if (m) { meta.dated = m[1]; continue; }
        m = /^NSN:?\s*(.*)$/i.exec(p.text); if (m) { meta.nsn = m[1]; continue; }
      }
      const iSup = L.findIndex((p) => /^SUPPLIED BY:?$/i.test(p.text)); const iIss = L.findIndex((p) => /^ISSUED BY:?$/i.test(p.text));
      const linesOf = (p: Para): string[] => { const out: string[][] = [[]]; for (const r of p.inline) { if (r.t === 'br') out.push([]); else out[out.length - 1].push(plain([r])); } return out.map((x) => squash(x.join(''))).filter(Boolean); };
      if (iSup >= 0 && iIss > iSup) for (const p of L.slice(iSup + 1, iIss)) { const ls = linesOf(p); if (/^(.*),\s+(\S.*\d{5,6}.*)$/.test(ls[0] ?? '') && ls.length === 1) { const m = /^(.*?,)\s+(.*)$/.exec(ls[0]); if (m) { supplier.push(m[1], m[2]); continue; } } supplier.push(...ls); }
      if (iIss >= 0) {
        const rest = L.slice(iIss + 1); const dateAt = rest.findIndex((p) => p.jc !== 'center' && /\b(19|20)\d\d\b/.test(p.text));
        for (const p of rest.slice(0, dateAt >= 0 ? dateAt : rest.length)) issuedBy.push(...linesOf(p));
        if (dateAt >= 0) meta.issueDate = rest[dateAt].text.replace(/\s+/g, '').replace(/,/, ', ');
      }
      for (const t of coverTokens) if (t.k === 't') { const m = /^EQUIPMENT LIFE:?\s*(.*)$/i.exec(squash(t.rows.flatMap((r) => r.cells.map(cellText)).join(' '))); if (m) meta.equipmentLife = m[1]; }
    }

    // ── the ancillary pages ─────────────────────────────────────────────────────────────────────────────────────────────────
    const front = { certificate: null as Inline[] | null, preface: [] as Array<{ k: 'para'; indent: number; inline: Inline[] } | { k: 'list'; items: Inline[][][] }>, amendRows: 0, amendments: [] as string[][], abbreviations: [] as Array<{ short: string; long: string }>, suppliedEquipment: '', supplied: [] as string[][] };
    {
      let page = ''; let n = 0;
      const stripNo = (inl: Inline[]): Inline[] => (inl[0]?.t === 'text' ? [{ ...inl[0], text: inl[0].text.replace(/^\s*\d+\.\s*/, '') }, ...inl.slice(1)] : inl);
      for (const tok of frontTokens) {
        if (tok.k === 'p') {
          const t = tok.text.toUpperCase().replace(/\s+/g, ' ');
          if (/^C ?E ?R ?T ?I ?F ?I ?C ?A ?T ?E$/.test(t)) { page = 'certificate'; report.frontPages.push('certificate'); continue; }
          if (t === 'PREFACE') { page = 'preface'; report.frontPages.push('preface'); continue; }
          if (t === 'AMENDMENTS') { page = 'amendments'; report.frontPages.push('amendments'); continue; }
          if (t === 'ABBREVIATIONS') { page = 'abbreviations'; report.frontPages.push('abbreviations'); continue; }
          if (/^LIST OF EQUIPMENT ALREADY SUPPLIED/.test(t)) { page = 'supplied'; report.frontPages.push('supplied'); continue; }
          if (t === 'CONTENTS') { page = 'contents'; report.frontPages.push('contents'); continue; }
          if (tok.empty || BLANK.test(tok.text) || tok.style === 'Thgispageisintentionallyleftblank') continue;
          if (page === 'certificate') front.certificate = [...(front.certificate ?? []), ...(front.certificate ? [{ t: 'text', text: ' ' } as Inline] : []), ...tok.inline];
          else if (page === 'preface') {
            if (tok.style === 'SARalphanumeric') {
              const last = front.preface[front.preface.length - 1];
              if (/^\(?NOTE\b/i.test(tok.text) && last && last.k === 'list') last.items[last.items.length - 1].push(tok.inline);     // the NOTE belongs to item (a): the lettering goes on after it
              else if (last && last.k === 'list') last.items.push([tok.inline]); else front.preface.push({ k: 'list', items: [[tok.inline]] });
            } else front.preface.push({ k: 'para', indent: 2, inline: stripNo(tok.inline) });
          } else if (page === 'supplied') { const m = /^Name of the Equipment:?\s*(.*?)(?:\s+supplied against.*)?$/i.exec(tok.text); if (m) front.suppliedEquipment = m[1].replace(/\s+/g, ' ').trim(); }
          continue;
        }
        if (page === 'amendments') { front.amendRows = Math.max(front.amendRows, tok.rows.length - 1); for (const r of tok.rows.slice(1)) { const c = r.cells.map(cellText); if (c.some(Boolean)) front.amendments.push(c); } }
        else if (page === 'abbreviations') { for (const r of tok.rows) { const c = r.cells.map(cellText); if (/^sr\.?\s*no/i.test(c[0] ?? '')) continue; if (c[1] || c[2]) front.abbreviations.push({ short: c[1] ?? '', long: c[2] ?? '' }); } }
        else if (page === 'supplied') { for (const r of tok.rows.slice(1)) { const c = r.cells.map(cellText); if (c.length >= 4 && c.some(Boolean)) front.supplied.push(c); } }
        n++;
      }
      void n;
    }

    // ── the plates ──────────────────────────────────────────────────────────────────────────────────────────────────────────
    const plates: PlateM[] = []; let plate = null as PlateM | null; let view = null as View | null;
    const newView = (): View => { const v: View = { caption: '', graphics: [], parts: [], notes: [], sawParts: false }; plate?.views.push(v); return v; };
    const startPlate = (ref: string, title: string): PlateM => { plate = { ref, title: titleCase(title), caption: '', divider: false, setColumn: false, views: [] }; plates.push(plate); view = null; return plate; };
    const PLATE_CAP = /^PLATE\s*[-–]\s*(\S+)\s+(.+)$/i;
    const cleanRef = (r: string): string => r.replace(/\s+/g, '').replace(/[–—]/g, '-');
    const forPicture = (): View => { if (!plate) startPlate('I', 'Plate'); if (!view || view.sawParts) view = newView(); return view; };
    const gfx = (pics: Picture[], label?: string): Gfx[] => pics.map((p) => usePicture(p)).filter((x): x is { src: string; widthMm?: number } => !!x).map((x) => ({ ...x, ...(label ? { label } : {}) }));

    for (const tok of plateTokens) {
      if (tok.k === 'p') {
        if (tok.empty && !tok.pictures.length) continue;
        if (BLANK.test(tok.text) || tok.style === 'Thgispageisintentionallyleftblank') continue;
        const cap = PLATE_CAP.exec(tok.text);
        if (cap) {
          if ((tok.size ?? 0) >= 30) {                                                      // the divider page of the first plate: "PLATE - I GENERAL ASSEMBLY"
            const p = startPlate(cleanRef(cap[1]), cap[2]); p.divider = true; continue;
          }
          const ref = cleanRef(cap[1]);
          if (!plate || plate.ref !== ref) startPlate(ref, cap[2]);
          continue;
        }
        if ((tok.size ?? 0) >= 30) continue;                                                // the second line of the divider (the equipment name)
        if (tok.pictures.length) { const v = forPicture(); v.graphics.push(...gfx(tok.pictures)); }
        // the red caption under the picture
        if (tok.text && (upper(tok.color) === 'FF0000' || tok.style === 'Caption')) {
          if (plate && plate.divider && plate.views.length === 0 && !plate.caption && /ASSY OF|ASSEMBLY OF/i.test(tok.text) && !/\(VIEW/i.test(tok.text)) { plate.caption = tok.text; continue; }
          if (/\(VIEW\s*\d+\)/i.test(tok.text) || (view && !view.caption && !view.sawParts)) { const v = forPicture(); v.caption = tok.text; continue; }
          if (plate && plate.divider && !plate.caption && plate.views.length === 1 && view?.sawParts === false) { plate.caption = tok.text; continue; }
        }
        // anything else under a parts table is a note of that view
        if (view && view.sawParts && tok.text && !tok.pictures.length) { view.notes.push(tok.inline); continue; }
        if (plate && plate.divider && !plate.caption && tok.text && !view) { plate.caption = tok.text; continue; }
        continue;
      }
      // tables
      const first = squash(tok.rows[0]?.cells.map(cellText).join(' ') ?? '');
      if (hasPicture(tok)) {                                                                // a grid of pictures, each with its reference in the row below
        const v = forPicture(); const pics: Gfx[] = []; const labels: string[] = [];
        for (const r of tok.rows) { const rp = r.cells.flatMap((c) => c.paras.flatMap((p) => p.pictures)); if (rp.length) pics.push(...gfx(rp)); else for (const c of r.cells) { const t = cellText(c); if (t) labels.push(t); } }
        pics.forEach((g, i) => { if (labels[i]) g.label = labels[i]; }); v.graphics.push(...pics); report.figures++; continue;
      }
      if (/^Plate Ref\.? No/i.test(first)) continue;                                        // the index of the sub-plates: the engine makes it
      if (/^Item No/i.test(first)) {
        if (!plate) startPlate('I', 'Plate'); const v: View = view && !view.sawParts ? view : newView(); view = v; v.sawParts = true;
        const cols = tok.grid.length; if (cols >= 11) plate!.setColumn = true;
        report.tables++;
        const hc = Math.max(1, headCount(tok));
        for (const r of tok.rows.slice(hc)) {
          const c = r.cells.map(cellText); if (c.length < 8 || !c.some(Boolean)) continue;
          const set = cols >= 11;
          v.parts.push({ item: c[0] ?? '', plateRef: c[1] ?? '', provide: c[2] ?? '', nsn: c[3] ?? '', designation: c[4] ?? '', qty: c[5] ?? '', qtySet: set ? (c[6] ?? '') : '', drg: set ? (c[7] ?? '') : (c[6] ?? ''), firmPart: set ? (c[8] ?? '') : (c[7] ?? ''), price: set ? (c[9] ?? '') : (c[8] ?? ''), remark: set ? (c[10] ?? '') : (c[9] ?? '') });
        }
      }
    }

    // ── the appendices ──────────────────────────────────────────────────────────────────────────────────────────────────────
    const appendices: AppendixM[] = []; let appx: AppendixM | null = null; let expectTitle = false;
    for (const tok of appxTokens) {
      if (tok.k === 'p') {
        if (tok.empty || BLANK.test(tok.text) || tok.style === 'Thgispageisintentionallyleftblank') continue;
        const m = /^APPX\s*[‘'’`]?\s*([A-Z0-9]+)\s*[’'‘`]?$/i.exec(tok.text);
        if (m) { appx = { label: m[1].toUpperCase(), title: '', children: [] }; appendices.push(appx); expectTitle = true; continue; }
        if (!appx) continue;
        if (expectTitle) { appx.title = tok.text; expectTitle = false; continue; }
        report.paragraphs++; appx.children.push({ k: 'para', inline: tok.inline }); continue;
      }
      if (!appx) continue;
      report.tables++; appx.children.push({ k: 'table', table: tableOf(tok, headCount(tok)) });
    }

    // ── the XML ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const m = (k: string, v: string | undefined): string => (v ? `    <${k}>${esc(v)}</${k}>\n` : '');
    const lines = (name: string, ls: string[]): string => (ls.length ? `    <${name}>${ls.map((x) => `<line>${esc(x)}</line>`).join('')}</${name}>\n` : '');
    const metaXml = `  <meta>\n${m('docNo', meta.docNo)}${m('title', meta.title ?? 'ILLUSTRATED SPARE PARTS LIST (ISPL)')}${m('projectName', meta.projectName)}${m('atNo', meta.atNo)}${m('dated', meta.dated)}${m('nsn', meta.nsn)}${lines('supplier', supplier)}${lines('issuedBy', issuedBy)}${m('issueDate', meta.issueDate)}${m('equipmentLife', meta.equipmentLife)}    <qtyUnit>for 100m</qtyUnit>\n    <classification>RESTRICTED</classification>\n  </meta>\n`;

    let cert = front.certificate ? inlineXml(front.certificate) : '';
    if (cert) {
      if (meta.docNo) cert = cert.split(esc(meta.docNo)).join('{docNo}');
      cert = cert.replace(/contains\s+\d+\s+pages/i, 'contains {total} pages').replace(/from\s+1\s+to\s+\d+\s+as\s+main/i, 'from 1 to {mainLast} as main');
    }
    const prefaceXml = front.preface.map((b) => (b.k === 'para' ? `      <para${b.indent !== 2 ? ` indent="${b.indent}"` : ''}>${inlineXml(b.inline)}</para>` : `      <list type="alpha" indent="3">\n${b.items.map((i) => `        <item>${i.map((x) => `<text>${inlineXml(x)}</text>`).join('')}</item>`).join('\n')}\n      </list>`)).join('\n');
    const frontXml = [
      cert ? `    <certificate>${cert}</certificate>` : '',
      prefaceXml ? `    <preface>\n${prefaceXml}\n    </preface>` : '',
      `    <amendments minRows="${Math.max(20, front.amendRows || 20)}">${front.amendments.length ? '\n' + front.amendments.map((r) => `      <row no="${escA(r[0] ?? '')}" authority="${escA(r[1] ?? '')}" date="${escA(r[2] ?? '')}" by="${escA(r[3] ?? '')}"/>`).join('\n') + '\n    ' : ''}</amendments>`,
      `    <abbreviations>${front.abbreviations.length ? '\n' + front.abbreviations.map((a) => `      <abbr short="${escA(a.short)}" long="${escA(a.long)}"/>`).join('\n') + '\n    ' : ''}</abbreviations>`,
      `    <supplied equipment="${escA(front.suppliedEquipment)}">${front.supplied.length ? '\n' + front.supplied.map((r) => `      <row no="${escA(r[0] ?? '')}" dcan="${escA(r[1] ?? '')}" name="${escA(r[2] ?? '')}" order="${escA(r[3] ?? '')}"/>`).join('\n') + '\n    ' : ''}</supplied>`,
    ].filter(Boolean).join('\n');

    const graphicXml = (g: Gfx, pad: string): string => `${pad}<graphic src="${escA(g.src)}"${g.label ? ` label="${escA(g.label)}"` : ''}/>`;
    const partXml = (p: PartRow, pad: string): string => `${pad}<part item="${escA(p.item)}"${p.plateRef ? ` plateRef="${escA(p.plateRef)}"` : ''}${p.provide ? ` provide="${escA(p.provide)}"` : ''}${p.nsn ? ` nsn="${escA(p.nsn)}"` : ''} designation="${escA(p.designation)}"${p.qty ? ` qty="${escA(p.qty)}"` : ''}${p.qtySet ? ` qtySet="${escA(p.qtySet)}"` : ''}${p.drg ? ` drg="${escA(p.drg)}"` : ''}${p.firmPart ? ` firmPart="${escA(p.firmPart)}"` : ''}${p.price ? ` price="${escA(p.price)}"` : ''}${p.remark ? ` remark="${escA(p.remark)}"` : ''}/>`;
    const usedIds = new Set<string>();
    const plateXml = plates.map((p, i) => {
      let id = `p${i + 1}`; while (usedIds.has(id)) id += '_'; usedIds.add(id);
      const views = p.views.length ? p.views : [{ caption: '', graphics: [], parts: [], notes: [], sawParts: false } as View];
      return `    <plate id="${id}" ref="${escA(p.ref)}" title="${escA(p.title)}"${p.divider ? ' divider="true"' : ''}${p.setColumn ? ' setColumn="true"' : ''}${p.caption ? ` caption="${escA(p.caption)}"` : ''}>\n${views.map((v) => `      <view${v.caption ? ` caption="${escA(v.caption)}"` : ''}>\n${[...v.graphics.map((g) => graphicXml(g, '        ')), ...v.parts.map((x) => partXml(x, '        ')), ...v.notes.map((n) => `        <note>${inlineXml(n)}</note>`)].join('\n')}${v.graphics.length || v.parts.length || v.notes.length ? '\n' : ''}      </view>`).join('\n')}\n    </plate>`;
    }).join('\n');
    const appXml = appendices.map((a) => `    <appendix label="${escA(a.label)}" title="${escA(a.title)}" orientation="landscape">\n${a.children.map((c) => (c.k === 'para' ? `      <para>${inlineXml(c.inline)}</para>` : tableXml(c.table, '      '))).join('\n')}\n    </appendix>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<jsgdoc version="1.0" type="ispl">\n${metaXml}  <front>\n${frontXml}\n  </front>\n  <plates>\n${plateXml}\n  </plates>\n${appendices.length ? `  <appendices>\n${appXml}\n  </appendices>\n` : ''}</jsgdoc>\n`;

    report.chapters = 0; report.sections = plates.length; report.figures += plates.reduce((n, p) => n + p.views.length, 0);

    const written: string[] = [];
    if (opts.copyMedia !== false) {
      const dest = path.join(opts.projectDir, 'Media'); fs.mkdirSync(dest, { recursive: true });
      for (const rel of media) {
        const e = zip.entries.find((x) => x.name === `word/${rel}`); if (!e) { warnings.push(`The picture ${rel} is not in the file.`); continue; }
        await new Promise<void>((resolve, reject) => { const out = fs.createWriteStream(path.join(dest, path.basename(rel))); zip.open(e).on('error', reject).pipe(out).on('finish', () => resolve()).on('error', reject); });
        written.push(`Media/${path.basename(rel)}`);
      }
    }
    return { xml, media: written, report };
  } finally { zip.close(); }
}
