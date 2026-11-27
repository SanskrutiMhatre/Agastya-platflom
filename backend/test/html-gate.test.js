'use strict';
// The static HTML publication stands behind the SAME gate as the PDF, with the same ways past it:
//   - a module that names a BREX the project does not have blocks an HTML build, exactly as it blocks a PDF build
//   - "build anyway" (allowRuleBreaks) is for broken business rules ONLY: it never lets a missing BREX through
//   - a recorded waiver lets the DRAFT HTML build through, and the front page of the build says so (nobody mistakes it for a clean one)
//   - a build that needed no exception carries no such notice
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = path.join(DM21, '5-0');
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const NAMED = 'modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="Z" itemLocationCode="D"';
const useBrex = (xml, codeAttrs) => xml.replace(/(<brexDmRef>[\s\S]*?<dmCode )[^>]*?(\/>[\s\S]*?<\/brexDmRef>)/, `$1${codeAttrs}$2`);
const blocked = (r) => r.status === 422 && r.json.code === 'VALIDATION_FAILED';

let h; let admin; let author; let id;
const P = (s) => `/api/projects/${id}${s}`;

test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  author = new h.Client('wanda');
  await author.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword });
  await author.post('/api/auth/onboarding', { username: 'wanda', password: PW });
  id = (await author.post('/api/projects', { name: 'Html gate', pipeline: 's1000dtofo' })).json.project.id;

  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(FIX, '..', ICN))]), ICN);
  fd.append('dir', 'csdb');
  assert.equal((await author.req('POST', P('/media'), fd)).status, 200);
  const file = JSON.parse(fs.readFileSync(path.join(FIX, 'manifest.json'), 'utf8')).descript;
  assert.equal((await author.post(P('/dms'), { file, xml: useBrex(fs.readFileSync(path.join(FIX, file), 'utf8'), NAMED) })).status, 201);
  const pmc = (await author.get(P('/pmc'))).json;
  const list = (await author.get(P('/dms'))).json.dms.filter((d) => d.file === file);
  const entries = [{ type: 'folder', title: 'All', children: list.map((d) => ({ type: 'dm', dmCode: d.dmCodeAttrs, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName })) }];
  assert.equal((await author.put(P('/pmc'), { meta: pmc.meta, entries, baseHash: (await author.get(P('/pmc'))).json.hash })).status, 200);
});
test.after(async () => { await h.close(); });

test('a missing BREX blocks the HTML build; build-anyway does not get past it; a recorded waiver does, and the page says so', { timeout: 600000 }, async () => {
  const first = await author.post(P('/publish/html'), {});
  assert.ok(blocked(first), `strict by default: ${JSON.stringify(first.json).slice(0, 300)}`);
  const finding = first.json.findings.find((f) => f.kind === 'brex-source' && /is not available/.test(f.title));
  assert.ok(finding, 'the refusal names the BREX that is missing');
  const subject = /BREX (\S+) is not available/.exec(finding.title)[1];

  // "build anyway" is for broken business rules only
  const anyway = await author.post(P('/publish/html'), { allowRuleBreaks: true });
  assert.ok(blocked(anyway), 'allowRuleBreaks never lets a missing BREX through');

  // the waiver is recorded (who, when, why) and the DRAFT HTML build goes ahead
  assert.equal((await author.post(P('/publish-waivers'), { kind: 'brex-missing', subject, reason: 'The customer BREX is delivered later' })).status, 201);
  const ok = await author.post(P('/publish/html'), {});
  assert.equal(ok.status, 201, JSON.stringify(ok.json).slice(0, 300));
  assert.equal(ok.json.pages, 1);
  assert.equal(ok.json.ruleBreaks.length, 0);
  assert.ok(ok.json.warnings.some((w) => w.includes(subject) && /NOT enforced/.test(w)), 'the response carries what the gate let through');

  const index = (await author.get(ok.json.index)).buf.toString('utf8');
  assert.match(index, /Built with exceptions/, 'the front page says this build used an exception');
  assert.ok(index.includes(subject), 'and names the BREX that was waived');
  assert.match(index, /NOT RELEASED/);
});
