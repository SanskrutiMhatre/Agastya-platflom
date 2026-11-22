'use strict';
// The package scanner: what a package is, which flavour made it, and what is wrong with it - with no side effects.
// Synthetic packages cover the rules; the three real sample sets (SAMPLE PROJECTS, RWI) are read directly and
// the tests that need them skip when a set is absent.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { dm, dmFile, pmc, makeZip, table } = require('./fixtures/importer/make');
const importer = require('../dist/services/importer');
const { readZip, scanPackage, placeholderPng, pngInfo, isPlaceholderPng } = importer;

const ROOT = path.resolve(__dirname, '..', '..');
const SAMPLE_XIGNAL = path.join(ROOT, 'SAMPLE PROJECTS', 'S1000D', 'PMC-RDR-1671Y-00039-00_001-01.xml (2)');
const SAMPLE_JSS = path.join(ROOT, 'SAMPLE PROJECTS', 'JSS-0251', 'PMC-RDR-1671Y-00061-00_000-01.xml');
const SAMPLE_VEKTRA = path.resolve(ROOT, '..', 'RWI');

function readTree(dir) {
  const out = [];
  const walk = (d, rel) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, r); else out.push({ name: r, bytes: fs.readFileSync(p) });
    }
  };
  walk(dir, '');
  return out;
}
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const PNG = placeholderPng('ICN-TST-A-000000-A-00001-00001-A-001-01');

/** A small, healthy package: 3 modules, a publication that places them, 1 graphic, a note file. */
function healthy() {
  const A = 'TST-A-10-00-00-00A-040A-D';
  const B = 'TST-A-10-00-00-00A-520A-A';
  const C = 'TST-A-20-00-00-00A-040A-D';
  const icn = 'ICN-TST-A-000000-A-00001-00001-A-001-01';
  return [
    { name: dmFile(A), bytes: Buffer.from(dm({ dmc: A, tech: 'Pump', info: 'Description', entities: [{ name: icn, target: `${icn}.png` }], body: `<figure><title>F</title><graphic infoEntityIdent="${icn}"/></figure>` })) },
    { name: dmFile(B), bytes: Buffer.from(dm({ dmc: B, tech: 'Pump', info: 'Removal' })) },
    { name: dmFile(C), bytes: Buffer.from(dm({ dmc: C, tech: 'Valve', info: 'Description' })) },
    { name: 'PMC-TST-00001-00001-00_001-00_EN-IN.xml', bytes: Buffer.from(pmc({ entries: [{ folder: 'Hydraulics', children: [A, B] }, C] })) },
    { name: `${icn}.png`, bytes: PNG },
    { name: 'notes.txt', bytes: Buffer.from('hello') },
    { name: '__MACOSX/._junk', bytes: Buffer.from('x') },
    { name: 'Thumbs.db', bytes: Buffer.from('x') },
  ];
}

test('classification: modules, publication, graphics, other, ignored junk', () => {
  const r = scanPackage(healthy());
  assert.equal(r.counts.dms, 3);
  assert.equal(r.counts.pmcs, 1);
  assert.equal(r.counts.icns, 1);
  assert.equal(r.counts.other, 1);
  assert.ok(r.counts.ignored >= 2, 'macOS and Windows junk is set aside, not imported');
  assert.equal(r.summary.errors, 0, JSON.stringify(r.findings));
  assert.equal(r.unassigned.length, 0, 'every module is placed by the publication');
  assert.equal(r.graphics.missing.length, 0);
  assert.equal(r.models.TST, 3);
  assert.equal(r.languages['en-IN'], 3);
});

test('the report is plain JSON and the scan has no side effects on the input', () => {
  const entries = healthy();
  const before = entries.map((e) => sha(e.bytes));
  const r = scanPackage(entries);
  assert.equal(JSON.stringify(JSON.parse(JSON.stringify(r))), JSON.stringify(r), 'survives a JSON round trip unchanged');
  assert.deepEqual(entries.map((e) => sha(e.bytes)), before, 'no byte of the input changed');
  assert.equal(r.version, 1);
  for (const k of ['flavour', 'counts', 'files', 'findings', 'summary', 'repairPlan', 'publications', 'subPublications', 'unassigned', 'graphics']) assert.ok(k in r, `report has ${k}`);
});

test('modules and files are classified by their content, not only by their name', () => {
  const A = 'TST-A-10-00-00-00A-040A-D';
  const r = scanPackage([
    { name: 'renamed-module.xml', bytes: Buffer.from(dm({ dmc: A })) },
    { name: 'my-book.xml', bytes: Buffer.from(pmc({ entries: [A] })) },
    { name: 'data.xml', bytes: Buffer.from('<?xml version="1.0"?><thing/>') },
  ]);
  assert.equal(r.counts.dms, 1);
  assert.equal(r.counts.pmcs, 1);
  assert.equal(r.counts.other, 1);
  assert.ok(r.findings.some((f) => f.id === 'dm-file-name'), 'a module not named DMC-<code>.xml is said so');
});

test('a BREX data module is counted as BREX, not as an ordinary module', () => {
  const brex = 'S1000D-F-04-10-0301-00A-022A-D';
  const xml = dm({ dmc: brex, tech: 'Business rules', info: 'BREX', brex: null }).replace('<description>', '<brex>').replace('</description>', '</brex>');
  const r = scanPackage([{ name: dmFile(brex), bytes: Buffer.from(xml) }, ...healthy().slice(0, 3)]);
  assert.equal(r.counts.brex, 1);
  assert.equal(r.counts.dms, 3);
});

test('findings: malformed XML, an entity bomb and a duplicate module are errors with the file named', () => {
  const A = 'TST-A-10-00-00-00A-040A-D';
  const ok = dm({ dmc: A });
  const bomb = dm({ dmc: 'TST-A-12-00-00-00A-040A-D', entities: Array.from({ length: 600 }, (_, i) => ({ name: `ICN-TST-${i}`, target: `ICN-TST-${i}.png` })) });
  const r = scanPackage([
    { name: dmFile(A), bytes: Buffer.from(ok) },
    { name: 'DMC-TST-A-10-00-00-00A-040A-D_001-00_EN-IN (copy).xml', bytes: Buffer.from(ok) },
    { name: dmFile('TST-A-11-00-00-00A-040A-D'), bytes: Buffer.from(ok.replace('</content>', '')) },
    { name: dmFile('TST-A-12-00-00-00A-040A-D'), bytes: Buffer.from(bomb) },
  ]);
  const ids = (id) => r.findings.filter((f) => f.id === id);
  assert.ok(ids('xml-malformed').length >= 1 && ids('xml-malformed')[0].severity === 'error');
  assert.ok(ids('dm-duplicate').length >= 1, 'the same code/issue/language twice');
  assert.ok(ids('xml-unsafe').length >= 1, 'more than 500 entity declarations');
  assert.ok(r.summary.errors >= 3);
});

test('a missing graphic is found, and the placeholder PNG it would get is a real, flagged PNG', () => {
  const A = 'TST-A-10-00-00-00A-040A-D';
  const icn = 'ICN-TST-A-000000-A-00009-00001-A-001-01';
  const r = scanPackage([{ name: dmFile(A), bytes: Buffer.from(dm({ dmc: A, entities: [{ name: icn, target: `${icn}.png` }], body: `<figure><title>F</title><graphic infoEntityIdent="${icn}"/></figure>` })) }]);
  assert.equal(r.graphics.missing.length, 1);
  assert.equal(r.graphics.missing[0].icn, icn);
  const plan = r.repairPlan.find((p) => p.rule === 'icn-placeholder');
  assert.equal(plan.items, 1);
  const png = placeholderPng(icn);
  const info = pngInfo(png);
  assert.equal(info.width > 0 && info.height > 0, true);
  assert.equal(isPlaceholderPng(png), true);
  assert.equal(isPlaceholderPng(Buffer.from('not a png')), false);
  // The zlib stream inside really decodes to width*height pixels (a hand-made PNG that FOP/Chrome would reject fails here).
  const idat = []; let o = 8;
  while (o < png.length) { const len = png.readUInt32BE(o); const type = png.toString('ascii', o + 4, o + 8); if (type === 'IDAT') idat.push(png.subarray(o + 8, o + 8 + len)); o += 12 + len; }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  assert.equal(raw.length, info.height * (1 + info.width * 3), 'filter byte + RGB per row');
});

test('a graphic entity that points outside the package (URL, absolute path, parent folder) is an error and is never "repaired" into a placeholder', () => {
  const A = 'TST-A-10-00-00-00A-040A-D';
  for (const target of ['file:///etc/passwd', 'http://example.org/a.png', 'C:\secret\a.png', '/etc/passwd', '../../outside/a.png']) {
    const xml = dm({ dmc: A, entities: [{ name: 'ICN-TST-X', target }] });
    const r = scanPackage([{ name: dmFile(A), bytes: Buffer.from(xml) }]);
    const f = r.findings.find((x) => x.id === 'entity-external-target');
    assert.ok(f && f.severity === 'error', target);
    assert.equal(r.graphics.missing.length, 0, 'no placeholder is made for a target that is not a file of the package');
  }
  const fine = dm({ dmc: A, entities: [{ name: 'ICN-TST-X', target: 'art/ICN-TST-X.png' }] });
  assert.ok(!scanPackage([{ name: dmFile(A), bytes: Buffer.from(fine) }]).findings.some((x) => x.id === 'entity-external-target'), 'a relative path inside the package is fine');
});

test('the repair plan counts what each rule would do on a defective package', () => {
  const A = 'TST-A-10-00-00-00A-040A-D';
  const r = scanPackage([{ name: dmFile(A), bytes: Buffer.from(dm({ dmc: A, brex: 'H', body: table(3, [8, 8]) })) }]);
  const n = (rule) => r.repairPlan.find((p) => p.rule === rule).items;
  assert.equal(n('table-cols'), 1);
  assert.equal(n('brex-remap'), 1);
  assert.equal(n('pmc-reconstruct'), 1, 'no publication in the package: one would be synthesised');
  assert.ok(r.findings.some((f) => f.id === 'table-cols-overflow' && f.severity === 'error'));
});

// ── zip input ─────────────────────────────────────────────────────────────

test('zip input gives the same report as the loose files, stored or deflated', () => {
  const loose = healthy();
  const base = scanPackage(loose);
  for (const deflate of [false, true]) {
    const z = makeZip(loose.map((e) => ({ name: e.name, bytes: e.bytes })), { deflate });
    const r = scanPackage([{ name: 'package.zip', bytes: z }]);
    assert.deepEqual(r.counts.dms, base.counts.dms);
    assert.deepEqual(r.counts.pmcs, base.counts.pmcs);
    assert.deepEqual(r.counts.icns, base.counts.icns);
    assert.deepEqual(r.summary, base.summary);
  }
});

test('zip safety: path traversal and absolute names are refused, a zip bomb is stopped, a damaged zip is an error', () => {
  const z = makeZip([{ name: '../../evil.xml', bytes: Buffer.from('x') }, { name: '/abs/evil.xml', bytes: Buffer.from('x') }, { name: 'ok.txt', bytes: Buffer.from('fine') }]);
  const got = readZip(z);
  assert.deepEqual(got.entries.map((e) => e.name), ['ok.txt']);
  assert.equal(got.skipped.length, 2);

  const bomb = makeZip([{ name: 'big.xml', bytes: Buffer.alloc(5 * 1024 * 1024, 0x61) }], { deflate: true });
  assert.ok(bomb.length < 20000, 'the bomb is tiny on the wire');
  const capped = readZip(bomb, { maxEntries: 10, maxEntryBytes: 1024 * 1024, maxTotalBytes: 2 * 1024 * 1024 });
  assert.equal(capped.entries.length, 0, 'an entry over the size cap is not unpacked');
  assert.match(capped.skipped[0].reason, /larger than/);
  // an archive that LIES about the size in its directory cannot inflate past what it claimed
  const liar = makeZip([{ name: 'big.xml', bytes: Buffer.alloc(5 * 1024 * 1024, 0x61) }], { deflate: true, claimSize: 100 });
  assert.throws(() => readZip(liar), /could not be unpacked|exceed|larger/i);
  assert.throws(() => readZip(makeZip([{ name: 'a', bytes: Buffer.alloc(3 * 1024 * 1024, 1) }, { name: 'b', bytes: Buffer.alloc(3 * 1024 * 1024, 1) }]), { maxEntries: 10, maxEntryBytes: 4 * 1024 * 1024, maxTotalBytes: 4 * 1024 * 1024 }), /more than/);

  assert.throws(() => readZip(Buffer.from('PK\x03\x04 this is not a zip at all')), Error);
  const r = scanPackage([{ name: 'broken.zip', bytes: Buffer.from('PK\x03\x04 not really') }]);
  assert.ok(r.findings.some((f) => f.id === 'package-load' && f.severity !== 'info'), 'a damaged zip is reported, not thrown');
});

test('nested zips (XML.zip + ICN.zip, as the Vektra plugin ships) are opened one level deep', () => {
  const entries = healthy();
  const xml = makeZip(entries.filter((e) => /^(DMC|PMC)/.test(e.name)).map((e) => ({ name: `XML/${e.name}`, bytes: e.bytes })));
  const icn = makeZip(entries.filter((e) => /^ICN/.test(e.name)).map((e) => ({ name: `ICN/${e.name}`, bytes: e.bytes })));
  const r = scanPackage([{ name: 'XML.zip', bytes: xml }, { name: 'ICN.zip', bytes: icn }]);
  assert.equal(r.counts.dms, 3);
  assert.equal(r.counts.icns, 1);
  assert.equal(r.graphics.missing.length, 0);
});

test('the same file shipped loose and inside a zip is one file, said once, not a warning per file', () => {
  const entries = healthy().map((e) => (/^ICN/.test(e.name) ? { ...e, name: `ICN/${e.name}` } : e));
  const zip = makeZip(entries.filter((e) => /^ICN/.test(e.name)).map((e) => ({ name: e.name.replace(/^ICN\//, ''), bytes: e.bytes })));
  const r = scanPackage([...entries, { name: 'ICN.zip', bytes: zip }]);
  assert.equal(r.counts.icns, 1);
  const notes = r.findings.filter((f) => f.id === 'package-load');
  assert.equal(notes.length, 1);
  assert.equal(notes[0].severity, 'info');
});

test('two graphics of one name from different folders with different content are a warning (they land side by side)', () => {
  const icn = 'ICN-TST-A-000000-A-00001-00001-A-001-01.png';
  const r = scanPackage([...healthy().filter((e) => !/^ICN/.test(e.name)), { name: `a/${icn}`, bytes: Buffer.from([1, 2, 3]) }, { name: `b/${icn}`, bytes: Buffer.from([4, 5, 6]) }]);
  assert.ok(r.findings.some((f) => f.id === 'package-load' && f.severity === 'warning' && /different content/.test(f.message)));
});

// ── flavour ───────────────────────────────────────────────────────────────

test('flavour: a plain S1000D package with no vendor evidence is generic-s1000d', () => {
  assert.equal(scanPackage(healthy()).flavour.id, 'generic-s1000d');
});

test('flavour: Vektra evidence (template publication, unsuffixed names, placeholder enterprise) is recognised from the data, not from a name', () => {
  const A = 'GAV-A-00-00-00-01A-040A-D';
  const B = 'GAV-A-00-00-00-02A-040A-D';
  const files = [A, B].map((c) => ({ name: `DMC-${c}.xml`, bytes: Buffer.from(dm({ dmc: c, enterprise: '12345', brex: 'H' })) }));
  const book = pmc({ code: { modelIdentCode: 'MODEL', pmIssuer: '00000', pmNumber: '00001', pmVolume: '00' }, title: 'Publication Module', entries: [A, B] });
  const r = scanPackage([...files, { name: 'PMC-IETM.xml', bytes: Buffer.from(book) }]);
  assert.equal(r.flavour.id, 'vektra', JSON.stringify(r.flavour));
  assert.ok(r.flavour.evidence.length >= 3);
});

test('flavour: a Xignal generator comment and a DOCTYPE declarations block mean xignal; a JSS comment makes it xignal-jss', () => {
  const A = 'TST-A-10-00-00-00A-040A-D';
  const xignal = dm({ dmc: A }).replace('<dmodule', '<!-- Xignal, S1000D Issue 4.2 [xml_schema_flat], Test Data -->\n<dmodule');
  assert.equal(scanPackage([{ name: dmFile(A), bytes: Buffer.from(xignal) }]).flavour.id, 'xignal-s1000d');
  const jss = dm({ dmc: A }).replace('<dmodule', '<!-- Xignal, S1000D Issue 4.2 [xml_schema_flat], JSS-0251 Test Data -->\n<dmodule');
  assert.equal(scanPackage([{ name: dmFile(A), bytes: Buffer.from(jss) }]).flavour.id, 'xignal-jss');
});

// ── the real sample sets ──────────────────────────────────────────────────

test('sample: Xignal S1000D export (1 master PMC, 218 modules, 491 graphics)', { skip: !fs.existsSync(SAMPLE_XIGNAL) }, () => {
  const entries = readTree(SAMPLE_XIGNAL);
  const before = sha(entries.find((e) => /^PMC-/.test(e.name)).bytes);
  const r = scanPackage(entries);
  assert.equal(r.flavour.id, 'xignal-s1000d');
  assert.equal(r.counts.dms, 218);
  assert.equal(r.counts.pmcs, 1);
  assert.equal(r.counts.icns, 491);
  assert.equal(r.graphics.missing.length, 0, 'every declared graphic is shipped');
  assert.equal(r.summary.errors, 0);
  assert.equal(r.publications[0].pmCode, 'RDR-1671Y-00039-00');
  assert.equal(r.subPublications.length, 9);
  assert.equal(sha(entries.find((e) => /^PMC-/.test(e.name)).bytes), before, 'input untouched');
});

test('sample: Xignal JSS export is told apart from the S1000D one', { skip: !fs.existsSync(SAMPLE_JSS) }, () => {
  const r = scanPackage(readTree(SAMPLE_JSS));
  assert.equal(r.flavour.id, 'xignal-jss');
  assert.equal(r.counts.dms, 26);
  assert.equal(r.counts.pmcs, 1);
  assert.equal(r.models.JSS0251, 19, 'the JSS model code carries the front-matter modules');
});

test('sample: Vektra plugin output (loose folders AND the zips of the same files)', { skip: !fs.existsSync(SAMPLE_VEKTRA) }, () => {
  const r = scanPackage(readTree(SAMPLE_VEKTRA));
  assert.equal(r.flavour.id, 'vektra');
  assert.equal(r.counts.dms, 33);
  assert.equal(r.publications[0].placeholder, true, 'MODEL/00000');
  assert.equal(r.graphics.missing.length, 13, 'the 13 ICNs the plugin never exported');
  assert.equal(r.unassigned.length, 10, 'ten modules that the placeholder publication does not place');
  const cols = r.findings.find((f) => f.id === 'table-cols-overflow');
  assert.ok(cols && /cols="3".*8 cells/.test(cols.message), 'DM32: cols="3" with 8 cells per row');
  const brex = r.findings.find((f) => f.id === 'brex-wrong-default');
  assert.ok(brex && /33 modules/.test(brex.message));
  const dupNotes = r.findings.filter((f) => f.id === 'package-load');
  assert.ok(dupNotes.length <= 2, 'the zips repeat the folders byte for byte: one info line, not 140 warnings');
});
