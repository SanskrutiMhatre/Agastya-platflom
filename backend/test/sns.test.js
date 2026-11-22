'use strict';
// SNS: the code rules, titles, structure derivation (grouping, ordering, determinism), the publication module it writes,
// BREX import and learning from data modules. Pure functions only - no server, no workspace (HTTP is in sns-http.test.js).
// Real data: a small valid S1000D 4.2 fixture set (test/fixtures/sns) and, when present, the Xignal S1000D sample project.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const codes = require('../dist/services/sns/codes');
const model = require('../dist/services/sns/model');
const { readDmFolder, dmLikeFromXml } = require('../dist/services/sns/dms');
const { deriveStructure, structureDms } = require('../dist/services/sns/derive');
const { learnSnsFromDms, snsRowsFromBrexModel, pickTitle } = require('../dist/services/sns/learn');
const { structureToPmEntries, buildPmXml, defaultPmMeta, spliceContent } = require('../dist/services/sns/pmxml');
const { parseBrexModel } = require('../dist/services/brex');
const { validateProjectSchema } = require('../vendor/engine/validateSchema');
const pmc = require('../vendor/engine/pmc');

const FIX = path.join(__dirname, 'fixtures', 'sns');
const SAMPLE = path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'S1000D', 'PMC-RDR-1671Y-00039-00_001-01.xml (2)');

const SNS = [
  { systemCode: '32', title: 'Landing gear' },
  { systemCode: '32', subSystemCode: '1', title: 'Main gear and doors' },
  { systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', title: 'Main gear' },
  { systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', assyCode: '10', title: 'Shock strut' },
  { systemCode: '32', subSystemCode: '2', title: 'Nose gear and doors' },
  { systemCode: '29', title: 'Hydraulic power' },
  { systemDiffCode: 'B', systemCode: '29', title: 'Hydraulic power (variant B)' },
];

/** Small deterministic PRNG, so a shuffle in a test is the same on every machine. */
const prng = (seed) => () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
const shuffled = (list, rnd) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

const walk = (nodes, fn, trail = []) => { for (const n of nodes) { fn(n, trail); if (n.children) walk(n.children, fn, [...trail, n]); } };

const fixtureDms = () => readDmFolder(path.join(FIX, 'dms')).dms;

// ── the code rules ─────────────────────────────────────────────────────────────────────────────

test('SNS code rules: what is accepted, normalised and refused', () => {
  const ok = (o) => { const r = model.normalizeRow(o); assert.ok(r.row, `${JSON.stringify(o)}: ${r.errors.join(' ')}`); return r.row; };
  const no = (o, re) => { const r = model.normalizeRow(o); assert.equal(r.row, undefined, `${JSON.stringify(o)} should be refused`); assert.match(r.errors.join(' '), re); };

  assert.equal(ok({ systemCode: '32', title: 'Landing gear' }).systemDiffCode, '', 'the difference code is optional');
  assert.equal(ok({ systemCode: 'a05', subSystemCode: '4', title: ' General ' }).systemCode, 'A05', 'codes are upper-cased, titles trimmed');
  assert.equal(ok({ systemDiffCode: 'ABCD', systemCode: '32', title: 'x' }).systemDiffCode, 'ABCD');
  assert.equal(ok({ systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', assyCode: '10', title: 'Shock strut' }).assyCode, '10');
  assert.equal(ok({ systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', assyCode: '0301', title: 'x' }).assyCode, '0301', 'a four-character assembly code');

  no({ systemCode: '3', title: 'x' }, /System code/);
  no({ systemCode: '3200', title: 'x' }, /System code/);
  no({ systemCode: '32', subSystemCode: '12', title: 'x' }, /Sub-system code/);
  no({ systemCode: '32', subSystemCode: '1', subSubSystemCode: '01', title: 'x' }, /Sub-sub-system code/);
  no({ systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', assyCode: '100', title: 'x' }, /Assembly code[\s\S]*2 or 4/);
  no({ systemCode: '32', subSystemCode: '1', subSubSystemCode: '0', assyCode: '1', title: 'x' }, /Assembly code/);
  no({ systemDiffCode: 'ABCDE', systemCode: '32', title: 'x' }, /difference code/i);
  no({ systemCode: '3-', title: 'x' }, /System code/);
  no({ systemCode: '', title: 'x' }, /System code is required/);
  no({ systemCode: '32', title: '' }, /title is required/i);
  no({ systemCode: '32', title: 'x'.repeat(300) }, /longer than/);
  no({ systemCode: '32', subSubSystemCode: '1', title: 'x' }, /needs a sub-system/);
  no({ systemCode: '32', subSystemCode: '1', assyCode: '10', title: 'x' }, /needs a sub-system code and a sub-sub-system/);
  no(null, /System code is required/);
  const many = model.normalizeRow({ systemCode: '3', subSystemCode: '12', title: '' });
  assert.ok(many.errors.length >= 3, 'every problem is reported, not just the first');
});

test('the rules agree with the bundled S1000D schemas (assembly code is exactly 2 or 4 characters, not 2 to 4)', () => {
  const SCHEMAS = path.join(__dirname, '..', 'schemas');
  const patternOf = (xsd, type) => {
    const m = new RegExp(`name="${type}"[\\s\\S]*?<xs:pattern value="([^"]+)"`).exec(xsd);
    return m ? new RegExp(`^(?:${m[1]})$`) : null;
  };
  const probes = ['', 'A', 'AB', 'ABC', 'ABCD', 'ABCDE', '1', '12', '123', '1234', 'A1', 'a1', 'A-', '0301', '00'];
  let compared = 0;
  for (const issue of ['4.1', '4.2', '5.0', '6.0', '7.0']) {
    const dir = path.join(SCHEMAS, issue);
    const file = fs.readdirSync(dir).find((f) => f.endsWith('.xsd') && fs.readFileSync(path.join(dir, f), 'utf8').includes('assyCodeAttType'));
    assert.ok(file, `issue ${issue}: a schema that defines the assembly code`);
    const xsd = fs.readFileSync(path.join(dir, file), 'utf8');
    const types = { systemDiffCode: 'systemDiffCodeAttType', systemCode: 'systemCodeAttType', subSystemCode: 'subSystemCodeAttType', subSubSystemCode: 'subSubSystemCodeAttType', assyCode: 'assyCodeAttType' };
    for (const [key, type] of Object.entries(types)) {
      const re = patternOf(xsd, type);
      if (!re) continue;
      for (const p of probes) {
        if (!p) continue;
        assert.equal(codes.SNS_CODE_RULES[key].re.test(p), re.test(p), `issue ${issue}, ${key}: "${p}" is ${re.test(p) ? 'valid' : 'invalid'} in the schema`);
        compared++;
      }
    }
  }
  assert.ok(compared > 100, `compared ${compared} code/value pairs`);
});

test('duplicates and orphans in a set of rows', () => {
  const rows = [
    { id: '1', systemDiffCode: '', systemCode: '32', subSystemCode: '', subSubSystemCode: '', assyCode: '', title: 'Landing gear' },
    { id: '2', systemDiffCode: '', systemCode: '32', subSystemCode: '', subSubSystemCode: '', assyCode: '', title: 'Undercarriage' },
    { id: '3', systemDiffCode: '', systemCode: '29', subSystemCode: '1', subSubSystemCode: '', assyCode: '', title: 'Main' },
    { id: '4', systemDiffCode: 'B', systemCode: '32', subSystemCode: '', subSubSystemCode: '', assyCode: '', title: 'Landing gear B' },
  ];
  const problems = model.validateRowSet(rows);
  const dup = problems.find((p) => p.code === 'DUPLICATE');
  assert.ok(dup && dup.rowIds.join() === '1,2', JSON.stringify(problems));
  assert.equal(dup.severity, 'error');
  const orphan = problems.find((p) => p.code === 'ORPHAN');
  assert.ok(orphan && orphan.rowIds[0] === '3' && orphan.severity === 'warn', 'a sub-system without its system is a warning');
  assert.equal(problems.filter((p) => p.rowIds.includes('4')).length, 0, 'the same code under another difference code is not a duplicate');
});

// ── titles ────────────────────────────────────────────────────────────────────────────────────────

test('snsTitle at system, sub-system and assembly level; a difference code overrides', () => {
  const tree = new model.SnsTree(SNS);
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-10-10-00A-520A-D', tree, 'system'), 'Landing gear');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-10-10-00A-520A-D', tree, 'subsystem'), 'Main gear and doors');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-10-10-00A-520A-D', tree, 'subsubsystem'), 'Main gear');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-10-10-00A-520A-D', tree, 'assy'), 'Shock strut');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-10-10-00A-520A-D', tree), 'Shock strut', 'auto: the deepest defined level');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-20-00-00A-040A-D', tree), 'Nose gear and doors');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-50-00-00A-040A-D', tree), 'Landing gear', 'a level the SNS does not define falls back to the one above');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-32-50-00-00A-040A-D', tree, 'subsystem'), null, 'but asked for that level exactly it is null');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-29-10-00-00A-040A-D', tree), 'Hydraulic power');
  assert.equal(model.snsTitle('DMC-SNSTEST-B-29-10-00-00A-040A-D', tree), 'Hydraulic power (variant B)', 'the row for difference code B wins for B');
  assert.equal(model.snsTitle('DMC-SNSTEST-A-99-00-00-00A-040A-D', tree), null);
  assert.equal(model.snsTitle('not a code', tree), null);
  assert.equal(model.snsTitle({ dmCodeAttrs: { modelIdentCode: 'X', systemDiffCode: 'A', systemCode: '29', subSystemCode: '0', subSubSystemCode: '0', assyCode: '00', disassyCode: '00', infoCode: '040' } }, tree), 'Hydraulic power', 'a data module object works too');
});

// ── deriving the structure ────────────────────────────────────────────────────────────────────────

test('derive: grouping into system > sub-system > assembly, in SNS order, with Unclassified', () => {
  const dms = fixtureDms();
  assert.equal(dms.length, 16);
  const st = deriveStructure(dms, SNS);
  assert.equal(st.counts.dms, 15, '16 files, one superseded issue');
  assert.deepEqual(st.superseded.map((s) => s.file), ['DMC-SNSTEST-A-32-10-10-00A-520A-D_001-00_EN-US.xml']);

  const titles = (nodes) => nodes.map((n) => (n.kind === 'dm' ? n.dmc : `${n.code} ${n.title}`));
  assert.deepEqual(titles(st.roots), ['29 Hydraulic power', '29 Hydraulic power (variant B)', '32 Landing gear', ' Unclassified'], 'systems by code, then difference code; Unclassified last');

  const gear = st.roots.find((r) => r.code === '32');
  const kids = gear.children.filter((c) => c.kind === 'module');
  assert.deepEqual(kids.map((k) => `${k.level}:${k.code} ${k.title}`), ['subsystem:32-1 Main gear and doors', 'subsystem:32-2 Nose gear and doors']);
  const main = kids[0];
  const strut = main.children.find((c) => c.kind === 'module');
  assert.equal(strut.level, 'assy');
  assert.equal(strut.title, 'Shock strut');
  assert.equal(strut.children.length, 5, 'five modules in the assembly, the old issue of 520 is not one of them');
  assert.equal(strut.children.find((c) => c.infoCode === '520').issueInfo.issueNumber, '002', 'the newest issue is placed');

  // a zero code is "this level itself": the zero sub-sub-system is collapsed unless asked for
  const full = deriveStructure(dms, SNS, { collapseZero: false });
  const sub = full.roots.find((r) => r.code === '32').children.find((c) => c.kind === 'module' && c.code === '32-1');
  const subsub = sub.children.find((c) => c.kind === 'module');
  assert.equal(subsub.level, 'subsubsystem', 'collapseZero:false keeps the level');
  assert.equal(subsub.title, 'Main gear');
  assert.equal(subsub.children.find((c) => c.kind === 'module').title, 'Shock strut');

  const out = titles(st.roots.find((r) => r.level === 'unclassified').children);
  assert.deepEqual(out, ['SNSTEST-A-99-00-00-00A-040A-D']);
});

test('derive: a sub-level the SNS does not define hangs from the nearest defined level and says so', () => {
  const st = deriveStructure(fixtureDms(), SNS);
  const gear = st.roots.find((r) => r.code === '32');
  const partial = gear.children.find((c) => c.kind === 'dm' && c.dmc.includes('-32-50-'));
  assert.ok(partial, 'the 32-5 module sits on system 32');
  assert.equal(partial.match, 'partial');
  assert.match(partial.missing.join(' '), /32-5/);
  assert.ok(st.warnings.some((w) => /nearest defined level/.test(w)));

  const strict = deriveStructure(fixtureDms(), SNS, { unmatched: 'unclassified' });
  const un = strict.roots.find((r) => r.level === 'unclassified');
  assert.ok(un.children.some((c) => c.kind === 'dm' && c.dmc.includes('-32-50-')), "unmatched:'unclassified' moves it out");
  assert.equal(deriveStructure(fixtureDms(), SNS, { unclassifiedTitle: 'Not yet numbered' }).roots.at(-1).title, 'Not yet numbered');
});

test('derive: modules are ordered by SNS code, then by information-code group (description first ... 9xx last)', () => {
  const st = deriveStructure(fixtureDms(), SNS);
  const strut = st.roots.find((r) => r.code === '32').children.find((c) => c.code === '32-1').children.find((c) => c.kind === 'module');
  const groups = strut.children.map((c) => c.infoGroup);
  assert.deepEqual(groups, ['0xx', '5xx', '7xx', '9xx', '9xx'], 'description, remove, install, parts, process');
  assert.deepEqual(strut.children.map((c) => c.infoCode), ['040', '520', '720', '941', '951']);

  const gear = st.roots.find((r) => r.code === '32');
  assert.deepEqual(gear.children.filter((c) => c.kind === 'dm' && c.dmc.includes('-32-00-')).map((c) => c.infoCode), ['018', '040', '520']);

  // the table is overridable: put the install procedure first, pin 951 last, rank 941 before 520
  const custom = deriveStructure(fixtureDms(), SNS, { order: { pinFirst: ['720'], pinLast: ['040'], rank: { 941: -5 } } });
  const s2 = custom.roots.find((r) => r.code === '32').children.find((c) => c.code === '32-1').children.find((c) => c.kind === 'module');
  assert.deepEqual(s2.children.map((c) => c.infoCode), ['720', '941', '520', '951', '040']);
  // a different group table
  const flipped = deriveStructure(fixtureDms(), SNS, { order: { groups: [...codes.INFO_CODE_GROUPS].reverse() } });
  const s3 = flipped.roots.find((r) => r.code === '32').children.find((c) => c.code === '32-1').children.find((c) => c.kind === 'module');
  assert.deepEqual(s3.children.map((c) => c.infoGroup), ['9xx', '9xx', '7xx', '5xx', '0xx']);
});

test('derive: the same input gives the same structure, whatever order it arrives in', () => {
  const dms = fixtureDms();
  const base = JSON.stringify(deriveStructure(dms, SNS));
  const rnd = prng(20261120);
  for (let i = 0; i < 25; i++) {
    assert.equal(JSON.stringify(deriveStructure(shuffled(dms, rnd), shuffled(SNS, rnd))), base, `shuffle ${i}`);
  }
  assert.equal(JSON.stringify(deriveStructure(dms, SNS)), base, 'and again');
  // an SNS given as a tree, or as rows with ids, is the same SNS
  assert.equal(JSON.stringify(deriveStructure(dms, new model.SnsTree(SNS))), base);
});

test('derive: exclude keeps named files (generated front matter) out of the structure', () => {
  const dms = fixtureDms();
  const gone = 'DMC-SNSTEST-A-99-00-00-00A-040A-D_001-00_EN-US.xml';
  const st = deriveStructure(dms, SNS, { exclude: [gone] });
  assert.equal(st.counts.dms, 14);
  assert.equal(st.roots.some((r) => r.level === 'unclassified'), false, 'nothing left to be unclassified');
  assert.equal(deriveStructure(dms, SNS, { exclude: (d) => d.file === gone }).counts.dms, 14);
  assert.equal(deriveStructure(dms, SNS, { latestOnly: false }).counts.dms, 16, 'latestOnly:false places every issue');
});

test('derive with no SNS at all: everything is Unclassified, nothing is lost', () => {
  const st = deriveStructure(fixtureDms(), []);
  assert.equal(st.counts.dms, 15);
  assert.equal(st.roots.length, 1);
  assert.equal(st.roots[0].level, 'unclassified');
});

// ── the Xignal S1000D sample, read directly ───────────────────────────────────────────────────────

test('real data: the Xignal S1000D sample derives completely, in order, and deterministically', { skip: !fs.existsSync(SAMPLE) && 'SAMPLE PROJECTS/S1000D is not present' }, async () => {
  const { dms, skipped } = readDmFolder(SAMPLE);
  assert.equal(skipped.length, 0);
  assert.ok(dms.length > 100, `read ${dms.length} modules`);

  const learned = learnSnsFromDms(dms);
  const sns = learned.proposals.map((p) => p.row);
  assert.ok(sns.length > 10);
  const st = deriveStructure(dms, sns);

  // every module is placed exactly once
  const placed = structureDms(st);
  assert.equal(placed.length, dms.length - st.superseded.length - st.skipped.length);
  assert.equal(new Set(placed.map((d) => d.file)).size, placed.length, 'no module twice');
  assert.equal(st.counts.unclassified, 0, 'the SNS was learned from these very modules, so every module has a home');

  // grouping: a module sits under the node its own SNS code names
  walk(st.roots, (n, trail) => {
    if (n.kind !== 'dm') return;
    const parts = codes.parseDmCode(n.dmCode);
    const sys = trail.find((t) => t.level === 'system');
    assert.ok(sys, `${n.dmc} has a system above it`);
    assert.equal(sys.code, parts.systemCode, `${n.dmc} is under system ${parts.systemCode}`);
    for (const t of trail) {
      if (t.level === 'subsystem') assert.equal(t.code.split('-')[1], parts.subSystemCode, `${n.dmc} under sub-system ${t.code}`);
    }
  });

  // ordering: within a node, the information-code group never goes backwards; systems are in code order
  walk(st.roots, (n) => {
    if (!n.children) return;
    const mods = n.children.filter((c) => c.kind === 'dm');
    const bySns = [];
    for (const d of mods) {
      const p = codes.parseDmCode(d.dmCode);
      bySns.push(`${p.systemCode}|${p.subSystemCode}${p.subSubSystemCode}|${p.assyCode}`);
    }
    assert.deepEqual([...bySns].sort(), bySns, `modules of ${n.code} are in SNS code order`);
    let prev = -1;
    let prevKey = '';
    mods.forEach((d, i) => {
      const p = codes.parseDmCode(d.dmCode);
      const key = `${p.systemCode}|${p.subSystemCode}${p.subSubSystemCode}|${p.assyCode}`;
      if (key !== prevKey) { prev = -1; prevKey = key; }
      const g = codes.infoGroupOf(d.infoCode).index;
      assert.ok(g >= prev, `${d.dmc}: group ${d.infoGroup} comes after a later group (position ${i})`);
      prev = g;
    });
  });
  const systems = st.roots.filter((r) => r.level === 'system').map((r) => r.code);
  assert.deepEqual([...systems].sort(), systems, 'systems in code order');

  // determinism
  const base = JSON.stringify(st);
  const rnd = prng(7);
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(deriveStructure(shuffled(dms, rnd), shuffled(sns, rnd))), base);

  // serialisation: the publication module is valid S1000D 4.2 and reads back with every module
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-sample-'));
  try {
    const xml = buildPmXml(structureToPmEntries(st), defaultPmMeta('Xignal sample - derived', { modelIdentCode: 'RDR' }));
    fs.writeFileSync(path.join(dir, 'PMC.xml'), xml);
    const v = await validateProjectSchema(dir, ['PMC.xml']);
    assert.equal(v.checked, 1);
    assert.deepEqual(v.issues, [], JSON.stringify(v.issues.slice(0, 2)));
    assert.equal(pmc.countEntries(pmc.parsePm(xml).entries).dms, placed.length);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ── the publication module ────────────────────────────────────────────────────────────────────────

test('serialisation: the derived publication module validates against pm.xsd and reads back identically', async () => {
  const st = deriveStructure(fixtureDms(), SNS);
  const entries = structureToPmEntries(st);
  const xml = buildPmXml(entries, defaultPmMeta('Fixture publication', { modelIdentCode: 'SNSTEST' }));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sns-pm-'));
  try {
    fs.writeFileSync(path.join(dir, 'pm.xml'), xml);
    const v = await validateProjectSchema(dir, ['pm.xml']);
    assert.equal(v.checked, 1, 'the file declares a schema and was checked');
    assert.deepEqual(v.issues, [], JSON.stringify(v.issues.slice(0, 3)));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  const back = pmc.parsePm(xml);
  assert.deepEqual(pmc.countEntries(back.entries), pmc.countEntries(entries));
  assert.equal(pmc.countEntries(back.entries).dms, 15);
  const titles = [];
  walk(back.entries, (e) => { if (e.type === 'folder') titles.push(e.title); });
  assert.deepEqual(titles, ['Hydraulic power', 'Hydraulic power (variant B)', 'Landing gear', 'Main gear and doors', 'Shock strut', 'Nose gear and doors', 'Unclassified']);
  assert.match(xml, /<dmCode modelIdentCode="SNSTEST" systemDiffCode="A" systemCode="32"/);
  assert.equal(buildPmXml(entries, defaultPmMeta('Fixture publication', { modelIdentCode: 'SNSTEST' })), buildPmXml(entries, defaultPmMeta('Fixture publication', { modelIdentCode: 'SNSTEST' })), 'same input, same text');
});

test('serialisation: code-title format, and splicing into an existing publication keeps its header', () => {
  const st = deriveStructure(fixtureDms(), SNS);
  const coded = structureToPmEntries(st, { titleFormat: 'code-title' });
  assert.equal(coded[2].title, '32 - Landing gear');
  assert.equal(coded.at(-1).title, 'Unclassified', 'the Unclassified bucket has no code to prefix');

  const meta = defaultPmMeta('Original header', { modelIdentCode: 'SNSTEST' });
  const original = buildPmXml(structureToPmEntries(st), meta);
  const none = deriveStructure(fixtureDms(), SNS, { exclude: (d) => !d.file.includes('-A-29-') });
  const spliced = spliceContent(original, structureToPmEntries(none));
  assert.ok(spliced.includes('<pmTitle>Original header</pmTitle>'), 'header untouched');
  assert.equal(pmc.countEntries(pmc.parsePm(spliced).entries).dms, 2);
  assert.equal(spliceContent('<pm></pm>', []), null, 'nothing to splice into');
});

// ── BREX and learning ─────────────────────────────────────────────────────────────────────────────

test('BREX snsRules become SNS rows; invalid codes are reported, not dropped', () => {
  const brexFile = fs.readdirSync(path.join(FIX, 'brex'))[0];
  const m = parseBrexModel(fs.readFileSync(path.join(FIX, 'brex', brexFile), 'utf8'), brexFile, true);
  assert.ok(m.sns.length >= 2);
  const { rows, rejected } = snsRowsFromBrexModel(m.sns);
  assert.deepEqual(rejected, []);
  const key = (r) => `${r.systemCode}|${r.subSystemCode}|${r.subSubSystemCode}|${r.assyCode}=${r.title}`;
  assert.deepEqual(rows.map(key).sort(), [
    '29|||=Hydraulic power', '32|1|0|10=Shock strut', '32|1|0|=Main gear', '32|1||=Main gear and doors', '32|2||=Nose gear and doors', '32|||=Landing gear',
  ].sort());

  const bad = snsRowsFromBrexModel([{ code: '3', title: 'Too short', children: [{ code: '1', title: 'x' }] }, { code: '32', title: 'Good', children: [{ code: '12', title: 'Too long' }] }]);
  assert.equal(bad.rows.length, 1, 'the one valid node survives');
  assert.ok(bad.rejected.length >= 2);
  assert.match(bad.rejected[0].errors.join(' '), /System code/);
});

test('pickTitle: confidence follows how much the titles agree', () => {
  const same = pickTitle(['Shock strut', 'Shock strut', 'Shock strut']);
  assert.equal(same.title, 'Shock strut');
  assert.equal(same.confidence, 0.9);
  assert.equal(pickTitle(['Shock strut']).confidence, 0.7, 'one module is less certain than three');
  const head = pickTitle(['Trailer - Purpose', 'Trailer - Features', 'Trailer - Setup']);
  assert.equal(head.title, 'Trailer');
  assert.ok(head.confidence > 0.5 && head.confidence < 0.9);
  const mess = pickTitle(['Alpha', 'Beta', 'Gamma', 'Delta']);
  assert.ok(mess.confidence <= 0.5, 'unrelated titles are a guess');
  assert.match(mess.basis, /different titles/);
  assert.deepEqual(pickTitle([]), { title: '', confidence: 0, basis: 'The data modules at this node have no title to learn from.', candidates: [] });
  assert.equal(pickTitle(['  Shock   strut ', 'Shock strut']).title, 'Shock strut', 'whitespace does not make titles differ');
});

test('learning proposes rows with confidence and never overwrites what exists', () => {
  const dms = fixtureDms().filter((d) => d.dmCodeAttrs.systemDiffCode === 'A');
  const out = learnSnsFromDms(dms);
  const byKey = Object.fromEntries(out.proposals.map((p) => [p.key, p]));
  assert.ok(out.proposals.length >= 6);
  assert.ok(out.proposals.every((p) => p.status === 'new'));
  const sys = out.proposals.find((p) => p.level === 'system' && p.row.systemCode === '32');
  assert.equal(sys.row.title, 'Landing gear');
  assert.equal(sys.confidence, 0.9, 'three modules at the node, all titled alike');
  assert.ok(sys.sources.length >= 1 && sys.moduleCount >= 3);
  const strut = out.proposals.find((p) => p.level === 'assy');
  assert.equal(strut.row.title, 'Shock strut');
  assert.ok(strut.basis.length > 10);
  assert.ok(Object.keys(byKey).length === out.proposals.length, 'keys are unique');

  // with an SNS that already has the node
  const again = learnSnsFromDms(dms, [
    { systemCode: '32', title: 'Landing gear' },
    { systemCode: '29', title: 'Hydraulics (our own name)' },
  ]);
  const s32 = again.proposals.find((p) => p.level === 'system' && p.row.systemCode === '32');
  const s29 = again.proposals.find((p) => p.level === 'system' && p.row.systemCode === '29');
  assert.equal(s32.status, 'exists');
  assert.equal(s29.status, 'conflict');
  assert.equal(s29.existing.title, 'Hydraulics (our own name)', 'the existing title is reported, untouched');
  assert.equal(again.summary.conflict, 1);
  assert.ok(again.summary.new >= 3);
});

test('dmLikeFromXml reads identity and titles from a data module', () => {
  const f = fs.readdirSync(path.join(FIX, 'dms'))[0];
  const d = dmLikeFromXml(fs.readFileSync(path.join(FIX, 'dms', f), 'utf8'), f);
  assert.equal(d.dmCodeAttrs.modelIdentCode, 'SNSTEST');
  assert.equal(d.language, 'en-US');
  assert.ok(d.techName && d.infoName);
  assert.equal(dmLikeFromXml('<dmodule><nothing/></dmodule>', 'x.xml'), null);
});
