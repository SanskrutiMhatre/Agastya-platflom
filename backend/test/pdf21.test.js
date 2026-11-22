'use strict';
// PDF-content verification for ALL 21 data module types, in all four S1000D issues, through BOTH publication engines
// (direct S1000D -> FO, and S1000D -> JSS book -> FO). For each module the server renders the quick preview and the test checks that
// every word of the module's own content reached the PDF (text nodes; and, for the support / reference types whose data lives in
// attributes, attribute values too). Comparison ignores whitespace and hyphenation, because FOP wraps and hyphenates.
//
// Types (see docs/S1000D_REFERENCE_CONFIG.md, "PDF rendering"):
//   narrative   descript, proced, fault, crew, checklist, process, learning, ipd, sb
//   support     brex, comrep, container, frontmatter, brdoc, schedul, scocontent, wrngdata, wrngflds
//   reference   appliccrossreftable, condcrossreftable, prdcrossreftable
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { boot } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIXROOT = path.resolve(__dirname, '..', '..', 'frontend', 'e2e', 'fixtures', 'dm21');
const ISSUES = ['4-2', '5-0', '6', '7'];
const PIPES = ['s1000dtofo', 's1000dtojss'];
const DATA_IN_ATTRIBUTES = new Set(['brex', 'comrep', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable', 'brdoc', 'schedul', 'scocontent', 'wrngdata', 'wrngflds']);
const KIND = { descript: 'narrative', proced: 'narrative', fault: 'narrative', crew: 'narrative', checklist: 'narrative', process: 'narrative', learning: 'narrative', ipd: 'narrative', sb: 'narrative',
  brex: 'support', comrep: 'support', container: 'support', frontmatter: 'support', brdoc: 'support', schedul: 'support', scocontent: 'support', wrngdata: 'support', wrngflds: 'support',
  appliccrossreftable: 'reference', condcrossreftable: 'reference', prdcrossreftable: 'reference' };

const schemaOf = (xml) => (/xml_schema_flat\/(\w+)\.xsd/.exec(xml) || [])[1];
// A word is its letters: whitespace, hyphens, soft hyphens and zero-width spaces are not part of it (a word wrapped inside a narrow table cell is two pieces on two lines).
const flat = (s) => s.toLowerCase().replace(/[\s­​-]+/g, '');
function pdfText(buf) {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf21-')), 'x.pdf');
  fs.writeFileSync(f, buf);
  // -raw: the text in the order the PDF draws it. In page-layout order a narrow column's wrapped word is interleaved with its neighbours' text
  // ("area occupi" ... "R Caution" ... "ed."), so a word that IS printed looks missing.
  return spawnSync('pdftotext', ['-raw', f, '-'], { encoding: 'utf8', maxBuffer: 1 << 28 }).stdout;
}
function tokensOf(xml, schema) {
  const raw = xml.split('<content')[1] ?? '';
  const text = raw.replace(/<[^>]*>/g, ' ') + (DATA_IN_ATTRIBUTES.has(schema) ? ' ' + (raw.match(/="[^"]*"/g) ?? []).join(' ') : '');
  return [...new Set((text.toLowerCase().match(/[a-z][a-z0-9-]{3,}/g) ?? []).map((t) => t.replace(/-/g, '')))];
}

let h; let w;
const RESULTS = {};
test.before(async () => {
  h = await boot();
  const admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'pia', fullName: 'Pia Printer', role: 'author' });
  w = new h.Client('pia');
  await w.post('/api/auth/login', { username: 'pia', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'pia', password: PW });
});
test.after(async () => {
  const out = path.join(__dirname, '..', '..', 'frontend', 'verification-results');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'pdf-content.json'), JSON.stringify(RESULTS, null, 1));
  await h.close();
});

for (const pipeline of PIPES) {
  for (const issue of ISSUES) {
    test(`PDF content, ${pipeline}, Issue ${issue}: all 21 types print every word of their content`, { timeout: 600000 }, async () => {
      const dir = path.join(FIXROOT, issue);
      const files = fs.readdirSync(dir).filter((f) => /^DMC-.*\.xml$/i.test(f)).sort();
      assert.equal(files.length, 21, 'one fixture per type');
      const pid = (await w.post('/api/projects', { name: `pdf ${pipeline} ${issue}`, pipeline })).json.project.id;
      const icn = path.join(FIXROOT, 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg');
      const fd = new FormData();
      fd.append('file', new Blob([fs.readFileSync(icn)]), path.basename(icn)); fd.append('dir', 'csdb');
      assert.equal((await w.req('POST', `/api/projects/${pid}/media`, fd)).status, 200);
      const seen = new Set(); const gaps = [];
      for (const f of files) {
        const xml = fs.readFileSync(path.join(dir, f), 'utf8');
        const schema = schemaOf(xml); seen.add(schema);
        assert.equal((await w.post(`/api/projects/${pid}/dms`, { file: f, xml })).status, 201, f);
        const pdf = await w.req('POST', `/api/projects/${pid}/publish/preview/${f}`, {});
        assert.equal(pdf.status, 200, `${schema}: preview ${pdf.status} ${JSON.stringify(pdf.json ?? '').slice(0, 200)}`);
        const text = flat(pdfText(pdf.buf));
        const toks = tokensOf(xml, schema);
        const missing = toks.filter((t) => !text.includes(t));
        (RESULTS[`${schema}/${issue}/${pipeline}`] ??= {}).printed = `${toks.length - missing.length}/${toks.length}`;
        RESULTS[`${schema}/${issue}/${pipeline}`].kind = KIND[schema];
        if (missing.length) gaps.push(`${schema} (${KIND[schema]}): ${missing.slice(0, 10).join(', ')}`);
      }
      assert.equal(seen.size, 21, 'all 21 types were rendered');
      assert.deepEqual(gaps, [], 'words in the data module that are not in its PDF');
    });
  }
}
