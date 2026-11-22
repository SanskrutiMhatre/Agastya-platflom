'use strict';
// A pmEntry that lists several data modules keeps ALL of them through read -> save (vendor/engine/pmc.js, Phase 17 change).
const test = require('node:test');
const assert = require('node:assert/strict');
const pmc = require('../vendor/engine/pmc');
const crypto = require('crypto'); const fs = require('fs'); const path = require('path');

const ref = (n) => `<dmRef><dmRefIdent><dmCode modelIdentCode="M" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="${n}"/></dmRefIdent></dmRef>`;
const pm = (body) => `<?xml version="1.0"?><pm><identAndStatusSection><pmAddress><pmIdent><pmCode modelIdentCode="M" pmIssuer="00000" pmNumber="00001" pmVolume="00"/><language languageIsoCode="en" countryIsoCode="GB"/><issueInfo issueNumber="001" inWork="00"/></pmIdent><pmAddressItems><issueDate year="2025" month="01" day="01"/><pmTitle>T</pmTitle><shortPmTitle>S</shortPmTitle></pmAddressItems></pmAddress><pmStatus><security securityClassification="01"/></pmStatus></identAndStatusSection><content>${body}</content></pm>`;

test('several dmRef in one pmEntry survive a round trip, in order', () => {
  const xml = pm(`<pmEntry><pmEntryTitle>Ch</pmEntryTitle>${ref('A')}${ref('B')}${ref('D')}</pmEntry>`);
  const model = pmc.parsePm(xml);
  const out = pmc.serialisePm(model);
  const letters = [...out.matchAll(/itemLocationCode="(\w)"/g)].map((m) => m[1]);
  assert.deepEqual(letters, ['A', 'B', 'D']);
  assert.equal(pmc.parsePm(out).entries.length, 1);
  assert.deepEqual([...pmc.serialisePm(pmc.parsePm(out)).matchAll(/itemLocationCode="(\w)"/g)].map((m) => m[1]), ['A', 'B', 'D'], 'stable on a second round trip');
});
test('single dmRef entries and folders are unchanged', () => {
  const xml = pm(`<pmEntry><pmEntryTitle>F</pmEntryTitle><pmEntry>${ref('A')}</pmEntry><pmEntry>${ref('B')}</pmEntry></pmEntry>`);
  const out = pmc.serialisePm(pmc.parsePm(xml));
  assert.deepEqual([...out.matchAll(/itemLocationCode="(\w)"/g)].map((m) => m[1]), ['A', 'B']);
});
test('licensing code is untouched (hash recorded when the change was made)', () => {
  const sha = crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', 'vendor', 'engine', 'license.js'))).digest('hex');
  assert.equal(sha, '52728f639bee282d058885880498432fdf5c00baee0eecb7b1cebd8ec3ae283a');
});
