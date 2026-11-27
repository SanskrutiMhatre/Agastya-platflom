'use strict';
// The repairs: each rule on its own (before/after, idempotence, switchable), then the whole pipeline.
// A repair never edits the input: it returns repaired COPIES and a change log.

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { dm, dmFile, pmc, table } = require('./fixtures/importer/make');
const { loadPackage, repairPackage, repairedEntries, analyzePackage, pngInfo, isPlaceholderPng } = require('../dist/services/importer');
const { repairTables, analyseTables } = require('../dist/services/importer/repairs/tables');
const { repairBrex } = require('../dist/services/importer/repairs/brex');
const { RECONSTRUCTED_MARKER } = require('../dist/services/importer/package');
const { parsePm } = require('../vendor/engine/pmc');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const text = (result, name) => { const hit = [...result.files].find(([p]) => p.endsWith(name)); return hit ? Buffer.from(hit[1]).toString('utf8') : null; };
const A = 'TST-A-10-00-00-00A-040A-D';
const B = 'TST-A-10-00-00-00A-520A-A';
const C = 'TST-A-20-00-00-00A-040A-D';
const pkgOf = (files) => loadPackage(files.map(([name, xml]) => ({ name, bytes: Buffer.from(xml) })));
const rulesOnly = (...ids) => ({ repairs: ids });

// ── table-cols ────────────────────────────────────────────────────────────

test('table-cols: cols is raised to the widest row and colspecs are generated, keeping the widths that exist', () => {
  const before = table(3, [8, 8, 5], { colspecs: '<colspec colname="c1" colwidth="2*"/><colspec colname="c2" colwidth="3*"/><colspec colname="c3" colwidth="1*"/>' });
  const r = repairTables(before);
  assert.match(r.text, /<tgroup cols="8">/);
  const a = analyseTables(r.text)[0];
  assert.equal(a.colspecs.length, 8);
  assert.match(r.text, /colname="c1" colwidth="2\*"/, 'the existing widths survive');
  assert.match(r.text, /colname="c2" colwidth="3\*"/);
  assert.ok(r.changes.length >= 1 && r.changes.every((c) => c.rule === 'table-cols'));
  assert.match(r.changes.map((c) => `${c.before} ${c.after}`).join(' '), /3.*8/, 'the log shows 3 -> 8');
  // idempotent: a second pass finds nothing
  const again = repairTables(r.text);
  assert.equal(again.text, r.text);
  assert.equal(again.changes.length, 0);
});

test('table-cols: a table whose colspec count differs from cols is made consistent, extra unused colspecs are trimmed', () => {
  const extra = table(2, [2, 2], { colspecs: '<colspec colname="c1" colwidth="1*"/><colspec colname="c2" colwidth="1*"/><colspec colname="c3" colwidth="1*"/><colspec colname="c4" colwidth="1*"/>' });
  const r = repairTables(extra);
  assert.equal(analyseTables(r.text)[0].colspecs.length, 2);
  assert.equal(repairTables(r.text).changes.length, 0);
});

test('table-cols: a correct table, and one declaring MORE columns than any row uses, are left alone (the latter is only noted)', () => {
  const ok = table(3, [3, 3]);
  assert.equal(repairTables(ok).text, ok);
  const wide = table(4, [2, 2]);
  assert.equal(repairTables(wide).text, wide, 'cols larger than the widest row is legal; the importer does not guess');
});

test('table-cols: spanned cells (namest/nameend) and nested tables are counted correctly', () => {
  const spanned = '<table id="t"><title>T</title><tgroup cols="2"><colspec colname="a"/><colspec colname="b"/><colspec colname="c"/><tbody>'
    + '<row><entry namest="a" nameend="c">wide</entry></row><row><entry>1</entry><entry>2</entry></row></tbody></tgroup></table>';
  const a = analyseTables(spanned)[0];
  assert.equal(a.widest, 3, 'the span a..c is three columns');
  const nested = '<table id="o"><title>O</title><tgroup cols="1"><colspec colname="x"/><tbody><row><entry>'
    + '<table id="i"><title>I</title><tgroup cols="2"><colspec colname="p"/><colspec colname="q"/><tbody><row><entry>1</entry><entry>2</entry></row></tbody></tgroup></table>'
    + '</entry></row></tbody></tgroup></table>';
  assert.equal(repairTables(nested).text, nested, 'the outer table has 1 cell per row; the inner table is judged separately and is fine');
});

test('table-cols: through the pipeline - the original is untouched, the copy is repaired, the rule can be switched off', () => {
  const xml = dm({ dmc: A, body: table(3, [8, 8]) });
  const pkg = pkgOf([[dmFile(A), xml]]);
  const original = sha(pkg.files[0].bytes);
  const on = repairPackage(pkg, rulesOnly('table-cols'));
  assert.match(text(on, 'EN-IN.xml'), /<tgroup cols="8">/);
  assert.equal(sha(pkg.files[0].bytes), original, 'input bytes unchanged');
  assert.equal(pkg.dms[0].text, xml);
  const off = repairPackage(pkg, rulesOnly('brex-remap'));
  assert.equal(off.changeLog.filter((c) => c.rule === 'table-cols').length, 0);
  assert.equal(text(off, 'EN-IN.xml'), null, 'nothing else to change: no file is produced');
});

// ── icn-placeholder ───────────────────────────────────────────────────────

test('icn-placeholder: a declared graphic that is not shipped gets a valid, flagged placeholder PNG under the declared name', () => {
  const icn = 'ICN-TST-A-000000-A-00001-00001-A-001-01';
  const xml = dm({ dmc: A, entities: [{ name: icn, target: `${icn}.png` }], body: `<figure><title>F</title><graphic infoEntityIdent="${icn}"/></figure>` });
  const pkg = pkgOf([[dmFile(A), xml]]);
  const r = repairPackage(pkg, rulesOnly('icn-placeholder'));
  assert.equal(r.placeholders.length, 1);
  const png = [...r.files].find(([p]) => p.endsWith(`${icn}.png`));
  assert.ok(png, 'the PNG is among the repaired files');
  assert.ok(isPlaceholderPng(png[1]), 'flagged inside the file itself, not only in a log');
  assert.ok(pngInfo(png[1]).width >= 100);
  const log = r.changeLog.find((c) => c.rule === 'icn-placeholder' && c.kind === 'add');
  assert.equal(log.synthetic, true);
  assert.match(log.after, /placeholder/i);
  assert.equal(text(r, 'EN-IN.xml'), null, 'the module itself needs no edit when its entity is declared');
});

test('icn-placeholder: a graphic referenced but never declared gets an entity declaration as well, with the DOCTYPE otherwise preserved', () => {
  const icn = 'ICN-TST-A-000000-A-00002-00001-A-001-01';
  const xml = dm({ dmc: A, body: `<figure><title>F</title><graphic infoEntityIdent="${icn}"/></figure>` });
  const r = repairPackage(pkgOf([[dmFile(A), xml]]), rulesOnly('icn-placeholder'));
  const out = text(r, 'EN-IN.xml');
  assert.match(out, new RegExp(`<!ENTITY ${icn} SYSTEM "${icn}\\.png" NDATA`));
  assert.ok(out.indexOf('<!DOCTYPE') < out.indexOf('<dmodule'), 'the DOCTYPE comes before the root');
  assert.ok(r.changeLog.some((c) => c.rule === 'icn-placeholder' && /ENTITY|declar/i.test(`${c.where} ${c.after}`)));
});

test('icn-placeholder: idempotent - once the PNG ships in the package, nothing more is generated', () => {
  const icn = 'ICN-TST-A-000000-A-00001-00001-A-001-01';
  const xml = dm({ dmc: A, entities: [{ name: icn, target: `${icn}.png` }], body: `<figure><title>F</title><graphic infoEntityIdent="${icn}"/></figure>` });
  const pkg = pkgOf([[dmFile(A), xml]]);
  const first = repairPackage(pkg, rulesOnly('icn-placeholder'));
  const second = repairPackage(loadPackage(repairedEntries(pkg, first)), rulesOnly('icn-placeholder'));
  assert.equal(second.placeholders.length, 0);
  assert.equal(second.changeLog.filter((c) => c.rule === 'icn-placeholder').length, 0);
});

test('icn-placeholder: a graphic that IS shipped (in any case, with any folder) is never replaced', () => {
  const icn = 'ICN-TST-A-000000-A-00001-00001-A-001-01';
  const xml = dm({ dmc: A, entities: [{ name: icn, target: `${icn}.png` }] });
  const pkg = loadPackage([{ name: dmFile(A), bytes: Buffer.from(xml) }, { name: `art/${icn}.PNG`, bytes: Buffer.from([1, 2, 3]) }]);
  assert.equal(repairPackage(pkg, rulesOnly('icn-placeholder')).placeholders.length, 0);
});

// ── brex-remap ────────────────────────────────────────────────────────────

test('brex-remap: an issue-6 default BREX on a 4.2 module is pointed at the 4.2 default, and the change is logged', () => {
  const xml = dm({ dmc: A, issue: '4-2', brex: 'H' });
  assert.match(xml, /systemDiffCode="H"/);
  const r = repairBrex(xml, { issue: '4.2', shipped: new Set(), neutraliseMissing: false });
  assert.match(r.text, /<dmCode modelIdentCode="S1000D" systemDiffCode="F"/);
  assert.equal(r.changes.length, 1);
  assert.equal(r.changes[0].rule, 'brex-remap');
  assert.match(r.changes[0].before, /S1000D-H-04-10-0301-00A-022A-D/);
  assert.match(r.changes[0].after, /S1000D-F-04-10-0301-00A-022A-D/);
  const again = repairBrex(r.text, { issue: '4.2', shipped: new Set(), neutraliseMissing: false });
  assert.equal(again.changes.length, 0, 'idempotent');
});

test('brex-remap: a module whose BREX already matches its issue, or that names a custom BREX, is untouched; nothing is ever dropped', () => {
  const good = dm({ dmc: A, issue: '4-2', brex: 'F' });
  assert.equal(repairBrex(good, { issue: '4.2', shipped: new Set() }).text, good);
  const custom = dm({ dmc: A, issue: '4-2', brex: 'RDR-A-00-00-00-00A-022A-D' });
  const r = repairBrex(custom, { issue: '4.2', shipped: new Set() });
  assert.equal(r.text, custom, 'a project BREX is the project\'s business: never remapped');
  const none = dm({ dmc: A, issue: '4-2', brex: null });
  assert.equal(repairBrex(none, { issue: '4.2', shipped: new Set() }).text, none, 'no reference: none is invented');
});

test('brex-remap: through the pipeline it is consistent across every module and can be switched off', () => {
  const files = [[dmFile(A), dm({ dmc: A, brex: 'H' })], [dmFile(B), dm({ dmc: B, brex: 'H' })]];
  const pkg = pkgOf(files);
  const on = repairPackage(pkg, rulesOnly('brex-remap'));
  assert.equal(on.changeLog.filter((c) => c.rule === 'brex-remap').length, 2);
  for (const [, bytes] of on.files) assert.doesNotMatch(Buffer.from(bytes).toString(), /S1000D-H-04/);
  const off = repairPackage(pkg, rulesOnly('table-cols'));
  assert.equal(off.files.size, 0);
});

// ── publication: titles and identity ─────────────────────────────────────

test('pmc-titles + pmc-dmref-identity: the publication follows the module (title, language, issue); a dmRef to a missing module is reported, not invented', () => {
  const files = [
    [dmFile(A), dm({ dmc: A, tech: 'Pump', info: 'Description', lang: 'en-IN' })],
    [dmFile(B), dm({ dmc: B, tech: 'Pump', info: 'Removal', lang: 'en-IN' })],
    ['PMC-TST-00001-00001-00_001-00_EN-IN.xml', pmc({ lang: 'en-IN', entries: [
      { dm: A, tech: 'Wrong name', info: 'Wrong info', lang: ['en', 'US'], issue: ['009', '00'] },
      { dm: B, tech: 'Pump', info: 'Removal' },
      'TST-A-99-00-00-00A-040A-D',
    ] })],
  ];
  const pkg = pkgOf(files);
  const analysis = analyzePackage(files.map(([name, xml]) => ({ name, bytes: Buffer.from(xml) })));
  assert.ok(analysis.report.findings.some((f) => f.id === 'pmc-title-mismatch'));
  assert.ok(analysis.report.findings.some((f) => f.id === 'pmc-missing-dmref'), 'a dmRef to a module the package does not hold');

  const r = repairPackage(pkg, { repairs: ['pmc-titles', 'pmc-dmref-identity'] });
  const out = text(r, 'PMC-TST-00001-00001-00_001-00_EN-IN.xml');
  assert.match(out, /<techName>Pump<\/techName>/);
  assert.doesNotMatch(out, /Wrong name/);
  assert.doesNotMatch(out, /countryIsoCode="US"/);
  assert.match(out, /issueNumber="001"/);
  assert.match(out, /TST-A-99|systemCode="99"/, 'the dangling reference is kept, never silently removed');
  const titles = r.changeLog.filter((c) => c.rule === 'pmc-titles');
  assert.ok(titles.length >= 1 && titles[0].before.includes('Wrong') && titles[0].after.includes('Pump'));
  // idempotent
  const second = repairPackage(loadPackage(repairedEntries(pkg, r)), { repairs: ['pmc-titles', 'pmc-dmref-identity'] });
  assert.equal(second.changeLog.filter((c) => c.kind !== 'note').length, 0);
  // each rule is switchable on its own
  const onlyTitles = repairPackage(pkg, { repairs: ['pmc-titles'] });
  assert.match(text(onlyTitles, 'EN-IN.xml'), /countryIsoCode="US"/, 'identity rule off: language left as delivered');
});

// ── pmc-reconstruct ───────────────────────────────────────────────────────

test('pmc-reconstruct: a template publication (MODEL/00000) gets a real header from the modules and is marked reconstructed', () => {
  const title = 'TST-A-00-00-00-00A-001A-D';
  const files = [
    [dmFile(title), dm({ dmc: title, tech: 'Service manual', info: 'Title page', enterprise: 'ACM01', lang: 'en-IN' })],
    [dmFile(A), dm({ dmc: A, enterprise: 'ACM01' })],
    ['PMC-IETM.xml', pmc({ code: { modelIdentCode: 'MODEL', pmIssuer: '00000', pmNumber: '00001', pmVolume: '00' }, title: 'Publication Module', lang: 'en-US', entries: [title, A] })],
  ];
  const pkg = pkgOf(files);
  assert.equal(pkg.pmcs[0].placeholder, true);
  const r = repairPackage(pkg, rulesOnly('pmc-reconstruct'));
  const out = text(r, 'PMC-IETM.xml');
  assert.ok(out.includes(RECONSTRUCTED_MARKER), 'marked reconstructed inside the file');
  assert.doesNotMatch(out, /modelIdentCode="MODEL"/);
  assert.match(out, /modelIdentCode="TST"/);
  assert.match(out, /languageIsoCode="en" countryIsoCode="IN"|countryIsoCode="IN"/);
  assert.equal(parsePm(out).entries.length > 0, true, 'the rebuilt publication is a readable PM');
  assert.equal(r.publication.reconstructed, 'metadata', 'its structure was real, only the header was rebuilt');
  assert.ok(r.changeLog.some((c) => c.rule === 'pmc-reconstruct' && c.synthetic));
  // idempotent: the rebuilt one carries the marker and is no longer a template
  const second = repairPackage(loadPackage(repairedEntries(pkg, r)), rulesOnly('pmc-reconstruct'));
  assert.equal(second.changeLog.filter((c) => c.rule === 'pmc-reconstruct' && c.kind !== 'note').length, 0);
  // switched off: delivered as it came
  assert.equal(text(repairPackage(pkg, rulesOnly('table-cols')), 'PMC-IETM.xml'), null);
});

test('pmc-reconstruct: with no publication at all one is synthesised - SNS hierarchy folders, title page first, modules ordered by code', () => {
  const t = 'TST-A-00-00-00-00A-001A-D';
  const p1 = 'TST-A-10-00-00-00A-040A-D';
  const p2 = 'TST-A-10-00-00-00A-520A-A';
  const p3 = 'TST-A-10-00-00-00A-040A-A';
  const q1 = 'TST-A-20-30-00-00A-040A-D';
  const q2 = 'TST-A-20-40-00-00A-040A-D';
  const files = [p2, q2, p1, t, q1, p3].map((c) => [dmFile(c), dm({ dmc: c, tech: `Item ${c.slice(8, 10)}`, info: c.startsWith('TST-A-00') ? 'Title page' : 'Information' })]);
  const r = repairPackage(pkgOf(files), rulesOnly('pmc-reconstruct'));
  const pmcPath = [...r.files.keys()].find((k) => /^PMC-/.test(k.split('/').pop()));
  assert.ok(pmcPath, 'a PMC file is produced');
  const out = Buffer.from(r.files.get(pmcPath)).toString();
  assert.ok(out.includes(RECONSTRUCTED_MARKER));
  const model = parsePm(out);
  const flat = []; (function walk(l) { for (const e of l) { if (e.type === 'folder') walk(e.children); else if (e.type === 'dm') flat.push(`${e.dmCode.systemCode}-${e.dmCode.infoCode}${e.dmCode.infoCodeVariant}`); } })(model.entries);
  assert.equal(flat.length, 6, 'every module is placed');
  assert.equal(flat[0], '00-001A', 'the title page is first');
  assert.ok(flat.indexOf('10-040A') < flat.indexOf('10-040A', 0) + 1);
  assert.equal(r.publication.reconstructed, 'full');
  assert.equal(r.pool.length, 0, 'a synthesised publication places everything: nothing is orphaned');
});

// ── orphans: the unassigned pool ─────────────────────────────────────────

test('orphans: modules no publication places go to the pool - never dropped, never auto-published - unless assembly is asked for', () => {
  const files = [
    [dmFile(A), dm({ dmc: A })], [dmFile(B), dm({ dmc: B })], [dmFile(C), dm({ dmc: C })],
    ['PMC-TST-00001-00001-00_001-00_EN-IN.xml', pmc({ entries: [A] })],
  ];
  const pkg = pkgOf(files);
  const kept = repairPackage(pkg, { repairs: [] });
  assert.deepEqual(kept.pool.map((p) => p.dmc).sort(), [B, C].sort());
  assert.ok(kept.pool.every((p) => p.reason === 'not-in-any-pmc'));
  assert.equal(countDms(kept.publication.model.entries), 1, 'the publication still lists only what the author placed');
  assert.ok(kept.changeLog.some((c) => c.rule === 'orphans-pool'), 'the pool is logged');

  const assembled = repairPackage(pkg, { repairs: [], assembleUnassigned: true });
  assert.equal(assembled.pool.length, 0);
  assert.equal(countDms(assembled.publication.model.entries), 3);
  assert.ok(assembled.publication.assembledPoolFolder, 'they land in one clearly named folder, not mixed into the book');
});
const countDms = (list) => list.reduce((n, e) => n + (e.type === 'folder' ? countDms(e.children) : e.type === 'dm' ? 1 : 0), 0);

test('orphans: a module that two publications place is reused, not orphaned, and counted', () => {
  const files = [
    [dmFile(A), dm({ dmc: A })], [dmFile(B), dm({ dmc: B })],
    ['PMC-TST-00001-00001-00_001-00_EN-IN.xml', pmc({ entries: [A, B, { pmRef: { modelIdentCode: 'TST', pmIssuer: '00001', pmNumber: '00002', pmVolume: '00' }, title: 'Annex' }] })],
    ['PMC-TST-00001-00002-00_001-00_EN-IN.xml', pmc({ code: { modelIdentCode: 'TST', pmIssuer: '00001', pmNumber: '00002', pmVolume: '00' }, entries: [B] })],
  ];
  const r = repairPackage(pkgOf(files), { repairs: [] });
  assert.equal(r.pool.length, 0);
  const reused = r.reusedDms.find((d) => d.dmc === B);
  assert.ok(reused && reused.occurrences === 2);
  assert.equal(r.subPublications.length, 1);
  assert.equal(r.subPublications[0].status, 'nested');
});

// ── the whole pipeline ───────────────────────────────────────────────────

test('the pipeline: non-destructive, switchable per rule, and idempotent on a package with every defect at once', () => {
  const icn = 'ICN-TST-A-000000-A-00001-00001-A-001-01';
  const files = [
    [dmFile(A), dm({ dmc: A, brex: 'H', entities: [{ name: icn, target: `${icn}.png` }], body: table(2, [5, 5]) + `<figure><title>F</title><graphic infoEntityIdent="${icn}"/></figure>` })],
    [dmFile(B), dm({ dmc: B, brex: 'H' })],
    [dmFile(C), dm({ dmc: C, brex: 'H' })],
    ['PMC-IETM.xml', pmc({ code: { modelIdentCode: 'MODEL', pmIssuer: '00000', pmNumber: '00001', pmVolume: '00' }, entries: [{ dm: A, tech: 'Old', info: 'Old' }, B] })],
  ];
  const entries = files.map(([name, xml]) => ({ name, bytes: Buffer.from(xml) }));
  const hashes = entries.map((e) => sha(e.bytes));
  const pkg = loadPackage(entries);
  const first = repairPackage(pkg, {});
  assert.deepEqual(entries.map((e) => sha(e.bytes)), hashes, 'the input is never modified');
  const touched = new Set(first.changeLog.filter((c) => c.kind !== 'note').map((c) => c.rule));
  for (const rule of ['table-cols', 'icn-placeholder', 'brex-remap', 'pmc-reconstruct', 'pmc-titles']) assert.ok(touched.has(rule), `${rule} ran`);
  assert.ok(first.changeLog.every((c, i) => c.seq === i + 1), 'the log is numbered in order');
  assert.ok(first.changeLog.every((c) => c.file && c.rule), 'every entry names a file and a rule');
  assert.equal(first.pool.length, 1, 'C is in no publication: in the pool, still in the package');

  const second = repairPackage(loadPackage(repairedEntries(pkg, first)), {});
  assert.equal(second.changeLog.filter((c) => c.kind !== 'note').length, 0, 'idempotent: a second run changes nothing');
  assert.equal(second.files.size, 0);
  assert.equal(second.pool.length, 1, 'the pool is a state, not an edit: it is still there');
});

test('the pipeline: an empty rule list changes nothing at all', () => {
  const files = [[dmFile(A), dm({ dmc: A, brex: 'H', body: table(2, [5]) })]];
  const r = repairPackage(pkgOf(files), { repairs: [] });
  assert.equal(r.files.size, 0);
  assert.equal(r.changeLog.filter((c) => c.kind !== 'note').length, 0);
});

// ── the Vektra sample: every defect the brief names, fixed, once ─────────

// The customer's Vektra plugin output: VEKTRA_SAMPLE, else SAMPLE PROJECTS/RWI (git-ignored). Nothing outside the repository is read by default (QA-014).
const VEKTRA = process.env.VEKTRA_SAMPLE || path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'RWI');
test('Vektra sample: DM32 cols 3 -> 8, 13 placeholders, BREX H -> F on 33 modules, rebuilt header, idempotent', { skip: !fs.existsSync(path.join(VEKTRA, 'XML')) && `the Vektra sample is not in this checkout (looked in ${VEKTRA}; set VEKTRA_SAMPLE)` }, () => {
  const entries = [];
  for (const d of ['XML', 'ICN']) for (const f of fs.readdirSync(path.join(VEKTRA, d))) entries.push({ name: `${d}/${f}`, bytes: fs.readFileSync(path.join(VEKTRA, d, f)) });
  entries.push({ name: 'PMC-IETM.xml', bytes: fs.readFileSync(path.join(VEKTRA, 'PMC-IETM.xml')) });
  const pkg = loadPackage(entries);
  const r = repairPackage(pkg, {});

  const dm32 = [...r.files].find(([p]) => p.includes('GAV-A-00-00-00-32A'));
  const t32 = Buffer.from(dm32[1]).toString();
  assert.match(t32, /<tgroup cols="8"/);
  assert.equal(analyseTables(t32)[0].colspecs.length, 8);

  assert.equal(r.placeholders.length, 13, '13 ICNs the plugin never exported');
  for (const p of r.placeholders) assert.ok(isPlaceholderPng(r.files.get(p.file)));
  assert.equal(r.changeLog.filter((c) => c.rule === 'brex-remap').length, 33);
  assert.equal(r.publication.reconstructed, 'metadata');
  const pmcOut = Buffer.from(r.files.get('PMC-IETM.xml')).toString();
  assert.doesNotMatch(pmcOut, /modelIdentCode="MODEL"/);
  assert.match(pmcOut, /modelIdentCode="GAV"/);
  assert.equal(r.pool.length, 10, 'ten orphans, kept');
  for (const p of r.pool) assert.ok(pkg.dms.some((d) => d.file.path.endsWith(p.file) || d.file.base === p.file), 'every pooled module is a real module of the package');
  assert.ok(r.changeLog.filter((c) => c.rule === 'pmc-titles').length >= 23, 'the 23 PMC/DM title mismatches');

  const second = repairPackage(loadPackage(repairedEntries(pkg, r)), {});
  assert.equal(second.changeLog.filter((c) => c.kind !== 'note').length, 0, 'idempotent on the real data');
});
