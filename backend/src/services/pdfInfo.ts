// WP-15 (PUB-017): the PDF's document properties (Title, Author, Subject, Keywords, Creator tool), for all three engines.
//
// FOP writes the document information dictionary and the XMP metadata stream from an <fo:declarations> block holding an <x:xmpmeta> packet
// (Dublin Core title / creator / description, the PDF schema's Keywords, the XMP schema's CreatorTool). None of the stylesheets (s1000dtofo, jsstofo,
// the JSG engine) writes one, so the built PDFs had no Title and no Author. Rather than change three stylesheets (one of them the owner's isolated
// JSG engine, two vendored), the block is put into the FO after the stylesheet ran and before FOP reads it: the same place the security confinement
// (foGuard) edits the FO. The page content is not touched.
//
// Decisions (audit D9, PUB-017), taken as the audit recommends: metadata yes; tagged PDF (FOP accessibility) and PDF/A NO, because neither JSS-0251 nor
// S1000D requires them and tagging makes FOP slower and stricter on every build; Arial stays embedded (the owner's earlier decision, licence basis in
// backend/vendor/tools/fonts/README.md).

import fs from 'fs';
import { escText } from '../lib/xml';

export interface PdfInfo { title?: string; author?: string; subject?: string; keywords?: string }

const clean = (s: string | undefined): string => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/\s+/g, ' ').trim().slice(0, 300);

/** The <fo:declarations> block for `info` (empty fields are left out). */
export function declarationsXml(info: PdfInfo): string {
  const t = clean(info.title); const a = clean(info.author); const s = clean(info.subject); const k = clean(info.keywords);
  return '<fo:declarations><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + `<rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:pdf="http://ns.adobe.com/pdf/1.3/" xmlns:xmp="http://ns.adobe.com/xap/1.0/">`
    + (t ? `<dc:title>${escText(t)}</dc:title>` : '')
    + (a ? `<dc:creator>${escText(a)}</dc:creator>` : '')
    + (s ? `<dc:description>${escText(s)}</dc:description>` : '')
    + (k ? `<pdf:Keywords>${escText(k)}</pdf:Keywords>` : '')
    + '<xmp:CreatorTool>Agastya</xmp:CreatorTool>'
    + '</rdf:Description></rdf:RDF></x:xmpmeta></fo:declarations>';
}

/**
 * Put the document properties into the FO file `foAbs` (after </fo:layout-master-set>, where XSL-FO allows <fo:declarations>), replacing a block a
 * stylesheet may already have written. Returns false when the FO has no layout master set (nothing is changed then).
 */
export function injectPdfInfo(foAbs: string, info: PdfInfo): boolean {
  const fo = fs.readFileSync(foAbs, 'utf8');
  const without = fo.replace(/<fo:declarations\b[\s\S]*?<\/fo:declarations>/, '');
  const at = without.indexOf('</fo:layout-master-set>');
  if (at < 0) return false;
  const end = at + '</fo:layout-master-set>'.length;
  fs.writeFileSync(foAbs, `${without.slice(0, end)}${declarationsXml(info)}${without.slice(end)}`, 'utf8');
  return true;
}

/** The first text of an element in an XML text, for picking titles out of a document without parsing it. */
export function firstText(xml: string, tag: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`).exec(xml);
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim() : '';
}

/** An attribute of the first element of that name. */
export function firstAttr(xml: string, tag: string, attr: string): string {
  const m = new RegExp(`<${tag}\\b[^>]*\\b${attr}="([^"]*)"`).exec(xml);
  return m ? m[1] : '';
}

