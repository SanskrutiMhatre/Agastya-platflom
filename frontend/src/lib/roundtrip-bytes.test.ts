// GAP-005 (audit WP-15): what saving a JSS or JSG document from the editor or the Publication page does to its bytes. Those pages parse the
// document into the editor's model and serialise it again, so a document is rewritten even when nobody changed it.
//
// Measured over every starting document the server writes (all 28 JSS types, __fixtures__/jss-skeletons.json, generated from the backend's
// skeletonXml) and the two full JSG reference documents (backend/samples/jsg-uhb, jsg-ispl):
//   - the model survives: parsing the saved text gives the same model as parsing the original;
//   - nothing is lost: every text and every attribute value of the original is still there;
//   - the first save is the last change: saving the saved text again gives the same bytes (idempotent);
//   - the first save changes ONLY the following, all of them equivalent XML (the schema allows either form):
//       JSS: the indentation, and an empty element written as <cell></cell> instead of <cell/>;
//       JSG: the indentation, and the front-matter pages written in the editor's order (the schema's <front> is an xs:all; the PDF order comes
//            from the stylesheet, not from the file).
//     Two more JSG differences were removed by WP-15 rather than accepted: the cover fields moved the supplier and issuer lines to the end of
//     <meta>, and a plate wrote caption= before divider=; both are now written where the server writes them (frontend/src/jsg/xml.ts).
import { describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseJss, serializeJss } from '../jss/xml';
import { parseJsg, serializeJsg } from '../jsg/xml';

const ROOT = path.resolve(__dirname, '../../..');
const JSS: Record<string, string> = JSON.parse(fs.readFileSync(path.join(__dirname, '__fixtures__', 'jss-skeletons.json'), 'utf8'));
const JSG: Record<string, string> = Object.fromEntries(['jsg-uhb', 'jsg-ispl'].map((k) => [k, fs.readFileSync(path.join(ROOT, 'backend', 'samples', k, 'jsg-document.xml'), 'utf8')]));

/** The same XML with the indentation and the empty-element spelling made uniform. */
const layoutFree = (s: string): string => s.replace(/>\s+</g, '><').replace(/<([\w:-]+)((?:\s+[\w:-]+="[^"]*")*)\s*\/>/g, '<$1$2></$1>').trim();
/** Every text and attribute value, sorted: what a reader could miss if it were dropped. */
const values = (s: string): string[] => [
  ...[...s.matchAll(/>([^<]+)</g)].map((m) => m[1].trim()).filter(Boolean),
  ...[...s.matchAll(/\s([\w:-]+)="([^"]*)"/g)].map((m) => `@${m[1]}=${m[2]}`),
].sort();
/** <front> with its pages in name order, for the comparison only. */
const frontSorted = (s: string): string => s.replace(/<front([^>]*)>([\s\S]*?)<\/front>/, (_m, a: string, inner: string) => {
  const parts: string[] = []; let rest = inner;
  while (rest) {
    const m = /^<([\w-]+)[^>]*?(?:\/>|>[\s\S]*?<\/\1>)/.exec(rest); if (!m) { parts.push(rest); break; }
    parts.push(m[0]); rest = rest.slice(m[0].length);
  }
  return `<front${a}>${parts.sort().join('')}</front>`;
});

describe('saving an unchanged JSS document (GAP-005)', () => {
  it('covers every JSS type', () => { expect(Object.keys(JSS)).toHaveLength(28); });
  for (const [id, xml] of Object.entries(JSS)) {
    it(`${id}: same model, nothing lost, idempotent, layout-only difference`, () => {
      const once = serializeJss(parseJss(xml));
      expect(parseJss(once)).toEqual(parseJss(xml));
      expect(values(once)).toEqual(values(xml));
      expect(serializeJss(parseJss(once))).toBe(once);
      expect(layoutFree(once)).toBe(layoutFree(xml));
    });
  }
});

describe('saving an unchanged JSG document (GAP-005)', () => {
  for (const [id, xml] of Object.entries(JSG)) {
    it(`${id}: same model, nothing lost, idempotent, layout and front-page order only`, () => {
      const once = serializeJsg(parseJsg(xml));
      expect(parseJsg(once)).toEqual(parseJsg(xml));
      expect(values(once)).toEqual(values(xml));
      expect(serializeJsg(parseJsg(once))).toBe(once);
      expect(frontSorted(layoutFree(once))).toBe(frontSorted(layoutFree(xml)));
      // the cover fields stay in the server's order: supplier and issuer after the NSN
      const meta = (s: string) => [.../<meta>([\s\S]*?)<\/meta>/.exec(s)![1].matchAll(/<([\w]+)>/g)].map((m) => m[1]).filter((n) => n !== 'line');
      expect(meta(once)).toEqual(meta(xml));
    });
  }
});
