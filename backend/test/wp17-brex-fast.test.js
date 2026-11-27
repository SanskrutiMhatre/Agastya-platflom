'use strict';
// WP-17 (audit PERF-004): the faster BREX check gives the same answers.
//   1. The first-step shortcut: a rule whose location path starts by selecting elements of one name from the root is not evaluated when the
//      document holds no element of that name. On every rule of every bundled default BREX and every fixture module (21 types x 4 issues,
//      the rich fixtures, the sample projects when present), a skipped rule must select nothing when it IS evaluated.
//   2. The per-module result cache: a kept result equals a fresh one; a changed module, a changed project BREX or another issue is not
//      served a kept result.
//   3. The batched well-formedness check (PERF-013) names exactly the malformed files, with the single-file finding text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
const { DM21 } = require('./helpers');
const brex = require('../dist/services/brex');
const { DOMParser } = require('@xmldom/xmldom');

function xmlFiles(dir, depth = 0, out = []) {
  if (!fs.existsSync(dir) || depth > 4) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) xmlFiles(p, depth + 1, out);
    else if (/^DMC-.*\.xml$/i.test(e.name)) out.push(p);
  }
  return out;
}
const corpus = [
  ...xmlFiles(DM21), ...xmlFiles(path.join(__dirname, 'fixtures', 'rich')),
  ...xmlFiles(path.resolve(__dirname, '..', '..', 'SAMPLE PROJECTS', 'S1000D')),
];
const names = (doc) => { const s = new Set(); const w = (n) => { for (let c = n.firstChild; c; c = c.nextSibling) if (c.nodeType === 1) { s.add(c.nodeName); w(c); } }; w(doc); return s; };

test('first-step shortcut: every rule it skips selects nothing when evaluated (all default BREX x the fixture corpus)', { timeout: 600000 }, () => {
  assert.ok(corpus.length >= 80, `corpus of ${corpus.length} modules`);
  const dir = path.join(__dirname, '..', 'brex');
  const models = fs.readdirSync(dir).filter((f) => /^DMC-.*\.xml$/i.test(f)).map((f) => brex.parseBrexModel(fs.readFileSync(path.join(dir, f), 'utf8'), f, false));
  assert.ok(models.length >= 4);
  const rules = [...new Set(models.flatMap((m) => m.rules.map((r) => r.objectPath)).filter((p) => p && !brex.isXPath2(p)).map((p) => brex.repairXPath(p)))];
  let skipped = 0; let checked = 0;
  for (const file of corpus) {
    const doc = new DOMParser({ onError: () => {} }).parseFromString(fs.readFileSync(file, 'utf8'), 'text/xml');
    const present = names(doc);
    for (const expr of rules) {
      const first = brex.firstStepName(expr);
      if (first === null || present.has(first)) continue;
      skipped++;
      let n; try { n = brex.evaluateXPath(expr, doc).length; } catch { n = 0; }
      assert.equal(n, 0, `${path.basename(file)}: the skipped rule ${expr} selects ${n} node(s)`);
    }
    checked++;
  }
  assert.ok(skipped > checked * 50, `the shortcut applies (skipped ${skipped} rule evaluations over ${checked} modules)`);
});

test('first-step shortcut: only the simple shape qualifies', () => {
  const yes = { '//dml[child::x]': 'dml', '/dmodule/content': 'dmodule', '//para/@id': 'para', '//a[b="]|["]/c/text()': 'a', '//dmodule//levelledPara': 'dmodule' };
  const no = ['//*[@changeMark]', '//a | //b', '//a[1] = 3', '//child::a', '//xlink:a', 'count(//a)', '//a/descendant::b', '(//a)[1]', '//text()', '//a]', ' //a or //b'];
  for (const [e, n] of Object.entries(yes)) assert.equal(brex.firstStepName(e), n, e);
  for (const e of no) assert.equal(brex.firstStepName(e), null, e);
});

test('the full module check is unchanged on the corpus: findings, counts and skipped rules equal a check with the shortcut and the cache off', { timeout: 600000 }, () => {
  // reference: evaluate every rule (no shortcut) through checkBrexModels with a document whose element-name set is complete for every name
  for (const file of corpus.filter((_f, i) => i % 3 === 0)) {
    const xml = fs.readFileSync(file, 'utf8');
    brex.clearBrexResults();
    const a = brex.checkModuleBrex(xml);
    const b = brex.checkModuleBrex(xml);                                   // served from the cache
    assert.deepEqual(b.result, a.result, `${path.basename(file)}: kept result equals the fresh one`);
    const chain = brex.resolveBrexChain(xml);
    const ref = referenceCheck(xml, chain.models);
    assert.deepEqual(a.result, ref, `${path.basename(file)}: same result as evaluating every rule`);
  }
});

// The pre-WP-17 rule loop, written out: every rule evaluated (no shortcut), the same finding shapes.
function referenceCheck(xml, models) {
  const real = brex.firstStepName;
  try {
    // with no expression qualifying for the shortcut, checkBrexModels evaluates every rule, as before WP-17
    brex.__setFirstStep?.(() => null);
    if (!brex.__setFirstStep) throw new Error('missing test seam __setFirstStep');
    return brex.checkBrexModels(xml, models);
  } finally { brex.__setFirstStep(real); }
}

test('the result cache misses on a changed module, a changed project BREX and another issue', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-brex-'));
  try {
    const base = fs.readFileSync(xmlFiles(path.join(DM21, '5-0')).find((f) => /040A-D_/.test(f)), 'utf8');
    // a project BREX that forbids <para> and names the 5.0 default as its parent
    const def = fs.readFileSync(path.join(__dirname, '..', 'brex', 'DMC-S1000D-G-04-10-0301-00A-022A-D_001-00_EN-US.XML'), 'utf8');
    const own = (forbid) => def
      .replace(/<dmCode\b[^>]*\/>/, '<dmCode modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/>')
      .replace('<contextRules', `<contextRules><structureObjectRuleGroup><structureObjectRule id="WP17-1"><objectPath allowedObjectFlag="0">//${forbid}</objectPath><objectUse>No ${forbid} here.</objectUse></structureObjectRule></structureObjectRuleGroup></contextRules><contextRules`);   // a rule for every schema
    const bfile = 'DMC-EXAMPLE-A-00-00-00-00A-022A-D_001-00_EN-US.XML';
    fs.writeFileSync(path.join(dir, bfile), own('para'));
    const mod = base.replace(/<brexDmRef>[\s\S]*?<\/brexDmRef>/, '<brexDmRef><dmRef><dmRefIdent><dmCode modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/></dmRefIdent></dmRef></brexDmRef>');
    brex.clearBrexResults();
    const ids = (r) => r.result.findings.map((f) => f.ruleId).filter((id) => id === 'WP17-1').length;
    const r1 = brex.checkModuleBrex(mod, dir, null, brex.newBrexRun());
    assert.ok(ids(r1) > 0, 'the project rule fires on <para>');
    fs.writeFileSync(path.join(dir, bfile), own('zzNothing'));            // the BREX changed: a new pass must not reuse the old result
    const r2 = brex.checkModuleBrex(mod, dir, null, brex.newBrexRun());
    assert.equal(ids(r2), 0, 'the changed BREX is applied');
    const changed = mod.replace('</description>', '<zzNothing/></description>');
    fs.writeFileSync(path.join(dir, bfile), own('zzNothing'));
    const r3 = brex.checkModuleBrex(changed, dir, null, brex.newBrexRun());
    assert.ok(ids(r3) > 0, 'the changed module is checked again');
    const plain = base;                                                    // names the default: forcing another issue changes the chain
    const a = brex.checkModuleBrex(plain, undefined, null);
    const b = brex.checkModuleBrex(plain, undefined, '4.2');
    assert.notEqual(a.result.brexSource, b.result.brexSource, 'another issue, another default BREX');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('batched well-formedness: only the malformed files are reported, with the single-file finding', { timeout: 300000 }, async () => {
  const { validateProjectXml } = require('../vendor/engine/validateXml');
  const paths = require('../vendor/engine/paths');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-wf-'));
  try {
    const good = fs.readFileSync(xmlFiles(path.join(DM21, '5-0')).find((f) => /040A-D_/.test(f)), 'utf8');
    fs.mkdirSync(path.join(dir, 'csdb'));
    const bad = new Set([3, 250, 401]);
    for (let i = 0; i < 420; i++) fs.writeFileSync(path.join(dir, 'csdb', `DMC-W${String(i).padStart(4, '0')}.XML`), bad.has(i) ? good.replace('</dmodule>', '') : good);
    const r = await validateProjectXml(paths.XSLTPROC, dir);
    assert.equal(r.checked, 420);
    assert.deepEqual(r.issues.map((i) => i.rel), [...bad].map((i) => `csdb/DMC-W${String(i).padStart(4, '0')}.XML`));
    for (const i of r.issues) { assert.equal(i.sev, 'crit'); assert.match(i.detail, /\S/); assert.ok(i.line > 1, 'the line of the problem'); }
    // the same finding as a project of that one file
    const one = fs.mkdtempSync(path.join(os.tmpdir(), 'wp17-wf1-'));
    try {
      fs.writeFileSync(path.join(one, 'DMC-W0003.XML'), good.replace('</dmodule>', ''));
      const s = await validateProjectXml(paths.XSLTPROC, one);
      assert.deepEqual({ ...s.issues[0], rel: undefined, loc: undefined }, { ...r.issues[0], rel: undefined, loc: undefined });
    } finally { fs.rmSync(one, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
