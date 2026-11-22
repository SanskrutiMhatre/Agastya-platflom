// Structured (grammar-driven) editing of the CSDB objects that are authored, not generated: Comment, Data update file and ICN metadata
// (and the SCORM content package), booted in the REAL embedded editor (Phase 18; closes the Phase 17 "Studio editing" gap).
// Fixtures are the platform's own server templates (backend/scripts/gen-object-fixtures.js), schema-valid by the server's XSD check.
//   1. opening binds the object's OWN grammar and schema (issue + schema from xsi:noNamespaceSchemaLocation)
//   2. nothing is rewritten on open: the content is identical (the editor only indents; whitespace between tags is the one difference)
//   3. legal insertions through the editor never break the structure (checked by native xmllint against the bundled XSD) and undo is exact
//   4. a tag from another schema is refused and leaves the document untouched
// 7.0 has no Comment / Update / SCORM schema and so no grammar: nothing is invented (asserted).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { gj, xsdValidate } from './lib';
import { bootApp } from './harness';
import { caretIn } from './editorChecks';
import { elementChildren } from '../../core/xml';

const FX = path.resolve(__dirname, '../rich/objects');
const KINDS: Array<[string, string]> = [['comment', 'comment'], ['update', 'update'], ['imf', 'icnmetadata'], ['scorm', 'scormcontentpackage']];
const CM = /not expected|Missing child element/;
const grammarDamage = (ed: NonNullable<Awaited<ReturnType<ReturnType<typeof bootApp>['openText']>>>): string[] => {
  const g = ed.grammar!; const out: string[] = [];
  for (const e of Array.from(ed.doc.xml.getElementsByTagName('*'))) {
    if (!g.has(e.nodeName)) continue;
    const kids = elementChildren(e).map((k) => k.nodeName);
    if (!g.isRepairable(e.nodeName, kids)) out.push(`<${e.nodeName}> [${kids.join(',')}]`);
  }
  return out;
};
const squash = (s: string): string => s.replace(/>\s+</g, '><').trim();

describe('structured editing of CSDB objects in the embedded editor', () => {
  for (const issue of ['4-2', '5-0', '6', '7']) {
    for (const [kind, schema] of KINDS) {
      const file = path.join(FX, issue, `${kind}.xml`);
      if (!fs.existsSync(file)) {
        it(`${issue} ${kind}: no fixture because no ${schema} schema/template exists for this issue (nothing invented)`, () => {
          expect(issue === '7' || kind === 'scorm').toBe(true);
          const g = path.resolve(__dirname, '../../../../public/grammar', issue, `${schema}.json`);
          if (issue === '7') expect(fs.existsSync(g)).toBe(kind === 'imf');
        });
        continue;
      }
      it(`${issue} ${kind}`, async () => {
        const app = bootApp();
        const text = fs.readFileSync(file, 'utf8');
        const ed = (await app.openText(text, `${kind}.xml`, null))!;
        expect(ed, 'the editor opened the document').toBeTruthy();
        const g = ed.grammar!;
        // 1. its own rules
        expect(g, 'a grammar is bound').toBeTruthy();
        expect(gj(g).schema).toBe(schema);
        expect(gj(g).issue).toBe(issue);
        expect(ed.doc.schemaRef?.schema).toBe(schema);
        expect(ed.doc.schemaRef?.issue).toBe(issue);
        // 2. nothing rewritten on open (the editor indents element-only content; compare modulo whitespace between tags)
        expect(squash(ed.doc.toString())).toBe(squash(text));

        // 3. legal insertions
        let inserted = 0; const seen = new Set<string>();
        const els = Array.from(ed.doc.xml.getElementsByTagName('*')).filter((e) => e.parentElement && g.has(e.nodeName) && g.has(e.parentElement.nodeName));
        for (const E of els) {
          if (inserted >= 5) break;
          const P = E.parentElement!; const sibs = elementChildren(P); const at = sibs.indexOf(E) + 1;
          for (const X of g.allowedAt(P.nodeName, sibs.map((s) => s.nodeName), at)) {
            const k = `${P.nodeName}>${X}`; if (seen.has(k) || inserted >= 5) continue;
            seen.add(k);
            ed.selectElement(E);
            const before = ed.doc.toString();
            ed.insertElementNamed(X);
            const after = ed.doc.toString();
            if (after === before) continue;                       // the editor chose not to (e.g. an attribute-only or wrapper case)
            // SCORM: its XSD imports the IEEE LOM schema, which is not bundled, so xmllint cannot compile it (reported, not hidden):
            // the structure is then judged by the compiled grammar alone - evidence of lower strength, stated in the compliance matrix.
            const bad = schema === 'scormcontentpackage' ? grammarDamage(ed) : (await xsdValidate(after, issue, schema)).errors.filter((e) => CM.test(e.msg)).map((e) => `${e.el}: ${e.msg}`);
            expect(bad, `inserting <${X}> after <${E.nodeName}> in <${P.nodeName}> broke the structure`).toEqual([]);
            expect(ed.doc.undo()).toBe(true);
            expect(ed.doc.toString(), 'undo restores the document').toBe(before);
            ed.clearElementSelection?.();
            inserted++;
          }
        }
        expect(inserted, `at least one legal insertion was exercised in <${gj(g).root ?? schema}>`).toBeGreaterThan(0);

        // 4. a foreign tag is refused
        const content = Array.from(ed.doc.xml.getElementsByTagName('*')).find((e) => e.nodeName === 'content' || e.nodeName === 'commentContent' || e.nodeName === 'updateContent') ?? ed.doc.xml.documentElement;
        for (const F of ['proceduralStep', 'illustratedPartsCatalog', 'faultIsolation']) {
          caretIn(ed, content, 0);
          const before = ed.doc.toString();
          expect(g.has(F)).toBe(false);
          ed.insertElementNamed(F);
          expect(ed.doc.toString(), `foreign <${F}> changed the document`).toBe(before);
        }
      });
    }
  }
});
