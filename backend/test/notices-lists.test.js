'use strict';
// Three behaviours the Xignal reference shows, at the stylesheet level (no server, no FOP: xsltproc on a hand-written publication):
//   - the 'band' notice style: a striped band with a white box inset in it, text bold and NOT in capitals, ragged right with the last line centred
//   - acronyms printed "Definition (TERM)" under the Xignal profile, and the engine's own "TERM (Definition)" without it
//   - a note written inside a list item is printed (it used to be dropped), at the list item's text edge
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

const BODY = `<description><levelledPara><title>Safety</title>
  <warning><warningAndCautionPara>When operating a electrical equipment, some parts always carry dangerous voltages.</warningAndCautionPara></warning>
  <caution><warningAndCautionPara>Mixing of grades is not recommended.</warningAndCautionPara></caution>
  <para>The <acronym><acronymTerm>SR</acronymTerm><acronymDefinition>Search Radar</acronymDefinition></acronym> is retracted.</para>
  <para>Steps:<randomList listItemPrefix="pf07">
    <listItem><para>Rotate the handwheel to close the roof.</para>
      <note><notePara>In case the system needs to be relocated, retract the outrigger.</notePara></note></listItem>
    <listItem><para>Switch OFF the cooling fan.</para></listItem>
  </randomList></para>
  <table frame="all"><title>Checks</title><tgroup cols="2"><colspec colname="c1" colwidth="1*"/><colspec colname="c2" colwidth="3*"/>
    <thead><row><entry>No</entry><entry>Check</entry></row></thead>
    <tbody><row><entry>1</entry><entry>Voltage is present.</entry></row><row><entry>2</entry><entry>Door is closed.</entry></row></tbody></tgroup></table>
  </levelledPara></description>`;

const PM = `<?xml version="1.0" encoding="UTF-8"?>
<pm xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><identAndStatusSection><pmAddress><pmIdent>
 <pmCode modelIdentCode="TST" pmIssuer="1234Y" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="01"/></pmIdent>
 <pmAddressItems><issueDate year="2026" month="08" day="17"/><pmTitle>Pub</pmTitle></pmAddressItems></pmAddress>
 <pmStatus><security securityClassification="01"/><responsiblePartnerCompany enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></responsiblePartnerCompany></pmStatus></identAndStatusSection>
 <content><pmEntry><pmEntryTitle>Chapter 1</pmEntryTitle>
 <dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <identAndStatusSection><dmAddress>
    <dmIdent><dmCode modelIdentCode="TST" systemDiffCode="A" systemCode="A00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="10" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="D"/>
      <language languageIsoCode="en" countryIsoCode="IN"/><issueInfo issueNumber="001" inWork="00"/></dmIdent>
    <dmAddressItems><issueDate year="2026" month="04" day="17"/><dmTitle><techName>Safety</techName><infoName>Description</infoName></dmTitle></dmAddressItems>
  </dmAddress>
  <dmStatus issueType="new"><security securityClassification="01"/>
    <responsiblePartnerCompany enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></responsiblePartnerCompany>
    <originator enterpriseCode="1234Y"><enterpriseName>Acme</enterpriseName></originator>
    <applic><displayText/></applic><qualityAssurance><firstVerification verificationType="tabtop"/></qualityAssurance></dmStatus>
  </identAndStatusSection>
  <content>${BODY}</content></dmodule></pmEntry></content></pm>`;

function render(params) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-notice-'));
  fs.writeFileSync(path.join(dir, 'pm.xml'), PM);
  fs.writeFileSync(path.join(dir, '_image-dims.xml'), '<imageDims/>');
  const args = [];
  for (const [k, v] of Object.entries(params)) args.push('--stringparam', k, v);
  const r = spawnSync(paths.XSLTPROC, [...args, pathToFileURL(XSL).href, path.join(dir, 'pm.xml')], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: dir });
  fs.rmSync(dir, { recursive: true, force: true });
  assert.equal(r.status, 0, `xsltproc failed: ${(r.stderr || '').slice(0, 600)}`);
  return r.stdout;
}
const flat = (fo) => fo.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
const XIGNAL = { 'layout.profile': 'xignal', 'frontmatter.style': 's1000d', 'notice.style': 'band', 'notice.text.caps': '0', 'note.style': 'label', 'note.text.indent': '22.6pt',
  'notice.band.warning.image': 'file:///assets/hazard-band-warning.svg', 'notice.band.caution.image': 'file:///assets/hazard-band-caution.svg', 'inner-type-limit': '56.7pt' };

test('band notices: striped band, inset white box, bold sentence-case text, ragged right with a centred last line', { skip: SKIP }, () => {
  const fo = render(XIGNAL);
  // one band per notice, each painted with its own tile image
  assert.equal(fo.split('hazard-band-warning.svg').length - 1, 1, 'the warning band uses the red/white tile');
  assert.equal(fo.split('hazard-band-caution.svg').length - 1, 1, 'the caution band uses the yellow/black tile');
  assert.match(fo, /background-repeat="repeat"/);
  // measured on the reference: band outline 0.7 pt, stripe margin 14.17, box border 1.4 and padding 11.34
  assert.match(fo, /border="0\.7pt solid #BFBFBF" padding="14\.17pt"/);
  assert.match(fo, /border="1\.4pt solid black" padding="11\.34pt"/);
  // FOP hangs border and padding outside the indent, so the band is indented by what hangs outside it: 0.7 + 14.17, and the box by 1.4 + 11.34 more
  assert.match(fo, /start-indent="56\.7pt \+ 14\.87pt" end-indent="14\.87pt"/);
  assert.match(fo, /start-indent="56\.7pt \+ 27\.61pt" end-indent="27\.61pt"/);
  // the text: bold, as written (not folded to capitals), ragged right, last line centred
  assert.doesNotMatch(fo, /text-transform="uppercase"/);
  assert.match(fo, /text-align="start" text-align-last="center"/);
  assert.match(flat(fo), /WARNING When operating a electrical equipment/);
  assert.match(flat(fo), /CAUTION Mixing of grades is not recommended\./);
});

test('without the band style the existing notice styles are unchanged', { skip: SKIP }, () => {
  const fo = render({ 'layout.profile': '', 'notice.style': 'hazard', 'notice.hazard.warning.image': 'file:///assets/w.svg', 'notice.hazard.caution.image': 'file:///assets/c.svg' });
  assert.doesNotMatch(fo, /hazard-band/);
  assert.match(fo, /border="0\.75pt solid #999999"/, 'the hazard frame is still the nested-border table');
  assert.match(fo, /text-transform="uppercase"/, 'and its text is still capitals by default');
});

test('acronyms: the Xignal profile prints Definition (TERM); without it the engine prints TERM (Definition)', { skip: SKIP }, () => {
  assert.match(flat(render(XIGNAL)), /The Search Radar \(SR\) is retracted/);
  assert.match(flat(render({ 'layout.profile': '' })), /The SR \(Search Radar\) is retracted/);
});

test('a note written inside a list item is printed, at the list item text edge', { skip: SKIP }, () => {
  for (const params of [XIGNAL, { 'layout.profile': '' }]) {
    const fo = render(params);
    assert.match(flat(fo), /In case the system needs to be relocated, retract the outrigger\./, 'the note text is in the book');
    assert.match(flat(fo), /Switch OFF the cooling fan\./, 'and the item after it is still there');
  }
  const fo = render(XIGNAL);
  assert.match(flat(fo), /Note 1 In case the system/, 'the label note is numbered');
  assert.match(fo, /start-indent="inherited-property-value\(start-indent\) \+ 22\.6pt"/, 'its text is indented from the list item, not from the page');
});

test('the 20mm reserved under a data module belongs to the engine profiles only; the Xignal profile has none', { skip: SKIP }, () => {
  // FOP must fit a module's last paragraph WITH that padding below it, so it carried a two-line final paragraph to a new page with room to spare.
  assert.doesNotMatch(render(XIGNAL), /padding-bottom="20mm"/);
  assert.match(render(XIGNAL), /padding-bottom="0mm"/);
  assert.match(render({ 'layout.profile': '' }), /padding-bottom="20mm"/);
});

test('Xignal tables never split a row across pages: the row keep is given as within-page too (FOP ignores within-column on a row)', { skip: SKIP }, () => {
  const rows = (fo) => fo.match(/<fo:table-row[^>]*keep-together\.within-column[^>]*>/g) || [];
  const x = rows(render(XIGNAL));
  assert.ok(x.length >= 2, 'the data rows are there');
  assert.ok(x.every((r) => /keep-together\.within-page="always"/.test(r)), 'every data row of the Xignal book is kept whole');
  const e = rows(render({ 'layout.profile': '' }));
  assert.ok(e.length >= 2);
  assert.ok(e.every((r) => !/keep-together\.within-page/.test(r)), 'the engine profiles are unchanged');
});
