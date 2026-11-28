// =============================================================================
// PDF review: from a place in a generated PDF back to the source it was built from (P3-4 "link back to the source module").
//
// The builds do not carry the source of every line in the PDF (FOP writes bookmarks but no per-block ids a reader can map back), so the
// link is found by the text the comment was made on: the quote is searched in the project's sources, folded and without white space like
// the anchors (shared/pdfAnchor.ts), whole first and then by its longest pieces between generated numbering ("1.2", "Fig 3"):
//   S1000D  the data module whose text holds the quote  -> the editor opens that module   (?file=<DMC file>)
//   JSS     the chapter introduction or top-level section (the outline's module) -> the editor scrolls there (?goto=<module key>)
//   JSG     the section, appendix or plate                                            (?goto=<module key>)
// Found nowhere (a generated page: cover, contents, a list) -> no link; the review still works.
// =============================================================================

import { DOMParser } from '@xmldom/xmldom';
import { listDms } from '../csdbIndex';
import { readDm } from '../csdb';
import { foldCompact } from '../../shared/pdfAnchor';
import { outlineOfJsg, outlineOfJss } from '../xengine/outline';
import { readSource as readJss } from '../jss/service';
import { readSource as readJsg } from '../jsg/service';
import { projectFormat } from './files';

export interface SourceRef { kind: 'dm' | 'module'; file?: string; key?: string; title: string }

const ENT: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
/** The words of an XML text, tags removed and entities decoded (enough for a search; not a parser). */
export function xmlWords(xml: string): string {
  return xml.replace(/<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE[\s\S]*?(\[[\s\S]*?\])?>/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : (ENT[e] ?? m));
}

/** The search keys of a quote: the whole quote, then its pieces between numbers, longest first (at least 12 characters each). */
export function probesOf(quote: string): string[] {
  const whole = foldCompact(quote);
  const pieces = quote.split(/(?:\b\d+(?:\.\d+)*[.)]?|\bfig(?:ure)?\.?|\btable\b|\bpage\b)/i).map(foldCompact).filter((p) => p.length >= 12).sort((a, b) => b.length - a.length);
  return [...new Set([whole.length >= 6 ? whole : '', ...pieces].filter(Boolean))].slice(0, 6);
}

const dmText = new Map<string, { modified: string; text: string }>();
function compactDm(projectId: string, file: string, modified: string): string {
  const k = `${projectId}/${file}`; const hit = dmText.get(k);
  if (hit && hit.modified === modified) return hit.text;
  let text = '';
  try { text = foldCompact(xmlWords(readDm(projectId, file).xml)); } catch { text = ''; }
  if (dmText.size > 5000) dmText.clear();
  dmText.set(k, { modified, text });
  return text;
}

const kids = (e: Element): Element[] => { const o: Element[] = []; for (let n = e.firstChild; n; n = n.nextSibling) if (n.nodeType === 1) o.push(n as Element); return o; };
/** Text of an element and the titles in its attributes (JSG keeps titles in attributes), without the children `skip` names. */
function textOf(e: Element, skip?: (c: Element) => boolean): string {
  let s = e.getAttribute?.('title') ? ` ${e.getAttribute('title')} ` : '';
  for (let n = e.firstChild; n; n = n.nextSibling) {
    if (n.nodeType === 3 || n.nodeType === 4) s += n.nodeValue ?? '';
    else if (n.nodeType === 1 && !(skip && skip(n as Element))) s += ` ${textOf(n as Element)} `;
  }
  return s;
}

/** The module elements of a JSS / JSG document in the outline's order (outline.ts), each with its folded text. */
function moduleTexts(format: 'jss' | 'jsg', xml: string): Array<{ key: string; title: string; text: string }> {
  const outline = format === 'jsg' ? outlineOfJsg(xml) : outlineOfJss(xml);
  const root = new DOMParser({ onError: () => undefined }).parseFromString(xml, 'text/xml').documentElement as unknown as Element;
  const els: Array<{ el: Element; skip?: (c: Element) => boolean }> = [];
  if (format === 'jss') {
    const body = kids(root).find((c) => c.tagName === 'body');
    for (const ch of body ? kids(body).filter((c) => c.tagName === 'chapter') : []) {
      if (kids(ch).some((c) => c.tagName !== 'title' && c.tagName !== 'section')) els.push({ el: ch, skip: (c) => c.tagName === 'section' });
      for (const s of kids(ch).filter((c) => c.tagName === 'section')) els.push({ el: s });
    }
  } else {
    for (const ch of kids(root).filter((c) => c.tagName === 'chapter')) for (const s of kids(ch).filter((c) => c.tagName === 'section')) els.push({ el: s });
    const apps = kids(root).find((c) => c.tagName === 'appendices'); for (const a of apps ? kids(apps).filter((c) => c.tagName === 'appendix') : []) els.push({ el: a });
    const plates = kids(root).find((c) => c.tagName === 'plates'); for (const p of plates ? kids(plates).filter((c) => c.tagName === 'plate') : []) els.push({ el: p });
  }
  if (els.length !== outline.modules.length) return [];       // the outline and this walk disagree: no link rather than a wrong one
  return outline.modules.map((m, i) => ({ key: m.key, title: m.title, text: foldCompact(textOf(els[i].el, els[i].skip)) }));
}

/** Where the words `quote` come from in the project's sources, or null. */
export function traceSource(projectId: string, quote: string | null | undefined): SourceRef | null {
  if (!quote || !quote.trim()) return null;
  const probes = probesOf(quote);
  if (!probes.length) return null;
  const fmt = projectFormat(projectId);
  try {
    if (fmt === 's1000d') {
      const dms = listDms(projectId);
      for (const p of probes) {
        for (const d of dms) if (compactDm(projectId, d.file, d.modified).includes(p)) return { kind: 'dm', file: d.file, title: d.title || [d.techName, d.infoName].filter(Boolean).join(' - ') || d.file };
      }
      return null;
    }
    const xml = (fmt === 'jsg' ? readJsg(projectId) : readJss(projectId)).xml;
    const mods = moduleTexts(fmt, xml);
    for (const p of probes) { const m = mods.find((x) => x.text.includes(p)); if (m) return { kind: 'module', key: m.key, title: m.title }; }
  } catch { /* a project without a readable source: no link */ }
  return null;
}
