// Inventory of the 21 wizard types: schema mapping, info-code defaults, and the independent cross-check of every
// element's allowed children / attribute names against the reference dictionaries (vim-s1000d).
//   - exactly the 21 types the wizard exposes (nothing added, TECHREP absent)
//   - XSD + compiled grammar exist for every wizard issue; the grammar is the type's own; the wizard writes the right schema URL
//   - default info code vs the reference map (s1kd-newdm dmtypes) and vs real data modules in the workspace -> a status per type
// Results are written to verification-results/inventory.json for the report.
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { schemaDir } from '../schemaDir';
import { TEMPLATES, buildDataModule, defaultNewDmOptions } from '../../core/templates';
import { SCHEMAS, detectSchema, schemaUrl, ISSUES as EDITOR_ISSUES } from '../../core/s1000d';
import { parseXml } from '../../core/xml';
import { ISSUES, TYPES, LABEL, PUB, DATA, gram, gramJson, vim, diff, RESULTS } from './lib';

const WIZARD_21 = ['descript', 'proced', 'fault', 'crew', 'ipd', 'brex', 'comrep', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable', 'brdoc', 'checklist', 'container', 'frontmatter', 'learning', 'process', 'sb', 'schedul', 'scocontent', 'wrngdata', 'wrngflds'];
const info = JSON.parse(fs.readFileSync(path.join(DATA, 'infocodes.json'), 'utf8')) as { dmtypes: Record<string, string>; evidence: Record<string, Record<string, number>> };
const report: Record<string, unknown> = { infoCodes: {}, schemaMap: {}, vim: {}, issues: {} };

describe('the 21 wizard types', () => {
  it('are exactly the 21 required ones, in no way extended (no TECHREP, nothing added or removed)', () => {
    expect([...TYPES].sort()).toEqual([...WIZARD_21].sort());
    expect(TYPES).not.toContain('techrep');
    expect(TEMPLATES.length).toBe(21);
  });
  it('every type has a display label in the editor (status bar / tabs)', () => {
    for (const t of TYPES) expect(SCHEMAS[t], `${t} has no label in core/s1000d.ts SCHEMAS`).toBeTruthy();
  });
  it('the wizard offers the issues 4.2, 5.0, 6 and 7 (4.1 is hidden by the wizard but the editor supports it)', () => {
    expect([...ISSUES]).toEqual(['4-2', '5-0', '6', '7']);
    expect(EDITOR_ISSUES).toContain('4-1');
  });
});

describe('schema mapping', () => {
  for (const type of TYPES) {
    for (const issue of ISSUES) {
      it(`${type} ${issue}: XSD, grammar, schema URL and detection agree`, () => {
        const xsd = path.join(schemaDir(issue), type + '.xsd');
        expect(fs.existsSync(xsd), `missing ${xsd}`).toBe(true);
        const j = gramJson(issue, type);
        expect(j.schema, 'grammar belongs to this type').toBe(type);
        expect(j.issue).toBe(issue);
        expect(j.root).toBe('dmodule');
        // what the wizard writes points at this issue's flat schema of this type, and the editor detects it back
        const xml = buildDataModule(defaultNewDmOptions(type, issue));
        // the body element the WIZARD generates (not merely the grammar's first choice) is declared by this type's XSD and allowed in `content`
        const body = parseXml(xml).doc.getElementsByTagName('content')[0].children[0].nodeName;
        expect(body, 'the wizard writes a body element').toBeTruthy();
        expect(fs.readFileSync(xsd, 'utf8')).toContain(`name="${body}"`);
        expect(gram(issue, type).childCandidates('content')).toContain(body);
        expect(xml).toContain(`xsi:noNamespaceSchemaLocation="${schemaUrl(issue, type)}"`);
        const ref = detectSchema(parseXml(xml).doc);
        expect(ref?.schema).toBe(type);
        expect(ref?.issue).toBe(issue);
        (report.schemaMap as Record<string, unknown>)[`${type}/${issue}`] = { body, elements: Object.keys(j.elements).length };
      });
    }
  }
});

// The expected status of each default info code. A type is only called "confirmed" when real data modules in the workspace
// use that code with that schema, or the reference map assigns it to that schema. Anything else is a GAP we report.
const EXPECTED: Record<string, { code: string; status: string }> = {
  descript: { code: '040', status: 'confirmed: project files + reference' },
  proced: { code: '520', status: 'confirmed: project files + reference' },
  fault: { code: '421', status: 'confirmed: project files + reference' },
  crew: { code: '131', status: 'spec: supported' },
  ipd: { code: '941', status: 'confirmed: project files + reference' },
  brex: { code: '022', status: 'confirmed: project files + reference' },
  comrep: { code: '00L', status: 'confirmed: project files + reference' },
  appliccrossreftable: { code: '00W', status: 'confirmed: project files + reference' },
  condcrossreftable: { code: '00Q', status: 'reference only (no project file)' },
  prdcrossreftable: { code: '00P', status: 'confirmed: project files + reference' },
  brdoc: { code: '024', status: 'reference only (no project file)' },
  checklist: { code: '135', status: 'reference only (no project file)' },
  container: { code: '914', status: 'reference only (no project file; project files use 520 with this schema)' },
  frontmatter: { code: '001', status: 'spec: confirmed' },
  learning: { code: '952', status: 'reference only (no project file)' },
  process: { code: '951', status: 'reference only (no project file)' },
  sb: { code: '930', status: 'reference only (no project file)' },
  schedul: { code: '000', status: 'spec: confirmed' },
  scocontent: { code: '000', status: 'spec: unresolved' },
  wrngdata: { code: '000', status: 'spec: multiple' },
  wrngflds: { code: '029', status: 'spec: corrected' },
};

/** The six defaults that had been unresolved are judged by the 4.2 specification (backend/reference/dmtype-spec-evidence.json), not by the reference map. */
const SPEC = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../../backend/reference/dmtype-spec-evidence.json'), 'utf8')).types as Record<string, { status: string; default: string | null }>;

function infoStatus(schema: string, code: string): string {
  if (SPEC[schema]) return `spec: ${SPEC[schema].status}`;
  const inProject = (info.evidence[schema]?.[code] ?? 0) > 0;
  const refSchema = info.dmtypes[code];
  const inRef = refSchema === schema;
  const refOther = !!refSchema && refSchema !== schema;
  if (inProject && inRef) return 'confirmed: project files + reference';
  if (inRef) return inProject ? 'confirmed' : schema === 'container' ? 'reference only (no project file; project files use 520 with this schema)' : 'reference only (no project file)';
  if (refOther) return Object.keys(info.evidence[schema] ?? {}).length
    ? `gap: project files use ${Object.keys(info.evidence[schema]).join('/')} but the reference maps ${code} to ${refSchema}`
    : `gap: no project file uses ${schema}; the reference maps ${code} to ${refSchema}`;
  return 'gap: placeholder; neither the reference nor any project file gives a code for this schema';
}

describe('info-code defaults vs the reference map and the real project data modules', () => {
  for (const t of TEMPLATES) {
    it(`${t.schema}: default ${t.infoCode} has the recorded status`, () => {
      const status = infoStatus(t.schema, t.infoCode);
      (report.infoCodes as Record<string, unknown>)[t.schema] = { code: t.infoCode, name: t.infoName, status, projectFiles: info.evidence[t.schema] ?? {}, referenceSchemaForCode: info.dmtypes[t.infoCode] ?? null };
      expect(t.infoCode, 'default info code changed: update the recorded status deliberately').toBe(EXPECTED[t.schema].code);
      expect(status).toBe(EXPECTED[t.schema].status);
    });
  }
});

describe('the reference dictionaries (vim-s1000d) agree with the compiled grammars', () => {
  for (const type of TYPES) {
    for (const issue of ISSUES) {
      it(`${type} ${issue}: every element has the same allowed children; no attribute the dictionary knows is missing`, () => {
        const g = gram(issue, type);
        const j = gramJson(issue, type);
        const d = vim(issue, type);
        expect(d, 'reference dictionary present').toBeTruthy();
        const names = Object.keys(j.elements).filter((n) => !n.includes(':'));
        const bad: string[] = [];
        let checked = 0;
        for (const n of names) {
          const v = d![n];
          if (!v) { bad.push(`<${n}> missing from the dictionary`); continue; }
          checked++;
          const mine = g.childCandidates(n).filter((c) => !c.includes(':'));
          const dd = diff(mine, v.c.filter((c) => !c.includes(':')));
          if (dd.onlyA.length || dd.onlyB.length) bad.push(`<${n}> children: grammar-only{${dd.onlyA}} dictionary-only{${dd.onlyB}}`);
          const ga = g.attributes(n).map((a) => a.name);
          const miss = Object.keys(v.a).filter((a) => !a.includes(':') && !ga.includes(a));
          if (miss.length) bad.push(`<${n}> attributes the dictionary lists but the grammar lacks: ${miss}`);
        }
        const extra = Object.keys(d!).filter((n) => !j.elements[n]);
        if (extra.length) bad.push(`dictionary-only elements: ${extra}`);
        (report.vim as Record<string, unknown>)[`${type}/${issue}`] = { elements: names.length, crossChecked: checked, differences: bad.length };
        expect(bad).toEqual([]);
      });
    }
  }
});

describe('issues beyond the wizard', () => {
  it('records, per type, which schemas exist for 4.1 (editor-supported, hidden in the wizard)', () => {
    const rows: Record<string, { xsd: boolean; grammar: boolean }> = {};
    for (const t of TYPES) rows[t] = { xsd: fs.existsSync(path.join(schemaDir('4-1'), t + '.xsd')), grammar: fs.existsSync(path.join(PUB, 'grammar', '4-1', t + '.json')) };
    (report.issues as Record<string, unknown>)['4-1'] = rows;
    // the only 4.1 gap is business-rules documents, which S1000D introduced in 4.2
    expect(Object.entries(rows).filter(([, v]) => !v.xsd || !v.grammar).map(([k]) => k)).toEqual(['brdoc']);
  });
});

afterAll(() => {
  const dir = RESULTS;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'inventory.json'), JSON.stringify({ labels: LABEL, ...report }, null, 1));
});
