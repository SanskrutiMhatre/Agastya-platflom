// =============================================================================
// Rendering CSDB objects (Comment, Update, DML, DDN, IMF, SCORM package) as HTML and as PDF.
//
// The same rule as the data module HTML: nothing is silently omitted. Every element is shown with its name, its attributes and its text; the
// identification section is shown too. PDF is XSL-FO written here and rendered by the same FOP service the publications use.
// =============================================================================

import fs from 'fs';
import path from 'path';
import { DOMParser } from '@xmldom/xmldom';
import { projectDirFor, workspaceDir } from '../context';
import { bad } from './http';
import { CSS } from './htmlPublish';
import { vendor } from '../config';

const fopd = vendor('engine/fopd');
const foGuard = vendor('engine/foGuard');

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const strip = (xml: string) => xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/, '');
const SKIP = new Set(['xmlns', 'xmlns:xsi', 'xmlns:xlink', 'xmlns:dc', 'xmlns:rdf', 'xsi:noNamespaceSchemaLocation']);
const kids = (n: any): any[] => Array.from(n.childNodes ?? []);
const attrs = (n: any): Array<[string, string]> => (Array.from(n.attributes ?? []) as any[]).filter((a) => !SKIP.has(a.name) && a.value !== '').map((a) => [a.name, a.value]);

function parse(xml: string): any { const d = new DOMParser({ onError: () => undefined }).parseFromString(strip(xml), 'text/xml'); if (!d.documentElement) throw bad('The file could not be parsed.', 'NOT_WELL_FORMED'); return d.documentElement; }

export function objectHtml(xml: string, title?: string): string {
  const root = parse(xml);
  const walk = (n: any): string => {
    const ch = kids(n); const els = ch.filter((c) => c.nodeType === 1); const text = ch.filter((c) => c.nodeType === 3 || c.nodeType === 4).map((c) => c.nodeValue ?? '').join('').replace(/\s+/g, ' ').trim();
    const a = attrs(n).map(([k, v]) => `<span class="attr">${esc(k)}=${esc(v)}</span>`).join('');
    const inner = ch.map((c) => (c.nodeType === 1 ? walk(c) : c.nodeType === 3 || c.nodeType === 4 ? ((c.nodeValue ?? '').trim() && els.length ? `<span>${esc((c.nodeValue ?? '').trim())}</span>` : '') : '')).join('');
    return `<div class="x"><span class="x-label">${esc(n.nodeName)}</span>${a}${els.length ? inner : esc(text)}</div>`;
  };
  const heading = title || root.nodeName;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>${esc(heading)}</title><style>${CSS}</style></head><body><main><h1>${esc(heading)}</h1>${walk(root)}</main></body></html>\n`;
}

/** XSL-FO for an object: a title, then every element as an indented block (name, attributes, text). */
export function objectFo(xml: string, title: string): string {
  const root = parse(xml);
  const walk = (n: any, depth: number): string => {
    const ch = kids(n); const els = ch.filter((c) => c.nodeType === 1); const text = ch.filter((c) => c.nodeType === 3 || c.nodeType === 4).map((c) => c.nodeValue ?? '').join('').replace(/\s+/g, ' ').trim();
    const a = attrs(n).map(([k, v]) => `${k}="${v}"`).join('  ');
    return `<fo:block margin-left="${Math.min(depth, 14) * 3}mm" space-before="1.2mm" font-size="9pt"><fo:inline font-weight="bold" color="#555555">${esc(n.nodeName)}</fo:inline>${a ? `<fo:inline font-size="7.5pt" color="#555555">  ${esc(a)}</fo:inline>` : ''}${text && !els.length ? ` ${esc(text)}` : ''}${els.map((c) => walk(c, depth + 1)).join('')}</fo:block>`;
  };
  return `<?xml version="1.0" encoding="UTF-8"?>\n<fo:root xmlns:fo="http://www.w3.org/1999/XSL/Format"><fo:layout-master-set><fo:simple-page-master master-name="p" page-height="297mm" page-width="210mm" margin="18mm"><fo:region-body margin-bottom="10mm"/><fo:region-after extent="8mm"/></fo:simple-page-master></fo:layout-master-set><fo:page-sequence master-reference="p" font-family="Helvetica"><fo:static-content flow-name="xsl-region-after"><fo:block text-align="center" font-size="8pt"><fo:page-number/></fo:block></fo:static-content><fo:flow flow-name="xsl-region-body"><fo:block font-size="15pt" font-weight="bold" space-after="4mm">${esc(title)}</fo:block>${walk(root, 0)}</fo:flow></fo:page-sequence></fo:root>\n`;
}

export async function objectPdf(projectId: string, xml: string, title: string): Promise<string> {
  const dir = projectDirFor(projectId); const foPath = path.join(dir, '_object.fo'); const pdfPath = path.join(dir, '_object.pdf');
  fs.writeFileSync(foPath, objectFo(xml, title), 'utf8');
  foGuard.confineFo(foPath, { baseDir: dir, roots: [path.join(workspaceDir, 'templates')] });   // WP-02 / SEC-003
  await fopd.render({ baseDir: dir, foPath, pdfPath });
  fs.rmSync(foPath, { force: true });
  return pdfPath;
}
