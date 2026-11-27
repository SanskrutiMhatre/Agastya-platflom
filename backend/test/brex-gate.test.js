'use strict';
// BREX enforcement at publication, for all 21 data module types on issues 4.2, 5.0, 6 and 7.
//   - a module that breaks an error-level BREX rule saves (a draft) but blocks the full build, the server preview and a release request,
//     with the rule's own words in the refusal; a warning-level rule does not block; fixing the module unblocks
//   - the rules come from the BREX the module NAMES (the project's own data module, which itself references the official default: both apply)
//   - a BREX that cannot be used blocks: an invalid XPath in the project's BREX, a BREX that is not a valid data module, a BREX that is not in the project
//   - the official default BREX of the issue applies when the module names no project BREX (a titled step beside untitled ones, a forbidden service-bulletin topic type)
//   - the Validation endpoint reports the same breaches by default
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { boot, RESULTS, DM21 } = require('./helpers');

const PW = 'Correct-Horse-9!';
const FIX = (issue) => path.join(DM21, issue);
const ICN = 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg';
const TYPES = ['descript', 'proced', 'fault', 'crew', 'ipd', 'brex', 'comrep', 'appliccrossreftable', 'condcrossreftable', 'prdcrossreftable', 'brdoc', 'checklist', 'container', 'frontmatter', 'learning', 'process', 'sb', 'schedul', 'scocontent', 'wrngdata', 'wrngflds'];
const ISSUES = process.env.VERIFY_FULL ? ['4-2', '5-0', '6', '7'] : ['5-0'];
const PROJECT_BREX = 'DMC-EXAMPLE-A-00-00-00-00A-022B-D_001-00_EN-US.XML';
const PROJECT_CODE = 'modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="022" infoCodeVariant="B" itemLocationCode="D"';
const REC = {};
const rec = (type, issue, field, v) => { ((REC[`${type}/${issue}`] ??= {})[field] = v); };

let h; let admin; let w;
test.before(async () => {
  h = await boot();
  admin = new h.Client('admin');
  await admin.post('/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
  const made = await admin.post('/api/team/users', { username: 'wanda', fullName: 'Wanda Writer', role: 'author' });
  w = new h.Client('wanda');
  await w.post('/api/auth/login', { username: 'wanda', password: made.json.tempPassword });
  await w.post('/api/auth/onboarding', { username: 'wanda', password: PW });
});
test.after(async () => {
  const out = RESULTS;                                    // AGASTYA_TEST_RESULTS, else frontend/verification-results (helpers.js)
  fs.mkdirSync(out, { recursive: true });
  const file = path.join(out, 'brex-gate.json');
  let prev = {};
  try { prev = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* first run */ }
  fs.writeFileSync(file, JSON.stringify({ ...prev, ...REC }, null, 1));
  await h.close();
});

const rule = (id, p, flag, use, attrs = '') => `<structureObjectRule${attrs}><brDecisionRef brDecisionIdentNumber="${id}"/><objectPath allowedObjectFlag="${flag}">${p}</objectPath><objectUse>${use}</objectUse></structureObjectRule>`;
const P1 = rule('P1', "//techName[. = 'BREXBREACH']", '0', 'P1: the technical name BREXBREACH is reserved on this project');
const P2 = rule('P2', "//enterpriseName[. = 'WARNCO']", '0', 'P2: this company name is discouraged', ' brSeverityLevel="brsl02"');
const GOOD_RULES = P1 + P2;

/** The 22nd module: a project BREX (a copy of the BREX fixture, infoCodeVariant B) with the given rules; it references the official default as its parent. */
function projectBrex(issue, rules) {
  const xml = fs.readFileSync(path.join(FIX(issue), fs.readdirSync(FIX(issue)).find((f) => /-022A-D_/.test(f))), 'utf8');
  return xml.replace('infoCodeVariant="A"', 'infoCodeVariant="B"').replace(/<contextRules>[\s\S]*<\/contextRules>/, `<contextRules><structureObjectRuleGroup>${rules}</structureObjectRuleGroup></contextRules>`);
}
const useBrex = (xml, codeAttrs) => xml.replace(/(<brexDmRef>[\s\S]*?<dmCode )[^>]*?(\/>[\s\S]*?<\/brexDmRef>)/, `$1${codeAttrs}$2`);
const setTech = (xml, t) => xml.replace(/<techName>[^<]*<\/techName>/, `<techName>${t}</techName>`);
const setCompany = (xml, t) => xml.replace(/(<enterpriseName>)[^<]*(<\/enterpriseName>)/, `$1${t}$2`);

async function project(issue, name, { rules = GOOD_RULES, refBrex = true } = {}) {
  const dir = FIX(issue);
  const id = (await w.post('/api/projects', { name, pipeline: 's1000dtofo' })).json.project.id;
  const fd = new FormData();
  fd.append('file', new Blob([fs.readFileSync(path.join(dir, '..', ICN))]), ICN);
  fd.append('dir', 'csdb');
  assert.equal((await w.req('POST', `/api/projects/${id}/media`, fd)).status, 200);
  const names = TYPES.map((t) => JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'))[t]);
  assert.equal(names.length, 21);
  assert.equal((await w.post(`/api/projects/${id}/dms`, { file: PROJECT_BREX, xml: projectBrex(issue, rules) })).status, 201, 'the project BREX is saved');
  for (const f of names) {
    const xml = fs.readFileSync(path.join(dir, f), 'utf8');
    assert.equal((await w.post(`/api/projects/${id}/dms`, { file: f, xml: refBrex ? useBrex(xml, PROJECT_CODE) : xml })).status, 201, f);
  }
  const pmc = (await w.get(`/api/projects/${id}/pmc`)).json;
  const list = (await w.get(`/api/projects/${id}/dms`)).json.dms.filter((d) => names.includes(d.file));
  const entries = [{ type: 'folder', title: 'All', children: list.map((d) => ({ type: 'dm', dmCode: d.dmCodeAttrs, issueInfo: d.issueInfoAttrs, language: d.languageAttrs, techName: d.techName, infoName: d.infoName })) }];
  assert.equal((await w.put(`/api/projects/${id}/pmc`, { meta: pmc.meta, entries, baseHash: (await w.get(`/api/projects/${id}/pmc`)).json.hash })).status, 200);
  return { id, names };
}
const put = async (id, f, fn) => { const cur = (await w.get(`/api/projects/${id}/dms/${f}`)).json; const r = await w.put(`/api/projects/${id}/dms/${f}`, { xml: fn(cur.xml), baseHash: cur.hash }); assert.equal(r.status, 200, `${f} saved as a draft: ${JSON.stringify(r.json).slice(0, 200)}`); return cur.xml; };
const pdfMtime = (id) => { const f = path.join(process.env.AGASTYA_WORKSPACE_DIR, 'projects', id, 'jss-output.pdf'); return fs.existsSync(f) ? fs.statSync(f).mtimeMs : 0; };
const blocked = (r) => r.status === 422 && r.json.code === 'VALIDATION_FAILED';
const release = (id) => w.post(`/api/projects/${id}/release`, { scheduledAt: new Date(Date.now() + 3600e3).toISOString(), note: 'brex' });

for (const issue of ISSUES) {
  test(`issue ${issue}: a module that breaks a project BREX rule saves as a draft but blocks build, server preview and release, for all 21 types`, { timeout: 900000 }, async () => {
    const { id, names } = await project(issue, `BREX ${issue}`);
    // the baseline: every module is clean under the project BREX AND the default it references, so the publication builds
    const ok = await w.post(`/api/projects/${id}/publish`, {});
    assert.equal(ok.status, 200, `a BREX-clean publication must build: ${JSON.stringify(ok.json).slice(0, 400)}`);

    for (const [i, f] of names.entries()) {
      const type = TYPES[i];
      const original = await put(id, f, (x) => setTech(x, 'BREXBREACH'));          // the draft saves
      rec(type, issue, 'draftSaved', true);
      const before = pdfMtime(id);
      const build = await w.post(`/api/projects/${id}/publish`, {});
      const preview = await w.req('POST', `/api/projects/${id}/publish/preview/${f}`, {});
      const rel = await release(id);
      rec(type, issue, 'buildBlocked', blocked(build));
      rec(type, issue, 'previewBlocked', blocked(preview));
      rec(type, issue, 'releaseBlocked', blocked(rel));
      assert.ok(blocked(build), `${type} ${issue}: the build ran although the module breaks BREX rule P1 (${build.status})`);
      assert.ok(blocked(preview), `${type} ${issue}: the server preview ran although the module breaks BREX rule P1`);
      assert.ok(blocked(rel), `${type} ${issue}: a release was requested although the module breaks BREX rule P1`);
      const brexFinding = build.json.findings.find((x) => x.kind === 'brex');
      assert.ok(brexFinding, `${type}: the refusal carries a BREX finding`);
      assert.equal(brexFinding.file, f);
      assert.match(brexFinding.title, /business rule P1/);
      assert.match(brexFinding.detail, /BREXBREACH is reserved/, 'the rule\'s own words are in the message');
      assert.match(build.json.error, /business rules \(BREX\)/);
      assert.equal(pdfMtime(id), before, `${type}: a PDF was written although BREX failed`);
      if (i === 0) {
        // the Validation endpoint reports it as well, with BREX included by default
        const v = (await w.post(`/api/projects/${id}/validation`, { issue: 'auto' })).json.run;
        assert.ok(v.issues.some((x) => x.source === 'brex' && x.title === 'BREX P1' && x.file === f && x.sev === 'error'), 'validation lists the BREX breach');
        assert.ok(v.brexChecked >= 21);
      }
      await put(id, f, () => original);                                             // restored
      if (i === 0) assert.equal((await w.post(`/api/projects/${id}/publish`, {})).status, 200, 'fixing the module unblocks the build');
    }
  });

  test(`issue ${issue}: a warning-level BREX rule does not block; invalid or unavailable BREX modules do`, { timeout: 600000 }, async () => {
    const { id, names } = await project(issue, `BREX source ${issue}`);
    // warning level (brsl02): published
    const orig = await put(id, names[0], (x) => setCompany(x, 'WARNCO'));
    assert.equal((await w.post(`/api/projects/${id}/publish`, {})).status, 200, 'a warning-level breach does not block');
    const v = (await w.post(`/api/projects/${id}/validation`, { issue: 'auto' })).json.run;
    assert.ok(v.issues.some((x) => x.source === 'brex' && x.title === 'BREX P2' && x.sev === 'warn'), 'but it is reported as a warning');
    await put(id, names[0], () => orig);

    // an invalid XPath in the project's BREX blocks every module that relies on it
    const swapRules = async (rules) => { const cur = (await w.get(`/api/projects/${id}/dms/${PROJECT_BREX}`)).json; assert.equal((await w.put(`/api/projects/${id}/dms/${PROJECT_BREX}`, { xml: projectBrex(issue, rules), baseHash: cur.hash })).status, 200); };
    await swapRules(rule('P-BAD', '//[', '0', 'a rule that cannot run'));
    for (const [i, f] of names.entries()) {
      const pv = await w.req('POST', `/api/projects/${id}/publish/preview/${f}`, {});
      assert.ok(blocked(pv), `${TYPES[i]} ${issue}: a module relying on a BREX with an invalid rule must not be previewed on the server`);
      assert.ok(pv.json.findings.some((x) => x.kind === 'brex-source' && /invalid rule/.test(x.title) && /P-BAD/.test(x.detail) && x.detail.includes('invalid XPath')), `${TYPES[i]}: the refusal names the rule`);
      rec(TYPES[i], issue, 'invalidBrexBlocked', true);
    }
    const build = await w.post(`/api/projects/${id}/publish`, {});
    assert.ok(blocked(build));
    assert.match(build.json.error, /BREX .*cannot be used/);
    // an XPath 2.0 rule is not enforced here: a warning, not a block
    await swapRules(rule('P-X2', "//a[matches(.,'x')]", '0', 'xpath 2 rule'));
    assert.equal((await w.post(`/api/projects/${id}/publish`, {})).status, 200, 'an XPath 2.0 rule is reported as not enforced, it does not block');

    // the project's BREX must itself be a valid data module
    await swapRules(GOOD_RULES);
    const goodXml = (await w.get(`/api/projects/${id}/dms/${PROJECT_BREX}`)).json;
    assert.equal((await w.put(`/api/projects/${id}/dms/${PROJECT_BREX}`, { xml: goodXml.xml.replace('<content>', '<content><zzNope/>'), baseHash: goodXml.hash })).status, 200);
    const inv = await w.post(`/api/projects/${id}/publish`, {});
    assert.ok(blocked(inv) && inv.json.findings.some((x) => x.kind === 'brex-source' && /not a valid data module/.test(x.title)), 'a BREX that fails its own schema cannot be the authority');
    const g2 = (await w.get(`/api/projects/${id}/dms/${PROJECT_BREX}`)).json;
    assert.equal((await w.put(`/api/projects/${id}/dms/${PROJECT_BREX}`, { xml: goodXml.xml, baseHash: g2.hash })).status, 200);

    // a custom BREX that is not in the project
    const mod = await put(id, names[1], (x) => useBrex(x, PROJECT_CODE.replace('infoCodeVariant="B"', 'infoCodeVariant="Z"')));
    const miss = await w.post(`/api/projects/${id}/publish`, {});
    assert.ok(blocked(miss) && miss.json.findings.some((x) => x.kind === 'brex-source' && /not in the project/.test(x.detail)), 'a BREX named by a module but missing from the project blocks publication');
    await put(id, names[1], () => mod);
    assert.equal((await w.post(`/api/projects/${id}/publish`, {})).status, 200, 'everything restored: builds again');
  });

  test(`issue ${issue}: the official default BREX applies to a module that names no project BREX`, { timeout: 300000 }, async () => {
    const { id, names } = await project(issue, `BREX default ${issue}`, { refBrex: false });
    assert.equal((await w.post(`/api/projects/${id}/publish`, {})).status, 200, 'the clean modules build under the default BREX of the issue');
    const proced = names[TYPES.indexOf('proced')];
    const sb = names[TYPES.indexOf('sb')];
    // BREX-S1-00264: a step has a title only if its siblings have one
    const o1 = await put(id, proced, (x) => x.replace(/<mainProcedure>\s*<proceduralStep([^>]*)>/, '<mainProcedure><proceduralStep$1><title>Titled</title>'));
    const b1 = await w.post(`/api/projects/${id}/publish`, {});
    assert.ok(blocked(b1), 'blocked: ' + b1.status + JSON.stringify(b1.json).slice(0, 300)); assert.ok(b1.json.findings.some((x) => x.kind === 'brex' && x.file === proced && /BREX-S1-00264/.test(x.title) && /step must have a title/i.test(x.detail)), 'the default BREX rule is cited with its own words');
    await put(id, proced, () => o1);
    // BREX-S1-00096: sbtt01 is not allowed in a service bulletin summary
    const o2 = await put(id, sb, (x) => x.replace('sbTopicType="sbtt02"', 'sbTopicType="sbtt01"'));
    const b2 = await w.post(`/api/projects/${id}/publish`, {});
    assert.ok(blocked(b2) && b2.json.findings.some((x) => x.kind === 'brex' && x.file === sb && /BREX-S1-00096/.test(x.title)));
    await put(id, sb, () => o2);
    assert.equal((await w.post(`/api/projects/${id}/publish`, {})).status, 200);
    rec('proced', issue, 'defaultBrexBlocked', true);
    rec('sb', issue, 'defaultBrexBlocked', true);
  });
}
