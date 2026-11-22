'use strict';
// The services open the workspace store when first required: point it at a throwaway directory FIRST.
process.env.AGASTYA_WORKSPACE_DIR = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'agastya-objtest-'));
const test = require('node:test');
const assert = require('node:assert/strict');
const O = require('../dist/services/csdbObjects');
const R = require('../dist/services/registry');

const ddn = `<ddn><identAndStatusSection><ddnAddress><ddnIdent><ddnCode modelIdentCode="S1000DBIKE" senderIdent="C0419" receiverIdent="U8025" yearOfDataIssue="2004" seqNumber="00001"/></ddnIdent></ddnAddress></identAndStatusSection></ddn>`;
const dml = `<dml><identAndStatusSection><dmlAddress><dmlIdent><dmlCode modelIdentCode="S1000DBIKE" senderIdent="U8025" dmlType="s" yearOfDataIssue="2004" seqNumber="00001"/><issueInfo issueNumber="000" inWork="01"/></dmlIdent></dmlAddress></identAndStatusSection></dml>`;
const com = `<comment><commentIdent><commentCode modelIdentCode="E2" senderIdent="K0378" yearOfDataIssue="2002" seqNumber="00001" commentType="q"/><language languageIsoCode="en" countryIsoCode="GB"/></commentIdent></comment>`;
const upf = `<dataUpdateFile><updateIdent><updateCode objectIdentCode="UPF" modelIdentCode="S1000DBIKE" systemDiffCode="AAA" systemCode="DA5" subSystemCode="2" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="00" infoCode="251" infoCodeVariant="C" itemLocationCode="A"/><language languageIsoCode="sx" countryIsoCode="US"/><issueInfo issueNumber="001" inWork="01"/></updateIdent></dataUpdateFile>`;
const imf = `<icnMetadataFile><imfIdent><imfCode imfIdentIcn="ICN-K0378-D1B00003-003-02"/><issueInfo issueNumber="002" inWork="00"/></imfIdent></icnMetadataFile>`;

test('file names follow S1000D 4.2 Chap 7.5.1 examples', () => {
  assert.equal(O.expectedFileName('ddn', ddn), 'DDN-S1000DBIKE-C0419-U8025-2004-00001.XML');
  assert.equal(O.expectedFileName('dml', dml), 'DML-S1000DBIKE-U8025-S-2004-00001_000-01.XML');
  assert.equal(O.expectedFileName('comment', com), 'COM-E2-K0378-2002-00001-Q_EN-GB.XML');
  assert.equal(O.expectedFileName('update', upf), 'UPF-S1000DBIKE-AAA-DA5-20-00-0000-251C-A_001-01_SX-US.XML');
  assert.equal(O.expectedFileName('imf', imf), 'IMF-K0378-D1B00003-003-02_002-00.XML');
});
test('fileNameProblem accepts matching names (incl. the 4.2 COM _EN_GB example) and rejects others', () => {
  assert.equal(O.fileNameProblem('DDN-S1000DBIKE-C0419-U8025-2004-00001.XML', ddn), null);
  assert.equal(O.fileNameProblem('COM-E2-K0378-2002-00001-Q_EN_GB.XML', com), null);
  assert.match(O.fileNameProblem('DDN-WRONG.XML', ddn), /does not match/);
  assert.match(O.fileNameProblem('XXX-1.XML', ddn), /prefix/);
});
test('missing identity yields a clear error, not a made-up name', () => {
  assert.throws(() => O.expectedFileName('ddn', '<ddn/>'), /no <ddnCode>/);
});
test('registry: new document types present; 7.0 has no ddn/comment/update/scorm XSD', () => {
  const c = Object.fromEntries(R.coverage().map((r) => [r.schema, r]));
  for (const k of ['ddn', 'comment', 'update', 'scormcontentpackage']) { assert.equal(c[k].xsd['6'], true); assert.equal(c[k].xsd['7'], false); }
  assert.equal(R.dmTypes().length, 21);
  assert.equal(c.dml.xsd['7'], true);
});
