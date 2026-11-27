'use strict';
// WP-33 / PERF-003: the FO-stage scaling fix must not change what the direct S1000D engine produces.
//
// Every input below is transformed twice, with the stylesheets as they were before WP-33 (test/fixtures/wp33-old laid over a copy
// of vendor/pipeline) and with the current ones, under the default and the Xignal profile, and the two FO files must agree.
//
// "Agree" means byte-identical after generated ids are renamed in order of first appearance (helpers-fo-compare.js). That is the
// strongest check this toolchain allows: libxslt 1.1.28 makes generate-id() from memory addresses, so two runs of the SAME
// stylesheet on the SAME input already differ in those ids (measured: the unchanged stylesheet run twice on 3 modules gives
// different bytes). A one-to-one renaming keeps every id and every reference to it in the same place, so every link lands where
// it did. The first test proves the comparison is not vacuous: it fails on a real one-character difference.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { tmp, DM21 } = require('./helpers');
const h = require('./helpers-fo-scale');
const { compareFo, canonical } = require('./helpers-fo-compare');

const WORK = tmp('agastya-wp33-eq-');
const OLD = h.oldPipeline(WORK);
const PROFILES = [{ 'frontmatter.style': 's1000d' }, { 'frontmatter.style': 's1000d', 'layout.profile': 'xignal' }];

const dmHead = (code, title) => `<?xml version="1.0" encoding="UTF-8"?>
<dmodule xmlns:xlink="http://www.w3.org/1999/xlink">
  <identAndStatusSection>
    <dmAddress>
      <dmIdent>
        <dmCode modelIdentCode="EDGE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="${code.assy}" disassyCode="${code.dis}" disassyCodeVariant="A" infoCode="${code.info}" infoCodeVariant="A" itemLocationCode="D"/>
        <language languageIsoCode="en" countryIsoCode="US"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </dmIdent>
      <dmAddressItems>
        <issueDate year="2026" month="11" day="27"/>
        <dmTitle><techName>${title}</techName><infoName>Edge case</infoName></dmTitle>
      </dmAddressItems>
    </dmAddress>
    <dmStatus issueType="new">
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="00000"><enterpriseName>Example Company</enterpriseName></responsiblePartnerCompany>
      <originator enterpriseCode="00000"><enterpriseName>Example Company</enterpriseName></originator>
      <applic><displayText><simplePara>All</simplePara></displayText></applic>
      <qualityAssurance><unverified/></qualityAssurance>
    </dmStatus>
  </identAndStatusSection>
  <content>`;
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01';

/** A procedure: shared warning/caution ids referenced through warningRefs/cautionRefs (one and two ids), a footnote and its reference, a figure. */
const procedure = (i) => `${dmHead({ assy: '01', dis: String(i).padStart(2, '0'), info: '520' }, `Procedure ${i}`)}
    <warningsAndCautions>
      <warning id="warn-0001"><warningAndCautionPara>High voltage ${i}.</warningAndCautionPara></warning>
      <warning id="warn-0002"><warningAndCautionPara>Moving parts ${i}.</warningAndCautionPara></warning>
      <caution id="caut-0001"><warningAndCautionPara>Hot surface ${i}.</warningAndCautionPara></caution>
    </warningsAndCautions>
    <procedure>
      <preliminaryRqmts>
        <reqCondGroup><noConds/></reqCondGroup>
        <reqSupportEquips><noSupportEquips/></reqSupportEquips>
        <reqSupplies><noSupplies/></reqSupplies>
        <reqSpares><noSpares/></reqSpares>
        <reqSafety><noSafety/></reqSafety>
      </preliminaryRqmts>
      <mainProcedure>
        <proceduralStep id="stp-0001" warningRefs="warn-0001" cautionRefs="caut-0001"><para>Isolate the unit<footnoteRef internalRefId="ftn-0001"/>.</para></proceduralStep>
        <proceduralStep id="stp-0002" warningRefs="warn-0001 warn-0002"><para>Remove the cover, see <internalRef internalRefId="fig-0001"/> and <internalRef internalRefId="stp-0001"/>.<footnote id="ftn-0001"><para>Use the insulated tool ${i}.</para></footnote></para>
          <figure id="fig-0001"><title>Cover removal</title><graphic infoEntityIdent="${ICN}"/></figure>
        </proceduralStep>
      </mainProcedure>
      <closeRqmts><reqCondGroup><noConds/></reqCondGroup></closeRqmts>
    </procedure>
  </content>
</dmodule>
`;

/** A description: an id repeated on an element INSIDE another with the same id (ancestor case of unique-id), repeated acronym terms. */
const description = (i, figures = true) => `${dmHead({ assy: '02', dis: String(i).padStart(2, '0'), info: '040' }, `Description ${i}`)}
<description>
  <levelledPara id="dup">
    <title>Overview</title>
    <para>The <acronym><acronymTerm>LRU</acronymTerm><acronymDefinition>Line replaceable unit</acronymDefinition></acronym> and the
      <acronym><acronymTerm> LRU </acronymTerm><acronymDefinition>Line replaceable unit (again)</acronymDefinition></acronym> and
      <acronym><acronymTerm>BIT</acronymTerm><acronymDefinition>Built-in test ${i}</acronymDefinition></acronym>.</para>${figures ? `
    <figure id="dup"><title>Nested figure with its parent's id</title><graphic infoEntityIdent="${ICN}"/></figure>
    <para>See <internalRef internalRefId="dup"/> and <internalRef internalRefId="fig-0002"/>.</para>
    <figure id="fig-0002"><title>Second figure</title><graphic infoEntityIdent="${ICN}"/></figure>` : ''}
  </levelledPara>
</description>
  </content>
</dmodule>
`;

/** Write `modules` ([file, xml] pairs; a file listed with null xml is a reprint of an earlier one) as a publication in a new folder. */
function publication(name, modules) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(path.join(dir, 'csdb'), { recursive: true });
  for (const [file, xml] of modules) if (xml) fs.writeFileSync(path.join(dir, 'csdb', file), xml);
  return h.writePm(dir, modules.map(([f]) => f), name);
}

/** A publication of every data module in a fixture folder (and the folder's pictures), as the e2e suite publishes them. */
function fixturePublication(name, srcDir) {
  const dir = path.join(WORK, name);
  fs.mkdirSync(path.join(dir, 'csdb'), { recursive: true });
  const files = fs.readdirSync(srcDir).filter((f) => /^DMC-.*\.xml$/i.test(f)).sort();
  for (const f of files) fs.copyFileSync(path.join(srcDir, f), path.join(dir, 'csdb', f));
  for (const d of [srcDir, path.dirname(srcDir)]) {
    for (const f of fs.readdirSync(d).filter((x) => /^ICN-.*\.(svg|png|jpe?g|gif|tiff?)$/i.test(x))) fs.copyFileSync(path.join(d, f), path.join(dir, 'csdb', f));
  }
  return h.writePm(dir, files, name);
}

async function assertSame(pm, label) {
  for (const params of PROFILES) {
    const tag = params['layout.profile'] || 'default';
    const dir = path.dirname(pm);
    const before = path.join(dir, `before-${tag}.fo`);
    const after = path.join(dir, `after-${tag}.fo`);
    await h.runFo({ input: pm, foOut: before, params, stylesheet: OLD });
    await h.runFo({ input: pm, foOut: after, params });
    const r = compareFo(before, after);
    assert.ok(r.equivalent, `${label} (${tag}): the FO differs from the pre-WP-33 output\n--- before\n${r.firstDiff && r.firstDiff.a}\n--- after\n${r.firstDiff && r.firstDiff.b}`);
    assert.ok(fs.statSync(after).size > 10000, `${label} (${tag}): an FO was produced`);
  }
}

test('the comparison detects a real difference and accepts only a renaming of generated ids', () => {
  const a = '<fo:block id="idm123456789">x</fo:block><fo:basic-link internal-destination="idm123456789"/><b id="fig-000101"/>';
  assert.ok(compareFo(a, a.replace(/idm123456789/g, 'idm99999999')).equivalent, 'a consistent renaming is accepted');
  assert.ok(!compareFo(a, a.replace('fig-000101', 'fig-000102')).equivalent, 'a changed authored id is a difference');
  assert.ok(!compareFo(a, a.replace('internal-destination="idm123456789"', 'internal-destination="idm55555555"')).equivalent, 'a link moved to another generated id is a difference');
  assert.strictEqual(canonical('id12345 idm67890 id12345'), 'GID1 GID2 GID1');
});

test('synthetic publications (ids repeated in every module, a reprinted module) give the same FO as before', { timeout: 600000 }, async () => {
  for (const n of [3, 25]) {
    const dir = path.join(WORK, `syn-${n}`);
    await assertSame(h.writePublication(dir, n, { figs: 2, reprint: true }), `${n} cloned modules`);
  }
});

test('edge cases: warning/caution references, footnotes, an id inside an element with the same id, repeated acronyms, cross-references to repeated ids', { timeout: 600000 }, async () => {
  const mods = [];
  for (let i = 1; i <= 4; i++) {
    mods.push([`DMC-EDGE-A-00-0-0-01-0${i}A-520A-D_001-00_EN-US.XML`, procedure(i)]);
    mods.push([`DMC-EDGE-A-00-0-0-02-0${i}A-040A-D_001-00_EN-US.XML`, description(i)]);
  }
  mods.push([mods[1][0], null]);                         // the first description again: a reprint (dm-occurrence-suffix)
  await assertSame(publication('edge', mods), 'edge cases');
});

test('a publication with no titled figure (the "None" row) and one module with 200 figures give the same FO as before', { timeout: 600000 }, async () => {
  await assertSame(publication('nofig', [['DMC-EDGE-A-00-0-0-02-01A-040A-D_001-00_EN-US.XML', description(1, false)]]), 'no figures');
  const dir = path.join(WORK, 'fig200');
  fs.mkdirSync(path.join(dir, 'csdb'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'csdb', 'DMC-EXAMPLE-A-00-0-0-00-01A-040A-D_001-00_EN-US.XML'), h.dataModule(1, { figs: 200 }));
  await assertSame(h.writePm(dir, ['DMC-EXAMPLE-A-00-0-0-00-01A-040A-D_001-00_EN-US.XML'], 'fig200'), 'one module with 200 figures');
});

test('the repository fixtures (21 data module types in four issues, the rich set) give the same FO as before', { timeout: 900000 }, async () => {
  const sets = [['rich', path.join(__dirname, 'fixtures', 'rich')]];
  for (const issue of ['4-2', '5-0', '6', '7']) sets.push([`dm21-${issue}`, path.join(DM21, issue)]);
  let done = 0;
  for (const [name, src] of sets) {
    if (!fs.existsSync(src)) continue;
    await assertSame(fixturePublication(name, src), name);
    done++;
  }
  assert.ok(done >= 1, 'at least one fixture set was compared');
});
