'use strict';
// The Xignal cover and prelim numbering, at the stylesheet level (no server, no FOP: xsltproc on a hand-written publication).
//
// Under layout.profile "xignal" with the S1000D front-matter style:
//   - the publication's title-page DATA MODULE is page 1 (its own title, code and picture), not a page built from the publication
//     module's metadata, and it is not printed a second time in the body
//   - its contents row reads "Title page" (the publication title is redundant there)
//   - the title page, contents, list of illustrations and list of abbreviations are each numbered from page 1
// With no profile nothing of that applies: the engine's own generated title page, the running numbers, the module printed where the
// publication places it. That is what every existing project gets.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { spawnSync } = require('node:child_process');
const paths = require('../vendor/engine/paths');

const XSL = path.join(__dirname, '..', 'vendor', 'pipeline', 's1000dtofo', 's1000dtofo.xsl');
const SKIP = fs.existsSync(paths.XSLTPROC) ? false : `xsltproc is not installed at ${paths.XSLTPROC}`;

const dm = (code, schema, body, extra = '') => `
<dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/S1000D_4-2/xml_schema_flat/${schema}.xsd">
  <identAndStatusSection>
    <dmAddress>
      <dmIdent>
        <dmCode modelIdentCode="TST" systemDiffCode="A" systemCode="${code.sys}" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="${code.dis}" disassyCodeVariant="A" infoCode="${code.info}" infoCodeVariant="A" itemLocationCode="D"/>
        <language languageIsoCode="en" countryIsoCode="IN"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </dmIdent>
      <dmAddressItems>
        <issueDate year="2026" month="04" day="17"/>
        <dmTitle><techName>${code.tech}</techName><infoName>${code.name}</infoName></dmTitle>
      </dmAddressItems>
    </dmAddress>
    <dmStatus issueType="new">
      <security securityClassification="02"/>
      <responsiblePartnerCompany enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></responsiblePartnerCompany>
      <originator enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></originator>
      <applic><displayText/></applic>
      <qualityAssurance><firstVerification verificationType="tabtop"/></qualityAssurance>
    </dmStatus>
  </identAndStatusSection>
  <content>${body}</content>${extra}
</dmodule>`;

const COVER = dm({ sys: 'A00', dis: '32', info: '001', tech: 'Cover Tech', name: 'Title page' },
  'frontmatter',
  `<frontMatter><frontMatterTitlePage>
      <pmTitle>Cover Title From DM</pmTitle>
      <pmCode modelIdentCode="TST" pmIssuer="1234Y" pmNumber="00001" pmVolume="00"/>
      <issueInfo issueNumber="001" inWork="01"/>
      <issueDate year="2026" month="04" day="17"/>
      <productIllustration><graphic infoEntityIdent="ICN-TST-PIC"/></productIllustration>
      <publisherLogo><symbol infoEntityIdent="ICN-TST-LOGO"/></publisherLogo>
    </frontMatterTitlePage></frontMatter>`);

const BODY = dm({ sys: 'A00', dis: '00', info: '018', tech: 'Purpose', name: 'Introduction' },
  'descript',
  `<description><levelledPara><title>Purpose</title><para>The text of the first chapter.</para></levelledPara></description>`);

const PM = (first) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE pm [
  <!NOTATION png PUBLIC "-//W3C//NOTATION Portable Network Graphics//EN">
  <!ENTITY ICN-TST-PIC SYSTEM "pic.png" NDATA png>
  <!ENTITY ICN-TST-LOGO SYSTEM "logo.png" NDATA png>
]>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <identAndStatusSection>
    <pmAddress>
      <pmIdent>
        <pmCode modelIdentCode="TST" pmIssuer="1234Y" pmNumber="00001" pmVolume="00"/>
        <language languageIsoCode="en" countryIsoCode="IN"/>
        <issueInfo issueNumber="001" inWork="01"/>
      </pmIdent>
      <pmAddressItems>
        <issueDate year="2026" month="08" day="17"/>
        <pmTitle>Publication Title From PM</pmTitle>
      </pmAddressItems>
    </pmAddress>
    <pmStatus>
      <security securityClassification="02"/>
      <responsiblePartnerCompany enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></responsiblePartnerCompany>
    </pmStatus>
  </identAndStatusSection>
  <content>
    <pmEntry><pmEntryTitle>Front matter</pmEntryTitle>${first}</pmEntry>
    <pmEntry><pmEntryTitle>Chapter 1</pmEntryTitle>${BODY}</pmEntry>
  </content>
</pm>`;

function render(pmXml, params) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-cover-'));
  fs.writeFileSync(path.join(dir, 'pm.xml'), pmXml);
  fs.writeFileSync(path.join(dir, '_image-dims.xml'),
    '<imageDims><img name="pic.png" stem="icn-tst-pic" src="pic.png" w="600" h="400"/><img name="logo.png" stem="icn-tst-logo" src="logo.png" w="350" h="100"/></imageDims>');
  const args = [];
  for (const [k, v] of Object.entries(params)) args.push('--stringparam', k, v);
  const r = spawnSync(paths.XSLTPROC, [...args, pathToFileURL(XSL).href, path.join(dir, 'pm.xml')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: dir });
  assert.equal(r.status, 0, `xsltproc failed: ${(r.stderr || '').slice(0, 600)}`);
  return r.stdout;
}

// "<fo:page-sequence " with the space: "<fo:page-sequence-master" must not count
const sequences = (fo) => fo.split('<fo:page-sequence ').slice(1).map((s) => '<fo:page-sequence ' + s.split('</fo:page-sequence>')[0]);
const startsAt = (seq) => (/initial-page-number="([^"]*)"/.exec(seq) || [])[1];
const count = (s, needle) => s.split(needle).length - 1;
// the PDF bookmark tree names modules too; the page text is everything else
const pageText = (fo) => {
  const a = fo.indexOf('<fo:bookmark-tree>'); const z = fo.indexOf('</fo:bookmark-tree>');
  return a < 0 || z < 0 ? fo : fo.slice(0, a) + fo.slice(z + '</fo:bookmark-tree>'.length);
};
// every link, page-number citation and bookmark must point at an id that exists (" id=" is an attribute of its own; "ref-id=" is not one)
function dangling(fo) {
  const ids = new Set([...fo.matchAll(/ id="([^"]+)"/g)].map((m) => m[1]));
  const refs = [...fo.matchAll(/(?:internal-destination|ref-id)="([^"]+)"/g)].map((m) => m[1]);
  return [...new Set(refs.filter((r) => !ids.has(r)))];
}

test('Xignal profile: the title-page module is page 1, printed once, and every prelim section restarts at 1', { skip: SKIP }, () => {
  const fo = render(PM(COVER), { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d' });
  const seqs = sequences(fo);
  assert.ok(seqs.length >= 5, `cover, contents, illustrations, abbreviations and the chapter (${seqs.length})`);

  // page 1 is the module: its own title (24 pt), its own code in the foot, its picture and logo
  assert.match(seqs[0], /Cover Title From DM/);
  assert.match(seqs[0], /font-size="24pt"/);
  assert.match(seqs[0], /TST-A-A00-00-00-32A-001A-D/, 'the data module code is in the cover foot');
  assert.match(seqs[0], /content-width="174\.2mm"/, 'the product picture');
  assert.match(seqs[0], /content-width="30mm"/, 'the publisher logo');
  assert.match(seqs[0], /Issue No\. 001, 2026-08-17/, "the publication's date, not the module's own");
  assert.doesNotMatch(fo, /Publication Title From PM/, 'the page built from the publication module is not printed as well');

  // printed once: no second copy in the body, and no second 24 pt title anywhere
  assert.equal(count(fo, 'Cover Title From DM'), 1);
  assert.equal(count(fo, 'font-size="24pt"'), 1);
  // its contents row reads "Title page"; the techName (the publication title) is not repeated there
  assert.equal(count(pageText(fo), 'Cover Tech'), 0, 'the contents row is "Title page", not "<publication title> – Title page"');
  assert.match(pageText(fo), />Title page</);
  // the contents link, its page number and the bookmark of the cover still find it
  assert.match(seqs[0], /id="content-start-/);
  assert.deepEqual(dangling(fo), [], 'no link, citation or bookmark points at a missing anchor');

  // cover, contents, list of illustrations, list of abbreviations: each numbered from 1
  assert.deepEqual(seqs.slice(0, 4).map(startsAt), ['1', '1', '1', '1']);
});

test('without the profile nothing changes: the generated title page, running numbers, the module where the publication puts it', { skip: SKIP }, () => {
  const fo = render(PM(COVER), { 'frontmatter.style': 's1000d' });
  const seqs = sequences(fo);
  assert.match(seqs[0], /Publication Title From PM/, "the engine's own title page, built from the publication module");
  assert.doesNotMatch(seqs[0], /Cover Title From DM/);
  // (the engine's own title-page template also uses 24 pt, so the cover is told apart by its picture width and the publication title it prints)
  assert.doesNotMatch(fo, /content-width="174\.2mm"/, 'no cover picture geometry without the profile');
  // (the default layout prints a title-page module's own fields - product, publication title, code - on its page, once; that is the engine's, not the profile's)
  assert.equal(count(fo, 'Cover Title From DM'), 1, "the module's own publication title is printed once, on its own page");
  assert.ok(count(pageText(fo), 'Cover Tech') >= 2, 'the module is still printed in the body, and listed in the contents');
  assert.match(pageText(fo), /Cover Tech – Title page/, 'the contents row still reads "<techName> – <infoName>"');
  assert.deepEqual(dangling(fo), []);
  // the generated title page restarts as it always did (it is the first sequence); the prelims after it keep counting
  assert.deepEqual(seqs.slice(1, 4).map(startsAt), ['auto', 'auto', 'auto']);
});

test('Xignal profile with no title-page module first: the generated title page is kept', { skip: SKIP }, () => {
  const fo = render(PM(''), { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d' });
  const seqs = sequences(fo);
  assert.match(seqs[0], /Publication Title From PM/);
  assert.equal(count(fo, 'font-size="24pt"'), 0, 'no cover page geometry without a title-page module');
});

// ---- divider pages ---------------------------------------------------------------------------------------------------------------------
// A data module with an empty <description/> is an annexure heading in the Xignal reference: its title alone, centred, broken into balanced lines.
const annex = (n, tech, name, body = '<description/>') => dm({ sys: 'A00', dis: String(n), info: '001', tech, name }, 'descript', body);
const TITLE_C = "Annexure 'C' - User Handbook for 30kVA DG Search Radar";
const TITLE_G = "Annexure 'G' - Operation and Maintenance Manual for Search Radar Trailer";
const TITLE_I = "Annexure 'I'- 'O'-Level Maintenance Manual for Search Radar(ELM-2138M)";
// the one no single line width reproduces: its lines are 287 / 289 / 354 pt wide in the reference, and a greedy fill at 354 pt would put "book" on line 1
const TITLE_H = "Annexure 'H' - User Hand book of MIL Grade 1.5 TR Vertical Slip-on Air Conditioner";
const withAnnexures = () => PM(COVER).replace(BODY, BODY + annex(38, TITLE_C, '-------------------------') + annex(40, TITLE_G, '-----------------') + annex(42, TITLE_H, '-------------------------------') + annex(59, TITLE_I, '------------------------------------', '<description><para/></description>'));   // an empty paragraph is still empty
// the text of every centred 24 pt title line, in order
const titleLines = (fo) => [...fo.matchAll(/<fo:block font-size="24pt" font-weight="bold" line-height="1\.2" text-align="center"[^>]*>([^<]*)<\/fo:block>/g)].map((m) => m[1]);

test('Xignal profile: an empty module prints its title alone, centred, in the reference\'s balanced lines', { skip: SKIP }, () => {
  const fo = render(withAnnexures(), { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d' });
  // not greedy ("Annexure 'C' - User Handbook for" / "30kVA DG Search Radar"): the fewest lines, then as equal as the words allow
  assert.deepEqual(titleLines(fo), [
    "Annexure 'C' - User Handbook", 'for 30kVA DG Search Radar',
    "Annexure 'G' - Operation", 'and Maintenance Manual', 'for Search Radar Trailer',
    "Annexure 'H' - User Hand", 'book of MIL Grade 1.5 TR', 'Vertical Slip-on Air Conditioner',
    "Annexure 'I'- 'O'-Level Maintenance", 'Manual for Search Radar(ELM-2138M)',
  ]);
  // the first line is 255 pt down the text area; the infoName is 18 pt regular under the last title line
  assert.equal(count(fo, 'padding-top="255.1pt"'), 4);
  assert.equal(count(fo, 'font-size="18pt"'), 4);
  assert.ok(count(fo, '-------------------------') >= 1);
  // none of the engine's own description boilerplate for these modules
  const without = render(PM(COVER), { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d' });
  assert.equal(count(pageText(fo), 'References'), count(pageText(without), 'References'), 'the four empty modules add no "References" / contents boilerplate of their own');
  assert.deepEqual(dangling(fo), []);
});

test('without the profile an empty module keeps the engine\'s own page', { skip: SKIP }, () => {
  const fo = render(withAnnexures(), { 'frontmatter.style': 's1000d' });
  assert.equal(titleLines(fo).length, 0);
  assert.doesNotMatch(fo, /padding-top="255\.1pt"/);
  assert.ok(count(pageText(fo), TITLE_C) >= 1, 'the title is printed by the engine\'s own template');
});

// ---- blank-page legend -------------------------------------------------------------------------------------------------------------------
test('the blank-page legend: the Xignal profile uses its own file, nothing else changes', { skip: SKIP }, () => {
  const svg = { 'blank.page.svg': 'assets/intentionally-blank.svg', 'frontmatter.style': 's1000d' };
  const on = render(PM(COVER), { ...svg, 'layout.profile': 'xignal' });
  const off = render(PM(COVER), svg);
  assert.equal(count(on, "assets/intentionally-blank-xignal.svg"), 3, 'portrait, landscape and A3 blank masters');
  assert.equal(count(off, "assets/intentionally-blank.svg"), 3);
  assert.equal(count(off, 'intentionally-blank-xignal'), 0);
  // the file itself carries the reference's wording and size
  const file = fs.readFileSync(path.join(__dirname, '..', 'vendor', 'pipeline', 's1000dtofo', 'intentionally-blank-xignal.svg'), 'utf8');
  assert.match(file, />Intentionally left blank\.</);
  assert.match(file, /font-size="3\.528"/, '10 pt in millimetre user units');
});

// ---- contents / illustrations / abbreviations ---------------------------------------------------------------------------------------------
test('Xignal profile: the three prelim tables are calibrated to the reference; without it they are the engine\'s own', { skip: SKIP }, () => {
  const on = render(PM(COVER), { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d', 'toc.s1000d.showPage': '0' });
  const off = render(PM(COVER), { 'frontmatter.style': 's1000d', 'toc.s1000d.showPage': '0' });
  const part = (fo, title) => sequences(fo).find((s) => s.includes('>' + title + '<'));

  const toc = part(on, 'Table of contents');
  const loi = part(on, 'List of illustrations');
  const loa = part(on, 'List of abbreviations');
  assert.ok(toc && loi && loa, 'all three prelim sections exist');

  // contents: the reference's four columns, 1 mm cell padding, no row rules, the title pushed down, a (Continued) caption on later pages
  for (const w of ['3383', '3601', '1419', '1597']) assert.ok(toc.includes('proportional-column-width(' + w + ')'), 'column ' + w);
  assert.ok(toc.includes('padding-top="11.3pt"'), 'the title sits 11.3 pt below the top of the body');
  assert.ok(toc.includes('padding="1mm"') && !toc.includes('padding="1.5mm"'), '1 mm cells');
  assert.ok(!toc.includes('border-bottom="0.4pt solid #999999"'), 'no row rules');
  assert.equal(count(toc, '<fo:retrieve-table-marker'), 1, 'one caption slot in the repeated header');
  assert.equal(count(toc, '<fo:marker marker-class-name="xs-fm-cont"'), 2, 'one marker per row (the cover module and the chapter)');
  assert.equal(count(toc, 'Table of contents (Continued)'), 1, 'carried by the second row only: the first page shows no caption');
  assert.ok(toc.includes('<fo:marker marker-class-name="xs-fm-cont"/>'), 'the first row\'s marker is empty');

  // illustrations 45/10/45, abbreviations 30/70, each with its own caption slot
  assert.equal(count(loi, 'proportional-column-width(45)'), 2);
  assert.equal(count(loi, 'proportional-column-width(10)'), 1);
  assert.equal(count(loa, 'proportional-column-width(30)'), 1);
  assert.equal(count(loa, 'proportional-column-width(70)'), 1);
  assert.equal(count(loi, '<fo:retrieve-table-marker'), 1);
  assert.equal(count(loa, '<fo:retrieve-table-marker'), 1);

  // without the profile: none of it
  const offToc = part(off, 'Table of contents');
  assert.ok(offToc.includes('proportional-column-width(31)') && offToc.includes('proportional-column-width(28)'));
  assert.ok(offToc.includes('padding="1.5mm"') && offToc.includes('border-bottom="0.4pt solid #999999"'));
  assert.ok(!off.includes('retrieve-table-marker') && !off.includes('xs-fm-cont') && !off.includes('padding-top="11.3pt"'));
  assert.ok(part(off, 'List of illustrations').includes('proportional-column-width(38)'));
});

// ---- requirements tables and the procedure headings --------------------------------------------------------------------------------------
test('requirements tables follow refs.table.style; the Xignal profile labels the main procedure "Procedure" and drops the outer heading', { skip: SKIP }, () => {
  const PROC = dm({ sys: 'A05', dis: '04', info: '913', tech: 'Maintenance Tasks', name: 'General maintenance procedure' }, 'proced',
    `<procedure><preliminaryRqmts><reqCondGroup><noConds/></reqCondGroup><reqSupportEquips><noSupportEquips/></reqSupportEquips><reqSupplies><noSupplies/></reqSupplies><reqSpares><noSpares/></reqSpares><reqSafety><noSafety/></reqSafety></preliminaryRqmts><mainProcedure><proceduralStep><para>Do the task.</para></proceduralStep></mainProcedure></procedure>`);
  const pm = PM(COVER).replace(BODY, BODY + PROC);
  const on = render(pm, { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d', 'refs.table.style': 'rules' });
  const off = render(pm, { 'frontmatter.style': 's1000d' });

  // rules style: the reference's columns, no vertical rules, horizontal rules only, the "None" under Safety conditions indented to the text edge
  assert.equal(count(on, 'proportional-column-width(32)'), 3, 'support equipment, consumables and spares');
  assert.equal(count(on, 'proportional-column-width(36)'), 3);
  assert.ok(on.includes('border-left="0pt solid black"') && on.includes('border-bottom="0.71pt solid black"'));
  assert.ok(on.includes('start-indent="56.7pt"'), 'None under Safety conditions');
  // boxed (the engine's own): every cell ruled all round, the old 2:2:1:2 columns
  assert.equal(count(off, 'proportional-column-width(32)'), 0);
  assert.ok(off.includes('border-left="0.6pt solid black"') && !off.includes('border-bottom="0.71pt solid black"'));
  assert.ok(!off.includes('start-indent="56.7pt"'));

  // headings: the reference has no "Procedure" over the whole procedure and calls the main procedure "Procedure"
  assert.equal(count(on, '>Main procedure<'), 0);
  assert.ok(count(off, '>Main procedure<') >= 1);
  assert.equal(count(on, '>Procedure<'), count(off, '>Procedure<'), 'one "Procedure" heading either way: the outer one without the profile, the main one with it');
});
