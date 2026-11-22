// The REAL embedded editor (ui/app.ts + ui/editor.ts, booted in jsdom) on a realistic document of each wizard type and issue:
//  1. opening binds the type's OWN rules (grammar + schema reference)                         (no cross-type contamination)
//  2. tag suggestions: every tag the XSD allows at a caret is offered; nothing that cannot belong there is ever offered
//  3. a tag from another type is refused and leaves the document untouched
//  4. a legal tag inserted through the editor leaves the document XSD-valid, and undo restores it exactly
//  5. paste: legal text goes in, malformed XML is only ever text, a foreign tag never creates an invalid structure
//  6. all 21 types open side by side and switching between them applies the right rules every time
// Oracles are INDEPENDENT of the grammar under test: "what the XSD allows" is asked of the XSD through native xmllint, and "what can
// ever be a child here" comes from the reference dictionaries (vim-s1000d). A corrupted grammar must therefore be caught (see the control).
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ISSUES, TYPES, LABEL, gram, gj, richDm, xsdValidate, RESULTS } from './lib';
import { bootApp } from './harness';
import { caretIn, foreignNames, suggestionFindings } from './editorChecks';
import { elementChildren } from '../../core/xml';
import type { DocumentEditor } from '../../ui/editor';

const CM = /not expected|Missing child element/;
/** Per type/issue: tags that fit only BEFORE an existing sibling and that the editor therefore never offers (reported as a finding). */
const beforeOnly: Record<string, string[]> = {};
const results: Record<string, Record<string, number>> = {};
const note = (k: string, field: string, n = 1) => { (results[k] ??= {})[field] = (results[k][field] ?? 0) + n; };

describe('the embedded editor, per type and issue', () => {
  for (const type of TYPES) {
    for (const issue of ISSUES) {
      it(`${LABEL[type]} (${type}) ${issue}`, async () => {
        const key = `${type}/${issue}`;
        const app = bootApp();
        const text = richDm(type, issue);
        const ed = (await app.openText(text, 'dm.xml', null))!;
        const g = ed.grammar!;
        // 1. its own rules
        expect(gj(g).schema).toBe(type);
        expect(gj(g).issue).toBe(issue);
        expect(ed.doc.schemaRef?.schema).toBe(type);
        expect(ed.doc.schemaRef?.issue).toBe(issue);
        const els = Array.from(ed.doc.xml.getElementsByTagName('*'));

        // 2. tag suggestions at the carets an author can produce
        const f = await suggestionFindings(ed, issue, type, text);
        note(key, 'suggestionPositions', f.positions);
        note(key, 'beforeOnlyGap', new Set(f.beforeOnly).size);
        beforeOnly[key] = [...new Set(f.beforeOnly)];
        expect(f.complete, 'tags the XSD allows at a caret/selection but the editor does not offer').toEqual([]);
        expect(f.foreignOffered, 'tags offered that cannot belong here').toEqual([]);

        // 3. a tag of another type is refused, document untouched
        const content = els.find((e) => e.nodeName === 'content')!;
        const fn = foreignNames(issue, type);
        for (const F of fn) {
          caretIn(ed, content, 0);
          const before = ed.doc.toString();
          expect(g.has(F), `<${F}> belongs to another type`).toBe(false);
          expect(ed.canInsert(F)).toBe(false);
          ed.insertElementNamed(F);
          expect(ed.doc.toString(), `inserting foreign <${F}> changed the document`).toBe(before);
        }
        note(key, 'foreignRefused', fn.length);

        // 4. legal insertion through the editor: XSD-valid afterwards, undo exact
        let inserted = 0;
        const seen = new Set<string>();
        for (const { E, X } of f.candidates) {
          if (inserted >= 6) break;
          const P = E.parentElement!;
          const k = `${P.nodeName}>${X}`;
          if (seen.has(k) || ['dmodule', 'identAndStatusSection', 'dmAddress', 'dmStatus', 'dmIdent', 'dmAddressItems', 'dmTitle'].includes(P.nodeName)) continue;
          seen.add(k);
          ed.selectElement(E);
          const before = ed.doc.toString();
          ed.insertElementNamed(X);
          const after = ed.doc.toString();
          expect(after, `<${X}> was not inserted after <${E.nodeName}> in <${P.nodeName}>`).not.toBe(before);
          const r = await xsdValidate(after, issue, type);
          const bad = r.errors.filter((e) => CM.test(e.msg)).map((e) => `${e.el}: ${e.msg}`);
          expect(bad, `inserting <${X}> after <${E.nodeName}> in <${P.nodeName}> broke the structure`).toEqual([]);
          expect(ed.doc.undo()).toBe(true);
          expect(ed.doc.toString(), 'undo restores the document').toBe(before);
          ed.clearElementSelection?.();
          inserted++;
        }
        note(key, 'legalInserts', inserted);
        expect(inserted, 'at least one legal insertion was exercised for this type').toBeGreaterThan(0);

        // 5. paste
        const textBlock = els.find((e) => g.has(e.nodeName) && g.isMixed(e.nodeName)) ?? els.find((e) => g.has(e.nodeName) && g.allowsText(e.nodeName));
        const damaged = (): string[] => {
          const list: string[] = [];
          for (const e of Array.from(ed.doc.xml.getElementsByTagName('*'))) {
            if (!g.has(e.nodeName)) continue;
            const kids = elementChildren(e).map((k) => k.nodeName);
            if (!g.isRepairable(e.nodeName, kids)) list.push(`<${e.nodeName}> [${kids.join(',')}]`);
          }
          return list;
        };
        expect(damaged()).toEqual([]);
        expect(textBlock, 'every type has a text-bearing element to paste into').toBeTruthy();
        for (const payload of ['plain pasted words', '<para>unclosed <b>', '<a><b></a></b>', 'x < y & z > w']) {
          caretIn(ed, textBlock!, 0);
          const rootKids = elementChildren(ed.doc.xml.documentElement).length;
          ed.pasteSource({ xml: payload, text: payload });
          expect(damaged(), `pasting ${JSON.stringify(payload)} damaged the structure`).toEqual([]);
          expect(elementChildren(ed.doc.xml.documentElement).length).toBe(rootKids);
          expect(new DOMParser().parseFromString(ed.doc.toString(), 'application/xml').getElementsByTagName('parsererror').length, 'document is still well-formed').toBe(0);
        }
        note(key, 'pastesText', 4);
        for (const F of fn.slice(0, 3)) {
          caretIn(ed, textBlock!, 0);
          ed.pasteSource({ xml: `<${F}>x</${F}>`, text: `<${F}>x</${F}>` });
          expect(damaged(), `pasting a foreign <${F}> damaged the structure`).toEqual([]);
          expect(ed.doc.xml.getElementsByTagName(F).length, `foreign <${F}> ended up in the document`).toBe(0);
        }
        note(key, 'pastesForeign', Math.min(3, fn.length));
      }, 240_000);
    }
  }
});

describe('switching between types in one editor session', () => {
  it('all 21 types open side by side; every switch applies that type\'s rules and nothing else', async () => {
    for (const issue of ISSUES) {
      const app = bootApp();
      const eds = new Map<string, DocumentEditor>();
      for (const type of TYPES) eds.set(type, (await app.openText(richDm(type, issue), `${type}.xml`, null))!);
      const order = [...TYPES, ...[...TYPES].reverse(), ...TYPES.filter((_t, i) => i % 3 === 0)];
      for (const type of order) {
        const ed = eds.get(type)!;
        app.activate(ed, false);
        expect(app.active).toBe(ed);
        expect(gj(app.active!.grammar!).schema).toBe(type);
        expect(app.active!.doc.schemaRef?.schema).toBe(type);
        const g = ed.grammar!;
        expect(g.has(g.requiredChildren('content')[0])).toBe(true);
        for (const other of TYPES) {
          if (other === type) continue;
          const otherBody = gram(issue, other).requiredChildren('content')[0];
          if (!g.has(otherBody)) expect(ed.canInsert(otherBody), `${otherBody} (${other}) must not be insertable in a ${type} module`).toBe(false);
        }
      }
      note(`switching/${issue}`, 'switches', order.length);
    }
  }, 300_000);
});

afterAll(() => {
  const dir = RESULTS;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'editor.json'), JSON.stringify(results, null, 1));
  fs.writeFileSync(path.join(dir, 'editor-before-only.json'), JSON.stringify(beforeOnly, null, 1));
});
