'use strict';
// Xignal JSS front-matter data modules, both directions, as pure functions (HTTP is in jssdm-http.test.js).
// Real data: the JSS-0251 sample (skipped when absent) and a small set of fixtures that exercise the edge cases the sample does not
// (an older issue of a page, an unnamed custom code, a 012 with an unknown disassembly code, a chapter 009 in a real system).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DOMParser } = require('@xmldom/xmldom');

const { frontMatterFromDms } = require('../dist/services/jssdm/fromDms');
const { dmsFromFrontMatter, pagesToGenerate } = require('../dist/services/jssdm/toDms');
const { PAGE_DEFS, classifyFrontMatter, couldBeFrontMatterCode } = require('../dist/services/jssdm/reserved');
const { isGeneratedXml, generatedMarker, readSidecar, writeSidecar } = require('../dist/services/jssdm/sidecar');
const { buildPmXml, defaultPmMeta } = require('../dist/services/sns/pmxml');
const { validateProjectSchema } = require('../vendor/engine/validateSchema');
const pmc = require('../vendor/engine/pmc');

const FIX = path.join(__dirname, 'fixtures', 'jssdm');
const SAMPLE = path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'JSS-0251', 'PMC-RDR-1671Y-00061-00_000-01.xml');
const HAVE_SAMPLE = fs.existsSync(SAMPLE);
const NO_SAMPLE = !HAVE_SAMPLE && 'SAMPLE PROJECTS/JSS-0251 is not present';

const readDir = (dir) => {
  const files = fs.readdirSync(dir);
  const dms = files.filter((f) => /^DMC-.*\.xml$/i.test(f)).map((f) => ({ file: f, xml: fs.readFileSync(path.join(dir, f), 'utf8') }));
  const pmFile = files.find((f) => /^PMC-.*\.xml$/i.test(f));
  return { dms, pm: pmFile ? fs.readFileSync(path.join(dir, pmFile), 'utf8') : null, files };
};
const importDir = (dir) => { const d = readDir(dir); return frontMatterFromDms(d.dms, d.pm, { csdbDir: 'csdb', files: [] }); };
const pick = (r) => ({ frontMatter: r.frontMatter, publication: r.publication, branding: r.branding, pages: r.consumed.map((c) => c.page).sort() });
const generate = (r, over = {}) => dmsFromFrontMatter(over.frontMatter ?? r.frontMatter, over.publication ?? r.publication, r.ids, { branding: r.branding, csdbDir: 'csdb' });
const reimport = (gen) => {
  const pmXml = buildPmXml(gen.pmEntries, defaultPmMeta(gen.pmMeta.pmTitle, { ...gen.pmMeta }));
  return frontMatterFromDms(gen.dms.map((d) => ({ file: d.file, xml: d.xml })), pmXml, { csdbDir: 'csdb', files: [] });
};
const withTemp = async (fn) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jssdm-test-'));
  try { return await fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};
const validateGenerated = (gen) => withTemp(async (dir) => {
  for (const d of gen.dms) fs.writeFileSync(path.join(dir, d.file), d.xml);
  const pmXml = buildPmXml(gen.pmEntries, defaultPmMeta(gen.pmMeta.pmTitle, { ...gen.pmMeta }));
  fs.writeFileSync(path.join(dir, 'PM.xml'), pmXml);
  const rel = [...gen.dms.map((d) => d.file), 'PM.xml'];
  const v = await validateProjectSchema(dir, rel);
  return { v, rel };
});
const doc = (xml) => new DOMParser({ onError() {} }).parseFromString(xml, 'text/xml');
// A saved page list is the author's statement; the engine enables any page it does not mention, so tests name every page.
const only = (...ids) => PAGE_DEFS.filter((d) => d.page !== 'listOfAnnexures').map((d) => ({ id: d.page, enabled: ids.includes(d.page) })).concat([{ id: 'titlePageJoint', enabled: true }]);
const kids = (el, name) => Array.from(el.childNodes).filter((n) => n.nodeType === 1 && n.nodeName === name);

// ── the page table ────────────────────────────────────────────────────────────────────────────────────────────────

test('the page table: seventeen pages, reserved codes, no two pages on the same code and disassembly code', () => {
  assert.equal(PAGE_DEFS.length, 17);
  const seen = new Set();
  for (const d of PAGE_DEFS) {
    const k = `${d.infoCode}/${d.disassy}`;
    assert.ok(!seen.has(k), `${k} is used twice`);
    seen.add(k);
    assert.match(d.infoCode, /^[A-Z0-9]{3}$/);
  }
  assert.deepEqual(PAGE_DEFS.filter((d) => d.infoCode === '012').map((d) => [d.page, d.disassy]), [['safetyWarning', '01'], ['firstAid', '02'], ['cautionsNotes', '03']]);
});

test('classification: front matter sits at SNS 00-0-0-00; the same code in a real system is body; a custom X code is reported, not guessed', () => {
  const at = (over) => classifyFrontMatter({ infoCode: '001', disassyCode: '00', systemCode: '00', subSystemCode: '0', subSubSystemCode: '0', assyCode: '00', ...over });
  assert.deepEqual(at({}), { kind: 'page', page: 'titlePage', via: 'code' });
  assert.equal(at({ infoCode: '009', systemCode: '05' }).kind, 'body', '009 in system 05 is a chapter heading');
  assert.equal(at({ infoCode: '009' }).page, 'listOfContents');
  assert.equal(at({ infoCode: '040' }).kind, 'body', 'an ordinary code is not front matter');
  assert.equal(at({ infoCode: '012', disassyCode: '02' }).page, 'firstAid');
  assert.deepEqual([at({ infoCode: '012', disassyCode: '00', infoName: 'First aid in case of shock' }).page, at({ infoCode: '012', disassyCode: '00', infoName: 'First aid in case of shock' }).via], ['firstAid', 'name']);
  assert.equal(at({ infoCode: '012', disassyCode: '09', infoName: 'Something else' }).kind, 'unknown');
  assert.equal(at({ infoCode: 'X01', infoName: 'Demolition of material' }).page, 'demolition');
  assert.equal(at({ infoCode: 'X01', infoName: 'Whatever' }).via, 'convention', 'a customer code with no telling name falls back to the sample numbering');
  assert.equal(at({ infoCode: 'X07', infoName: 'Equipment index' }).kind, 'unknown');
  assert.equal(at({ infoCode: 'X03', infoName: 'List of annexures' }).page, 'listOfAnnexures');
  assert.equal(at({ infoCode: '001', subSystemCode: '1' }).kind, 'body', 'any non-zero SNS level makes it a body module');
});

test('which information codes are worth looking at in the front-matter position', () => {
  for (const c of ['001', '012', '00T', 'X01', 'X07', 'x9z']) assert.equal(couldBeFrontMatterCode(c), true, c);
  for (const c of ['040', '520', '022', 'A01', '', 'XX']) assert.equal(couldBeFrontMatterCode(c), false, c);
});

// ── reading the sample ────────────────────────────────────────────────────────────────────────────────────────────

test('real data: JSS-0251 front matter reads into engine settings, every page accounted for', { skip: NO_SAMPLE }, () => {
  const r = importDir(SAMPLE);
  assert.equal(r.consumed.length, 17, 'all seventeen pages');
  assert.deepEqual(r.consumed.map((c) => c.page).sort(), PAGE_DEFS.map((d) => d.page).sort());
  assert.deepEqual(r.notConsumed, []);
  assert.equal(r.summary.notUnderstood, 0, JSON.stringify(r.report.filter((e) => e.status === 'not-understood')));
  assert.ok(r.summary.mapped >= 30, 'the bulk of the fields are mapped');
  assert.equal(r.summary.mapped + r.summary.defaulted + r.summary.ignored + r.summary.notUnderstood, r.report.length, 'every field is in exactly one bucket');

  assert.deepEqual(r.publication, {
    publicationNo: 'DT0260_U0560_Fin_Stab_R0', inbrNo: 'DT0260_U0560_Fin_Stab_R0', bookName: 'UHB_FCR_JSS',
    systemName: 'Close-In Weapon System (CIWS)', securityClassification: '06', year: '2026', month: '09',
  });
  const fm = r.frontMatter;
  assert.equal(fm.style, 'jss');
  assert.equal(fm.recordOfChanges.rows, 19, 'the sample really has 19 blank rows');
  assert.equal(fm.associatedHandbooks.length, 32);
  assert.deepEqual(fm.associatedHandbooks[0], { sr: '', title: 'BrahMos System Level Document', inbr: '', group: true });
  assert.equal(fm.safetyWarning.length, 4);
  assert.equal(fm.cautionsNotes.length, 7);
  assert.equal(fm.demolition.parts.length, 2);
  assert.equal(fm.descriptionOfSymbols.length, 6);
  assert.ok(fm.descriptionOfSymbols.every((s) => s.icon && s.text), 'each symbol has its picture and its meaning');
  assert.ok(fm.pages.every((p) => p.id && typeof p.enabled === 'boolean'));
  assert.equal(r.branding.publishers.length, 1);
  assert.equal(r.branding.publishers[0].name, 'L&T Precision Engineering and Systems');
  assert.match(r.branding.emblem, /^csdb\/ICN-/);
  assert.equal(r.ids.modelIdentCode, 'JSS0251');
});

test('real data: security class "06" is kept exactly as written, not mapped to a name', { skip: NO_SAMPLE }, () => {
  const r = importDir(SAMPLE);
  assert.equal(r.publication.securityClassification, '06');
});

// ── the fixtures: what the sample does not exercise ───────────────────────────────────────────────────────────────

test('fixtures: only the newest issue of a page counts; the older one is reported, not merged', () => {
  const r = importDir(FIX);
  const title = r.consumed.filter((c) => c.page === 'titlePage');
  assert.equal(title.length, 1);
  assert.match(title[0].file, /_002-00_/);
  const old = r.notConsumed.find((n) => /001A-A_001-00/.test(n.file));
  assert.ok(old, 'the old issue is listed');
  assert.match(old.reason, /newest issue/);
  assert.equal(r.publication.publicationNo, 'FIX-2026-007', 'the current issue wins; OLD-1 is nowhere');
  assert.ok(!JSON.stringify(r.frontMatter).includes('OLD'));
});

test('fixtures: title page fields, the two parties, the second red notice, NSN and contract', () => {
  const r = importDir(FIX);
  assert.equal(r.frontMatter.titlePage.documentType, 'Operator Manual');
  assert.equal(r.frontMatter.titlePage.disclosureNotice, 'RESTRICTED - NOT FOR RELEASE');
  assert.equal(r.frontMatter.titlePage.repairNotice, 'REPAIRS ONLY BY AUTHORISED AGENCIES.');
  assert.equal(r.frontMatter.revNo, 'B');
  assert.equal(r.frontMatter.codeNo, 'C-12');
  assert.equal(r.publication.nsn, '1234-56-789-0123');
  assert.equal(r.publication.contractNo, 'FIX/2026/42');
  assert.equal(r.publication.inbrNo, 'FIX-2026-007');
  assert.deepEqual(r.branding.publishers, [
    { name: 'Alpha Systems Ltd', addressLines: ['1 Alpha Road', 'Alphaville'] },
    { name: 'Beta Works', addressLines: ['2 Beta Street'] },
  ]);
  assert.equal(r.frontMatter.xignal.titlePage.secondRedText, 'SECOND NOTICE', 'a field the engine has no key for is kept under xignal');
  assert.equal(r.frontMatter.labels.titleJoint.contractNo, 'Contract No: ', 'the label as written is kept, so it prints as written');
});

test('fixtures: the publication header supplies book name, system name, date and classification', () => {
  const r = importDir(FIX);
  assert.equal(r.publication.bookName, 'Fixture Operator Manual');
  assert.equal(r.publication.systemName, 'Fixture Radar and Display');
  assert.equal(r.publication.year, '2027');
  assert.equal(r.publication.month, '03');
  assert.equal(r.publication.securityClassification, 'RESTRICTED');
  const conflict = r.report.find((e) => e.status === 'not-understood' && /system name/.test(e.field));
  assert.ok(conflict, 'a system name that differs between the title page and the PM is flagged');
  assert.match(conflict.detail, /Fixture Radar & Display/);
});

test('fixtures: the foreword keeps the contact rows the engine has and reports the one it has not', () => {
  const r = importDir(FIX);
  assert.equal(r.frontMatter.foreword.email, 'docs@fixture.example');
  assert.deepEqual(r.frontMatter.foreword.telephone, ['+44 1234 567890']);
  const web = r.report.find((e) => e.page === 'foreword' && /Web site/.test(e.field));
  assert.ok(web && web.status === 'not-understood', 'the Web site row is reported as not kept');
});

test('fixtures: first aid is recognised by its title when its disassembly code is not 02', () => {
  const r = importDir(FIX);
  const fa = r.consumed.find((c) => c.page === 'firstAid');
  assert.equal(fa.via, 'name');
  assert.deepEqual(r.frontMatter.firstAid.steps, [{ paras: ['Switch off the supply.'] }, { paras: ['(a) Call for help.', '(b) Begin first aid.'] }]);
});

test('fixtures: an unnamed custom code and an unknown 012 are reported and left alone; a chapter 009 in a real system is not touched', () => {
  const r = importDir(FIX);
  const x07 = r.notConsumed.find((n) => n.infoCode === 'X07');
  assert.ok(x07);
  assert.match(x07.reason, /custom code/);
  const odd = r.notConsumed.find((n) => n.infoCode === '012' && /-09A-/.test(n.file));
  assert.ok(odd);
  assert.match(odd.reason, /disassembly code 09/);
  const all = [...r.consumed, ...r.notConsumed].map((x) => x.file);
  assert.ok(!all.some((f) => /-05-00-00-00A-009A-/.test(f)), 'the chapter 5 heading page is neither consumed nor reported');
  assert.ok(r.report.some((e) => e.status === 'not-understood' && e.file === x07.file), 'the report says so too');
});

test('fixtures: the order the publication lists the pages in becomes the page order, and the engine required pages stay', () => {
  const r = importDir(FIX);
  const ids = r.frontMatter.pages.map((p) => p.id);
  assert.ok(ids.indexOf('foreword') < ids.indexOf('titlePage'), 'the PM lists the foreword first');
  assert.ok(ids.indexOf('titlePage') < ids.indexOf('proprietary'));
  assert.ok(ids.includes('titlePageJoint') && r.frontMatter.pages.find((p) => p.id === 'titlePageJoint').enabled, 'the engine needs both title pages');
  assert.equal(r.frontMatter.pages.find((p) => p.id === 'listOfContents').enabled, false, 'a page with no module is off, not invented');
});

test('no front matter at all: nothing consumed, no settings invented', () => {
  const r = frontMatterFromDms([], null, { csdbDir: 'csdb', files: [] });
  assert.deepEqual(r.consumed, []);
  assert.deepEqual(r.notConsumed, []);
  assert.equal(r.summary.pages, 0);
  assert.deepEqual(r.publication, {});
});

// ── writing: engine settings to modules ───────────────────────────────────────────────────────────────────────────

test('generation: reserved codes, positional paragraphs, flagged as generated, newest-issue naming', () => {
  const gen = dmsFromFrontMatter({
    titlePage: { documentType: 'Operator Manual', disclosureNotice: 'RESTRICTED', repairNotice: 'REPAIRS ONLY BY AUTHORISED AGENCIES.' },
    foreword: { text: 'Please report errors.', email: 'a@b.example', telephone: ['123'], postalAddress: [], fax: [] },
    pages: only('titlePage', 'foreword', 'listOfContents'),
  }, { publicationNo: 'X-1', inbrNo: 'X-1', bookName: 'Book', systemName: 'System', year: '2026', month: '05' }, { modelIdentCode: 'GENT', issueDate: { year: '2026', month: '11', day: '20' } });

  assert.deepEqual(gen.dms.map((d) => d.page), ['titlePage', 'foreword', 'listOfContents']);
  assert.deepEqual(gen.dms.map((d) => d.infoCode), ['001', '023', '009']);
  const title = gen.dms[0];
  assert.equal(title.file, 'DMC-GENT-A-00-00-00-00A-001A-A_001-00_EN-US.xml');
  assert.equal(title.dmc, 'DMC-GENT-A-00-00-00-00A-001A-A');
  for (const d of gen.dms) {
    assert.ok(isGeneratedXml(d.xml), `${d.file} carries the generated marker`);
    assert.ok(d.xml.includes(generatedMarker(d.page)));
    assert.match(d.xml, /systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00"/, 'the zero SNS code');
  }
  const levels = kids(doc(title.xml).getElementsByTagName('description')[0], 'levelledPara');
  assert.equal(levels.length, 10, 'the title page is ten positional paragraphs');
  assert.equal(gen.pmEntries.length, 1);
  assert.equal(gen.pmEntries[0].title, 'Front matter');
  assert.equal(gen.pmEntries[0].children.length, 3, 'one reference per module, in running order');
  assert.equal(gen.pmMeta.pmTitle, 'Book');
});

test('generation: a graphic outside the CSDB folder is left out and reported, never written as a path that leaves it', () => {
  const gen = dmsFromFrontMatter({ pages: only('titlePage'), titlePage: {} }, {}, {}, { branding: { emblem: 'Media/Satya.png', publishers: [{ name: 'P', addressLines: [], logo: 'csdb/ICN-X-A-000000-A-12345-00001-A-001-01.png' }] }, csdbDir: 'csdb' });
  const xml = gen.dms[0].xml;
  assert.ok(!xml.includes('..'), 'no entity path leaves the CSDB');
  assert.ok(!xml.includes('Satya'));
  assert.ok(xml.includes('ICN-X-A-000000-A-12345-00001-A-001-01'), 'a graphic inside it is kept');
  const e = gen.report.find((r) => r.status === 'ignored' && /Satya/.test(r.field));
  assert.ok(e, JSON.stringify(gen.report));
  assert.match(e.detail, /CSDB folder/);
});

test('generation is deterministic: the same settings give the same bytes', () => {
  const fm = { titlePage: { documentType: 'Manual' }, pages: [{ id: 'titlePageJoint', enabled: true }, { id: 'titlePage', enabled: true }, { id: 'proprietary', enabled: true }] };
  const run = () => JSON.stringify(dmsFromFrontMatter(fm, { bookName: 'B' }, { issueDate: { year: '2026', month: '01', day: '02' } }));
  assert.equal(run(), run());
});

test('generation: a page that is switched off is not written; with no saved page list only pages that have content are', () => {
  assert.deepEqual(pagesToGenerate({ pages: only('titlePage') }), ['titlePage']);
  assert.ok(pagesToGenerate({ pages: [{ id: 'titlePageJoint', enabled: true }, { id: 'titlePage', enabled: true }] }).includes('foreword'), 'a page left out of a saved list is one the engine prints, so it is written');
  const none = dmsFromFrontMatter({}, {}, {});
  assert.deepEqual(none.dms.map((d) => d.page), ['titlePage', 'listOfContents', 'listOfFigures', 'listOfTables', 'systemNamePage'], 'empty settings: only the pages that need no content of their own (the engine builds them)');
  assert.ok(none.skipped.length >= 8, 'and it says what it left out');
  assert.ok(none.skipped.every((s) => /not set/.test(s.reason)));
  const some = dmsFromFrontMatter({ proprietary: { text: 'Secret.' } }, {}, {});
  assert.ok(some.dms.some((d) => d.page === 'proprietary'), 'a page with content is written');
  assert.ok(!some.dms.some((d) => d.page === 'foreword'), 'one without is not');
});

test('generation: text is escaped, never written as markup', () => {
  const gen = dmsFromFrontMatter({ proprietary: { text: 'A < B & "C" </para><x/>' }, pages: only('proprietary') }, {}, {});
  const xml = gen.dms.find((d) => d.page === 'proprietary').xml;
  assert.ok(!xml.includes('<x/>'));
  assert.ok(xml.includes('A &lt; B &amp; "C" &lt;/para&gt;&lt;x/&gt;'));
  assert.ok(doc(xml).documentElement.textContent.includes('A < B & "C" </para><x/>'), 'it reads back as the text that was typed');
});

test('sidecar: the record of generated and consumed files round-trips and an absent file reads as empty', async () => {
  await withTemp((dir) => {
    const empty = readSidecar(dir);
    assert.deepEqual(empty.generated ?? {}, {});
    const sc = { ...empty, generated: { 'a.xml': { page: 'titlePage', infoCode: '001', sha256: 'abc', at: '2026-11-20T00:00:00.000Z' } } };
    writeSidecar(dir, sc);
    assert.deepEqual(readSidecar(dir).generated, sc.generated);
  });
});

// ── the round trip ────────────────────────────────────────────────────────────────────────────────────────────────

test('round trip: JSS-0251 modules to settings to modules to settings is stable, and the generated modules validate against S1000D 4.2', { skip: NO_SAMPLE }, async () => {
  const a1 = importDir(SAMPLE);
  const gen = generate(a1);
  assert.equal(gen.dms.length, 17, 'every page is written back');
  assert.deepEqual(gen.skipped, []);
  const a2 = reimport(gen);
  assert.deepEqual(pick(a2), pick(a1));
  assert.equal(a2.summary.notUnderstood, 0);

  const gen2 = generate(a2);
  assert.deepEqual(gen2.dms.map((d) => [d.file, d.xml]), gen.dms.map((d) => [d.file, d.xml]), 'writing the re-read settings gives the very same files');

  const { v, rel } = await validateGenerated(gen);
  assert.equal(v.checked, rel.length, 'every generated file was checked against its schema, offline');
  assert.deepEqual(v.issues, [], JSON.stringify(v.issues.slice(0, 3)));
});

test('round trip: an edit to the settings survives the trip through the modules', { skip: NO_SAMPLE }, () => {
  const a1 = importDir(SAMPLE);
  const fm = JSON.parse(JSON.stringify(a1.frontMatter));
  const pub = { ...a1.publication, bookName: 'A NEW BOOK NAME', systemName: 'Another System' };
  fm.foreword.email = 'changed@example.org';
  fm.safetyWarning[0].text = 'CHANGED SAFETY WARNING';
  fm.cautionsNotes[0] = typeof fm.cautionsNotes[0] === 'string' ? 'CHANGED CAUTION' : { ...fm.cautionsNotes[0], text: 'CHANGED CAUTION' };
  const a2 = reimport(generate(a1, { frontMatter: fm, publication: pub }));
  assert.equal(a2.publication.bookName, 'A NEW BOOK NAME');
  assert.equal(a2.publication.systemName, 'Another System');
  assert.equal(a2.frontMatter.foreword.email, 'changed@example.org');
  assert.equal(a2.frontMatter.safetyWarning[0].text, 'CHANGED SAFETY WARNING');
  assert.deepEqual(a2.frontMatter.cautionsNotes[0], fm.cautionsNotes[0]);
  assert.deepEqual(a2.frontMatter.safetyWarning.slice(1), a1.frontMatter.safetyWarning.slice(1), 'what was not edited did not move');
});

test('round trip: the fixtures (joint parties, labels as written, NSN, contract) are stable too, and valid', async () => {
  const a1 = importDir(FIX);
  const gen = generate(a1);
  const a2 = reimport(gen);
  const x = pick(a1);
  const y = pick(a2);
  assert.deepEqual(y.frontMatter, x.frontMatter);
  assert.deepEqual(y.publication, x.publication);
  assert.deepEqual(y.branding, x.branding);
  assert.deepEqual(y.pages, x.pages);
  const { v, rel } = await validateGenerated(gen);
  assert.equal(v.checked, rel.length);
  assert.deepEqual(v.issues, [], JSON.stringify(v.issues.slice(0, 3)));
});

test('a demolition list type other than roman is reported as not carried', () => {
  const gen = dmsFromFrontMatter({ demolition: { parts: [{ title: 'P', paras: [], items: ['x'], listType: 'bullet' }] }, pages: only('demolition') }, {}, {});
  const e = gen.report.find((r) => r.page === 'demolition' && /list type/.test(r.field));
  assert.ok(e && e.status === 'ignored', JSON.stringify(gen.report));
});

test('every page the settings can describe is generated valid on its own (offline schema check)', async () => {
  const fm = {
    titlePage: { documentType: 'Manual' },
    proprietary: { text: 'Proprietary.' },
    foreword: { text: 'Foreword.', email: 'a@b.example', telephone: ['1'], postalAddress: ['Road'], fax: ['2'] },
    recordOfChanges: { rows: 4 },
    associatedHandbooks: [{ sr: '1', title: 'Handbook one', inbr: 'HB-1' }, { sr: '', title: 'Group', inbr: '', group: true }],
    safetyWarning: [{ text: 'Do not touch.' }, { text: 'Isolate first.', strong: true }],
    firstAid: { figures: [], steps: [{ paras: ['Switch off.'] }, { paras: ['(a) Call.', '(b) Treat.'] }], closing: [] },
    cautionsNotes: ['A caution.', 'A note.'],
    demolition: { parts: [{ title: 'Part A', paras: ['Do this.'], items: ['one', 'two'], listType: 'roman' }] },
    changeNotice: { rows: 3 },
    listOfAbbreviations: [{ term: 'CIWS', meaning: 'Close-in weapon system' }],
    descriptionOfSymbols: [],
    pages: PAGE_DEFS.map((d) => ({ id: d.page, enabled: d.page !== 'listOfAnnexures' })).concat([{ id: 'titlePageJoint', enabled: true }]),
    style: 'jss',
  };
  const gen = dmsFromFrontMatter(fm, { bookName: 'Book', systemName: 'Sys', publicationNo: 'N-1', inbrNo: 'N-1', year: '2026', month: '01' }, { issueDate: { year: '2026', month: '11', day: '20' } });
  assert.ok(gen.dms.length >= 15, `got ${gen.dms.length}: ${JSON.stringify(gen.skipped)}`);
  const { v, rel } = await validateGenerated(gen);
  assert.equal(v.checked, rel.length);
  assert.deepEqual(v.issues, [], JSON.stringify(v.issues.slice(0, 3)));
  const back = reimport(gen);
  assert.equal(back.summary.notUnderstood, 0, JSON.stringify(back.report.filter((e) => e.status === 'not-understood')));
  assert.deepEqual(back.frontMatter.safetyWarning, fm.safetyWarning);
  assert.deepEqual(back.frontMatter.firstAid.steps, fm.firstAid.steps);
  assert.deepEqual(back.frontMatter.cautionsNotes, fm.cautionsNotes);
  assert.deepEqual(back.frontMatter.listOfAbbreviations, fm.listOfAbbreviations);
  assert.deepEqual(back.frontMatter.associatedHandbooks.map((h) => [h.sr, h.title, h.inbr]), fm.associatedHandbooks.map((h) => [h.sr, h.title, h.inbr]));
  assert.equal(back.frontMatter.recordOfChanges.rows, 4);
  assert.deepEqual(back.frontMatter.demolition.parts[0], fm.demolition.parts[0]);
});
