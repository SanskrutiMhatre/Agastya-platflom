// Foreign-namespace content survives the Studio's parse -> serialise round trip (nothing is dropped or rewritten),
// and the new document-type schemas have compiled grammars (Phase 17).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { parseXml, serialize } from '../core/xml';
import { grammarFromJson, type GrammarJson } from '../core/grammar';

const PUB = path.resolve(__dirname, '../../../public');

describe('extension content in the editor', () => {
  it('keeps a foreign namespace declaration, element, attribute and text exactly', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<dmodule xmlns:m="http://example.com/ns/maint"><content><description><levelledPara><title>T</title><para>plain</para><m:tag level="2" m:flag="x"><m:owner>Ops &amp; Co</m:owner></m:tag></levelledPara></description></content></dmodule>`;
    const parsed = parseXml(xml);
    const out = serialize(parsed.doc.documentElement).text;
    expect(out).toContain('xmlns:m="http://example.com/ns/maint"');
    expect(out).toContain('<m:tag level="2" m:flag="x">');
    expect(out).toContain('<m:owner>Ops &amp; Co</m:owner>');
    expect(out).toContain('</m:tag>');
    // and a second round trip is stable
    expect(serialize(parseXml(out).doc.documentElement).text).toBe(out);
  });
});

describe('grammars for the document types beyond the 21 data modules', () => {
  for (const [issue, schemas] of [['4-2', ['ddn', 'comment', 'update', 'scormcontentpackage', 'dml', 'icnmetadata', 'pm']], ['5-0', ['ddn', 'comment', 'update', 'scormcontentpackage', 'dml', 'icnmetadata', 'pm']], ['6', ['ddn', 'comment', 'update', 'scormcontentpackage', 'dml', 'icnmetadata', 'pm']], ['7', ['dml', 'icnmetadata', 'pm']]] as const) {
    it(`issue ${issue}: ${schemas.join(', ')}`, () => {
      for (const s of schemas) {
        const g = grammarFromJson(JSON.parse(fs.readFileSync(path.join(PUB, 'grammar', issue, `${s}.json`), 'utf8')) as GrammarJson);
        expect(g).toBeTruthy();
      }
    });
  }
  it('7.0 has no ddn / comment / update / scorm grammar (the schemas are not bundled)', () => {
    for (const s of ['ddn', 'comment', 'update', 'scormcontentpackage']) expect(fs.existsSync(path.join(PUB, 'grammar', '7', `${s}.json`))).toBe(false);
  });
});
