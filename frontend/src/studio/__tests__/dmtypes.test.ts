// The seven data module types the New-data-module wizard offers.
//  1. every generated module is valid against the official XSD of each issue (native xmllint);
//  2. every element in it obeys the editor's compiled content model (strict);
//  3. the tag rules actually reject illegal placements (the editor enforces them while typing).
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { schemaDir } from './schemaDir';
import { spawnSync } from 'node:child_process';
import { TEMPLATES, buildDataModule, defaultNewDmOptions } from '../core/templates';
import { grammarFromJson, type GrammarJson } from '../core/grammar';

const PUB = path.resolve(__dirname, '../../../public');
const ISSUES = ['4-2', '5-0', '6', '7'].filter((i) => fs.existsSync(schemaDir(i)));
const gram = (issue: string, schema: string) =>
  grammarFromJson(JSON.parse(fs.readFileSync(path.join(PUB, 'grammar', issue, schema + '.json'), 'utf8')) as GrammarJson);

function xsdErrors(xml: string, issue: string, schema: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dmt-'));
  const f = path.join(dir, 'dm.xml');
  fs.writeFileSync(f, xml);
  const r = spawnSync('xmllint', ['--noout', '--schema', path.join(schemaDir(issue), schema + '.xsd'), f], { encoding: 'utf8' });
  return r.status === 0 ? '' : r.stderr.trim();
}

function walk(el: Element, out: Element[] = []): Element[] { out.push(el); for (const c of Array.from(el.children)) walk(c, out); return out; }

// the seven the product started with (they also have rich-content tests below)
const ORIGINAL = ['descript', 'proced', 'fault', 'crew', 'ipd', 'brex', 'comrep'];
// the s1kd-newdm reference minus techrep (no techrep.xsd is bundled, so its tag rules cannot be enforced)
const ADDED = ['appliccrossreftable', 'brdoc', 'checklist', 'condcrossreftable', 'container', 'frontmatter', 'learning', 'prdcrossreftable', 'process', 'sb', 'schedul', 'scocontent', 'wrngdata', 'wrngflds'];

describe('the data module types the wizard offers', () => {
  it('are the original seven plus the fourteen from the s1kd-newdm reference', () => {
    expect(TEMPLATES.map((t) => t.schema).sort()).toEqual([...ORIGINAL, ...ADDED].sort());
  });
  it('every type has an official XSD and a compiled grammar for every issue the wizard offers', () => {
    for (const t of TEMPLATES) for (const i of ISSUES) {
      expect(fs.existsSync(path.join(schemaDir(i), t.schema + '.xsd')), `${t.schema} xsd ${i}`).toBe(true);
      expect(fs.existsSync(path.join(PUB, 'grammar', i, t.schema + '.json')), `${t.schema} grammar ${i}`).toBe(true);
    }
  });
  it('the default info code is well formed', () => {
    for (const t of TEMPLATES) expect(t.infoCode, t.schema).toMatch(/^[0-9][0-9A-Z]{2}$/);
  });

  for (const t of TEMPLATES) {
    for (const issue of ISSUES) {
      it(`${t.label} (${t.schema}) issue ${issue}: valid against the XSD and the grammar`, () => {
        const xml = buildDataModule(defaultNewDmOptions(t.schema, issue));
        expect(xsdErrors(xml, issue, t.schema)).toBe('');
        const g = gram(issue, t.schema);
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        const bad: string[] = [];
        for (const el of walk(doc.documentElement)) {
          if (!g.has(el.nodeName)) { bad.push(`unknown element <${el.nodeName}>`); continue; }
          const kids = Array.from(el.children).map((c) => c.nodeName);
          if (!g.isValidContent(el.nodeName, kids)) bad.push(`<${el.nodeName}> children [${kids.join(', ')}]`);
        }
        expect(bad).toEqual([]);
      });
    }
  }
});

describe('tag rules are enforced', () => {
  const g = gram('5-0', 'descript');
  it('only the allowed children go under a tag', () => {
    expect(g.isValidContent('levelledPara', ['title', 'para'])).toBe(true);
    expect(g.isValidContent('levelledPara', ['para', 'title'])).toBe(false);       // order
    expect(g.isValidContent('figure', ['graphic'])).toBe(false);                  // title required first
    expect(g.canInsert('levelledPara', ['title'], 1, 'proceduralStep')).toBe(false); // wrong module type
    expect(g.canInsert('levelledPara', ['title'], 1, 'para')).toBe(true);
  });
  it('type-specific rules differ between module types', () => {
    const p = gram('5-0', 'proced');
    expect(p.canInsert('mainProcedure', [], 0, 'proceduralStep')).toBe(true);
    expect(g.has('proceduralStep')).toBe(false);
    expect(gram('5-0', 'fault').has('faultIsolation')).toBe(true);
  });
});

describe('the editor grammar agrees with the official XSD (xmllint is the judge)', () => {
  const base = buildDataModule(defaultNewDmOptions('descript', '5-0'));
  const g = gram('5-0', 'descript');
  const variants: Array<[string, string, string, string[]]> = [
    ['title then para', '<levelledPara><title>t</title><para>x</para></levelledPara>', 'levelledPara', ['title', 'para']],
    ['para before title', '<levelledPara><para>x</para><title>t</title></levelledPara>', 'levelledPara', ['para', 'title']],
    ['no title', '<levelledPara><para>x</para></levelledPara>', 'levelledPara', ['para']],
    ['proceduralStep in descript', '<levelledPara><title>t</title><proceduralStep/></levelledPara>', 'levelledPara', ['title', 'proceduralStep']],
    ['figure without title', '<levelledPara><title>t</title><figure><graphic infoEntityIdent="ICN-X"/></figure></levelledPara>', 'figure', ['graphic']],
  ];
  for (const [name, body, parent, kids] of variants) {
    it(name, () => {
      const xml = base.replace(/<description>[\s\S]*<\/description>/, `<description>${body}</description>`);
      const xsdSays = xsdErrors(xml, '5-0', 'descript') === '';
      const grammarSays = kids.every((k) => g.has(k)) && g.isValidContent(parent, kids);
      expect(grammarSays).toBe(xsdSays);
    });
  }
});

// ---------------------------------------------------------------------------------------------
// Rich content: a realistic body for each type (nested steps, tables, lists, warnings, decision
// trees, parts, rules...). Must be valid against the XSD of the issue AND the editor grammar.
const RICH = path.resolve(__dirname, 'rich');
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01';
function richDm(schema: string, issue: string): string {
  const variant = path.join(RICH, `${schema}.${issue}.xml`);
  const body = fs.readFileSync(fs.existsSync(variant) ? variant : path.join(RICH, schema + '.xml'), 'utf8').trimEnd();
  const base = buildDataModule(defaultNewDmOptions(schema, issue));
  const withBody = base.replace(/<content>[\s\S]*<\/content>/, `<content>\n${body}\n  </content>`);
  const needsEnt = body.includes(ICN);
  return needsEnt
    ? withBody.replace('<dmodule ', `<!DOCTYPE dmodule [\n  <!NOTATION svg SYSTEM "svg">\n  <!ENTITY ${ICN} SYSTEM "${ICN}.svg" NDATA svg>\n]>\n<dmodule `)
    : withBody;
}

describe('rich content per type and issue', () => {
  for (const t of TEMPLATES) {
    for (const issue of ISSUES) {
      it(`${t.label} (${t.schema}) ${issue}: XSD-valid and grammar-valid realistic content`, () => {
        const xml = richDm(t.schema, issue);
        expect(xsdErrors(xml, issue, t.schema)).toBe('');
        const g = gram(issue, t.schema);
        const doc = new DOMParser().parseFromString(xml, 'application/xml');
        expect(doc.getElementsByTagName('parsererror').length).toBe(0);
        const bad: string[] = [];
        for (const el of walk(doc.documentElement)) {
          if (!g.has(el.nodeName)) { bad.push(`unknown <${el.nodeName}>`); continue; }
          const kids = Array.from(el.children).map((c) => c.nodeName);
          if (!g.isValidContent(el.nodeName, kids)) bad.push(`<${el.nodeName}> [${kids.join(', ')}]`);
        }
        expect(bad).toEqual([]);
      });
    }
  }
});

// `WRITE_FIXTURES=1 npx vitest run src/studio/__tests__/dmtypes.test.ts` refreshes the static copies the
// backend end-to-end tests publish (backend/test/fixtures/rich/).
describe.skipIf(!process.env.WRITE_FIXTURES)('write rich fixtures for the backend tests', () => {
  it('writes one data module per type', () => {
    const out = path.resolve(__dirname, '../../../../backend/test/fixtures/rich');
    fs.mkdirSync(out, { recursive: true });
    for (const t of TEMPLATES.filter((x) => ORIGINAL.includes(x.schema))) {
      const o = defaultNewDmOptions(t.schema, '5-0');
      const c = o.code;
      const name = `DMC-${c.modelIdentCode}-${c.systemDiffCode}-${c.systemCode}-${c.subSystemCode}${c.subSubSystemCode}-${c.assyCode}-${c.disassyCode}${c.disassyCodeVariant}-${c.infoCode}${c.infoCodeVariant}-${c.itemLocationCode}_001-00_EN-US.XML`;
      fs.writeFileSync(path.join(out, name), richDm(t.schema, '5-0'));
    }
    fs.copyFileSync(path.resolve(__dirname, '../../../public/samples/ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg'), path.join(out, 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg'));
  });
});
