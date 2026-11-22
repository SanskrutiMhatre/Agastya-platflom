'use strict';
// The BREX engine on its own: value forms, schema contexts, severity, rule validity, SNS and notation rules, XPath case sensitivity, and which BREX
// applies (project's own, bundled default of the issue, chain of parents, unknown custom code).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const brex = require('../dist/services/brex');

const dmc = (letter = 'X', info = '022', extra = '') => `<dmCode modelIdentCode="PROJ" systemDiffCode="${letter}" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="${info}" infoCodeVariant="A" itemLocationCode="D"${extra}/>`;
const DEFAULT5 = `<dmCode modelIdentCode="S1000D" systemDiffCode="G" systemCode="04" subSystemCode="1" subSubSystemCode="0" assyCode="0301" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="A" itemLocationCode="D"/>`;
const rule = (id, p, flag, use, values = '', attrs = '') => `<structureObjectRule${attrs}><brDecisionRef brDecisionIdentNumber="${id}"/><objectPath allowedObjectFlag="${flag}">${p}</objectPath><objectUse>${use}</objectUse>${values}</structureObjectRule>`;
const val = (form, allowed, label = '') => `<objectValue valueForm="${form}" valueAllowed="${allowed}">${label}</objectValue>`;
const brexXml = ({ letter = 'X', parent = DEFAULT5, rules = '', ctx = '', sns = '', notations = '' } = {}) => `<?xml version="1.0"?>
<dmodule><identAndStatusSection><dmAddress><dmIdent>${dmc(letter)}</dmIdent></dmAddress><dmStatus><brexDmRef><dmRef><dmRefIdent>${parent}</dmRefIdent></dmRef></brexDmRef></dmStatus></identAndStatusSection>
<content><brex><contextRules${ctx}><structureObjectRuleGroup>${rules}</structureObjectRuleGroup></contextRules>${sns}${notations}</brex></content></dmodule>`;
const model = (xml, label = 'P', own = true) => brex.parseBrexModel(xml, label, own);
const doc = (body, { schema = 'descript', issue = '5-0', brexCode = '', doctype = '' } = {}) => `<?xml version="1.0"?>${doctype}
<dmodule xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_${issue}/xml_schema_flat/${schema}.xsd" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<identAndStatusSection><dmAddress><dmIdent><dmCode modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="D"/></dmIdent></dmAddress>
<dmStatus>${brexCode ? `<brexDmRef><dmRef><dmRefIdent>${brexCode}</dmRefIdent></dmRef></brexDmRef>` : ''}</dmStatus></identAndStatusSection><content>${body}</content></dmodule>`;
const run = (rules, body, opts) => brex.checkBrexModels(doc(body, opts), [model(brexXml({ rules }))]);
const ids = (r) => r.findings.map((f) => f.ruleId);

test('flag 0: every node the path selects is a breach, the rule\'s own words are the message', () => {
  const r = run(rule('R1', '//badTag', '0', 'badTag must not be used (Chap 3.9)'), '<badTag/><para/><badTag/>');
  assert.deepEqual(ids(r), ['R1', 'R1']);
  assert.equal(r.findings[0].message, 'badTag must not be used (Chap 3.9)');
  assert.equal(r.valid, false);
  assert.equal(run(rule('R1', '//badTag', '0', 'x'), '<para/>').valid, true);
});

test('value form single: one value, or several separated by |; anything else is a breach', () => {
  const r = (v) => run(rule('R2', '//@kind', '2', 'kind restricted', val('single', 'a|b|c')), `<para kind="${v}"/>`);
  for (const ok of ['a', 'b', 'c']) assert.equal(r(ok).findings.length, 0, ok);
  const bad = r('d');
  assert.equal(bad.findings.length, 1);
  assert.match(bad.findings[0].message, /"d" is not one of the permitted values: a|b|c/);
  assert.deepEqual(bad.findings[0].allowed, ['a|b|c']);
});

test('value form range: integer, code-like and decimal bounds', () => {
  const rng = (allowed, value) => brex.valueMatches(value, { form: 'range', allowed, label: '' });
  assert.ok(rng('1~12', '5') && rng('1~12', '1') && rng('1~12', '12'));
  assert.ok(!rng('1~12', '13') && !rng('1~12', '0'));
  assert.ok(rng('A01~A09', 'A05') && !rng('A01~A09', 'A10') && !rng('A01~A09', 'B05'));
  assert.ok(rng('001~999', '042') && !rng('001~999', '1000'));
  assert.ok(rng('0.5~2.5', '1.25') && !rng('0.5~2.5', '2.6') && !rng('0.5~2.5', 'x'));
  assert.ok(rng('7', '7'), 'a range without ~ is a single value');
  const r = (v) => run(rule('R3', '//@level', '2', 'level 1-3', val('range', '1~3')), `<para level="${v}"/>`);
  assert.equal(r('2').findings.length, 0);
  assert.equal(r('9').findings.length, 1);
});

test('value form pattern: an XML Schema regular expression, anchored (the ICN rule of the official BREX)', () => {
  const ICN = '((ICN-[A-Z0-9]{5}-[A-Z0-9]{5,10}-[0-9]{3}-[0-9]{2})|(ICN-[A-Z0-9]{2,14}-[A-Z0-9]{1,4}-[A-Z0-9]{6,9}-[A-Z0-9]{1}-[A-Z0-9]{5}-[A-Z0-9]{5}-[A-Z]{1}-[0-9]{2,3}-[0-9]{1,2}))';
  const r = (v) => run(rule('R4', '//@infoEntityIdent', '2', 'ICN', val('pattern', ICN)), `<graphic infoEntityIdent="${v}"/>`);
  assert.equal(r('ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01').findings.length, 0, 'the sample ICN matches the MIC-based pattern (it was reported as a breach when patterns were compared as literal text)');
  assert.equal(r('ICN-12345-ABCDEF-001-01').findings.length, 0, 'CAGE-based ICN');
  assert.equal(r('ICN-BAD').findings.length, 1);
  assert.equal(r('xICN-12345-ABCDEF-001-01').findings.length, 0 + 1, 'the pattern is anchored');
});

test('a value pattern that cannot be translated is reported as not enforced, never as a pass or a breach', () => {
  const r = run(rule('R5', '//@x', '2', 'subtraction', val('pattern', '[a-z-[aeiou]]')), '<para x="e"/>');
  assert.equal(r.findings.length, 0);
  assert.equal(r.rulesSkipped, 1);
  assert.match(r.skippedRules[0].reason, /cannot be evaluated/);
});

test('rule groups apply only to the schema they name (rulesContext)', () => {
  const rules = rule('R6', '//marker', '0', 'no marker in procedures');
  const m = model(brexXml({ rules, ctx: ' rulesContext="http://www.s1000d.org/S1000D_5-0/xml_schema_flat/proced.xsd"' }));
  assert.equal(brex.checkBrexModels(doc('<marker/>', { schema: 'proced' }), [m]).findings.length, 1);
  assert.equal(brex.checkBrexModels(doc('<marker/>', { schema: 'descript' }), [m]).findings.length, 0, 'a procedural rule does not apply to a descriptive module');
});

test('severity: brsl01 is an error and blocks, brsl02 and above are warnings and do not', () => {
  const rules = rule('E', '//a', '0', 'error rule') + rule('W', '//b', '0', 'warning rule', '', ' brSeverityLevel="brsl02"') + rule('E1', '//c', '0', 'level one', '', ' brSeverityLevel="brsl01"');
  const r = run(rules, '<a/><b/><c/>');
  assert.deepEqual(r.findings.map((f) => [f.ruleId, f.severity]), [['E', 'error'], ['W', 'warning'], ['E1', 'error']]);
  assert.equal(run(rule('W', '//b', '0', 'w', '', ' brSeverityLevel="brsl05"'), '<b/>').valid, true, 'only warnings: still valid');
});

test('XPath is case-sensitive (the legacy xpath entry points matched names case-insensitively)', () => {
  assert.equal(brex.matchCount('<a inWork="00"/>', '//a[@inwork="00"]'), 0);
  assert.equal(brex.matchCount('<a inWork="00"/>', '//a[@inWork="00"]'), 1);
  assert.equal(brex.matchCount('<Bar/>', '//bar'), 0);
  assert.equal(run(rule('R7', '//bar', '0', 'x'), '<Bar/>').valid, true);
});

test('XPath 2.0 rules are reported as not enforced; flag 1 and prose-only value restrictions are not enforced either, and are counted', () => {
  const rules = rule('X2', "//a[matches(@id,'x')]", '0', 'xpath 2') + rule('ADV', '//@p', '2', 'prose only') + rule('F1', '//zzz', '1', 'allowed');
  const r = run(rules, '<a id="x"/><para p="q"/>');
  assert.deepEqual(r.skippedRules.map((s) => s.id), ['X2']);
  assert.equal(r.rulesAdvisory, 1);
  assert.equal(r.findings.length, 0);
});

test('SNS rules: the module\'s system, sub-system, sub-sub-system and assembly codes must exist in the BREX', () => {
  const sns = '<snsRules><snsDescr><snsSystem><snsCode>00</snsCode><snsTitle>General</snsTitle><snsSubSystem><snsCode>0</snsCode><snsTitle>g</snsTitle></snsSubSystem></snsSystem></snsDescr></snsRules>';
  const m = model(brexXml({ sns }));
  assert.equal(brex.checkBrexModels(doc('<para/>'), [m]).findings.length, 0, 'system 00, subsystem 0 exists');
  const other = doc('<para/>').replace('systemCode="00"', 'systemCode="99"');
  const r = brex.checkBrexModels(other, [m]);
  assert.deepEqual(ids(r), ['SNS']);
  assert.match(r.findings[0].message, /system code "99"/);
});

test('notation rules: a forbidden NOTATION may not be declared by the module\'s entities', () => {
  const notations = '<notationRuleList><notationRule><notationName allowedNotationFlag="0">cgm</notationName><objectUse>CGM is not used on this project.</objectUse></notationRule></notationRuleList>';
  const m = model(brexXml({ notations }));
  const withCgm = doc('<para/>', { doctype: '<!DOCTYPE dmodule [<!NOTATION cgm SYSTEM "cgm"><!ENTITY ICN-X SYSTEM "x.cgm" NDATA cgm>]>' });
  assert.deepEqual(ids(brex.checkBrexModels(withCgm, [m])), ['NOTATION']);
  assert.equal(brex.checkBrexModels(doc('<para/>'), [m]).findings.length, 0);
});

test('lintBrex: an invalid XPath or a rule with no path is an ERROR in the project\'s BREX; XPath 2.0 and unenforceable rules are warnings', () => {
  const m = model(brexXml({ rules: rule('BAD', '//[', '0', 'broken') + rule('NOPATH', '', '0', 'x') + rule('X2', "//a[matches(.,'x')]", '0', 'x2') + rule('PROSE', '//@p', '2', 'prose') + rule('OK', '//ok', '0', 'fine') + rule('PAT', '//@q', '2', 'p', val('pattern', '[a-z-[aeiou]]')) }));
  const out = brex.lintBrex(m).map((p) => `${p.severity}:${p.ruleId}`);
  assert.ok(out.includes('error:BAD'));
  assert.ok(out.includes('error:rule-2') || out.some((x) => x.startsWith('error:') && x !== 'error:BAD'), 'the rule without a path is an error');
  assert.ok(out.includes('warning:X2') && out.includes('warning:PROSE') && out.includes('warning:PAT'));
  assert.ok(!out.some((x) => x.endsWith(':OK')));
});

test('the bundled official default BREX of every issue parses, has the expected rules, and is clean to lint-free evaluation', () => {
  const expected = { F: 260, G: 264, H: 269, J: 274 };
  for (const [letter, n] of Object.entries(expected)) {
    const file = path.join(__dirname, '..', 'brex', `DMC-S1000D-${letter}-04-10-0301-00A-022A-D_001-00_EN-US.XML`);
    const m = brex.parseBrexModel(fs.readFileSync(file, 'utf8'), letter, false);
    assert.equal(m.rules.length, n, `${letter}: rule count`);
    assert.ok(m.rules.filter((r) => r.values.some((v) => v.form === 'pattern')).length >= 5, `${letter}: has pattern rules`);
    assert.ok(m.rules.filter((r) => r.values.some((v) => v.form === 'range')).length >= 10, `${letter}: has range rules`);
  }
});

function csdbWith(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brexcsdb-'));
  for (const [name, xml] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), xml);
  return dir;
}

test('which BREX applies: the project\'s own, else the bundled default of the module\'s issue, else a problem', () => {
  // no brexDmRef: the default of the issue, with a note
  for (const [issue, letter] of [['4-2', 'F'], ['5-0', 'G'], ['6', 'H'], ['7', 'J']]) {
    const r = brex.resolveBrexChain(doc('<para/>', { issue }), undefined);
    assert.equal(r.models.length, 1);
    assert.equal(r.models[0].projectOwn, false);
    assert.match(r.models[0].label, new RegExp(`issue ${issue.replace('-', '.')}`), `${issue}: default of ${letter}`);
    assert.match(r.notes[0], /names no BREX/);
  }
  // naming the official default by its code
  const named = brex.resolveBrexChain(doc('<para/>', { issue: '5-0', brexCode: DEFAULT5 }), undefined);
  assert.equal(named.models.length, 1);
  assert.equal(named.problems.length, 0);
  // a custom BREX that is not in the project is a PROBLEM, not a silent fallback
  const missing = brex.resolveBrexChain(doc('<para/>', { brexCode: dmc('Q') }), csdbWith({}));
  assert.equal(missing.models.length, 0);
  assert.equal(missing.problems[0].kind, 'missing-brex');
  assert.equal(missing.problems[0].severity, 'error');
});

test('layering: the project\'s BREX applies, then the BREX it references (here the official default); a loop is reported', () => {
  const proj = brexXml({ letter: 'X', parent: DEFAULT5, rules: rule('P1', '//privateTag', '0', 'private rule') });
  const dir = csdbWith({ 'DMC-PROJ-X-00-00-00-00A-022A-D_001-00_EN-US.XML': proj });
  const chain = brex.resolveBrexChain(doc('<para/>', { brexCode: dmc('X') }), dir);
  assert.deepEqual(chain.models.map((m) => m.projectOwn), [true, false], 'project BREX first, then the default it references');
  const rep = brex.checkModuleBrex(doc('<privateTag/>', { brexCode: dmc('X') }), dir);
  assert.deepEqual(rep.result.findings.map((f) => f.ruleId), ['P1']);
  // the default rules still apply through the chain
  const sb = brex.checkModuleBrex(doc('<sb><sbSummary><sbTopic sbTopicType="sbtt01"/></sbSummary></sb>', { schema: 'sb', brexCode: dmc('X') }), dir);
  assert.ok(sb.result.findings.some((f) => f.ruleId === 'BREX-S1-00096'), 'a rule of the PARENT BREX is enforced');
  // two BREX that reference each other
  const a = brexXml({ letter: 'A', parent: dmc('B') });
  const b = brexXml({ letter: 'B', parent: dmc('A') });
  const loop = brex.resolveBrexChain(doc('<para/>', { brexCode: dmc('A') }), csdbWith({ 'DMC-PROJ-A-00-00-00-00A-022A-D_001-00_EN-US.XML': a, 'DMC-PROJ-B-00-00-00-00A-022A-D_001-00_EN-US.XML': b }));
  assert.ok(loop.problems.some((p) => p.kind === 'cycle'));
});

test('checkModuleBrex surfaces invalid rules of the project\'s own BREX as errors (and the official default as none)', () => {
  const proj = brexXml({ letter: 'X', rules: rule('BAD', '//[', '0', 'broken') });
  const dir = csdbWith({ 'DMC-PROJ-X-00-00-00-00A-022A-D_001-00_EN-US.XML': proj });
  const rep = brex.checkModuleBrex(doc('<para/>', { brexCode: dmc('X') }), dir);
  assert.ok(rep.problems.some((p) => p.severity === 'error' && p.kind === 'invalid-rule' && p.ruleId === 'BAD'));
  const clean = brex.checkModuleBrex(doc('<para/>', { issue: '5-0' }), undefined);
  assert.equal(clean.problems.filter((p) => p.severity === 'error').length, 0);
});
