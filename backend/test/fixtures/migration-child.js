'use strict';
// Child process for s1000d-migration.test.js: boots the REAL app on the workspace in $AGASTYA_WORKSPACE_DIR and either seeds realistic
// projects ("seed") or reports what the server now says about them ("report"). Prints one JSON line.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const mode = process.argv[2];
const PW = 'Correct-Horse-9!';
const SAMPLES = path.resolve(__dirname, '..', '..', '..', 'frontend', 'public', 'samples');

(async () => {
  const { createApp } = require('../../dist/app');
  const server = http.createServer(createApp());
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  let cookie = '';
  const req = async (method, url, body) => {
    const headers = {}; if (cookie) headers.cookie = cookie;
    let payload; if (body !== undefined) { headers['content-type'] = 'application/json'; payload = JSON.stringify(body); }
    const res = await fetch(base + url, { method, headers, body: payload });
    const set = res.headers.get('set-cookie'); if (set) cookie = set.split(';')[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  const out = {};
  if (mode === 'seed') {
    await req('POST', '/api/auth/setup', { username: 'admin', password: PW, fullName: 'Admin' });
    const made = await req('POST', '/api/team/users', { username: 'meera', fullName: 'Meera', role: 'project_manager' });
    const pmc = { c: '' };
    await req('POST', '/api/auth/logout', {});
    cookie = '';
    await req('POST', '/api/auth/login', { username: 'meera', password: made.json.tempPassword });
    await req('POST', '/api/auth/onboarding', { username: 'meera', password: PW });
    // project 1: the sample project's three real data modules (one MIC, one issue)
    const p1 = (await req('POST', '/api/projects', { name: 'Handbook (real modules)' })).json.project.id;
    for (const f of fs.readdirSync(SAMPLES).filter((n) => /^DMC-.*\.xml$/i.test(n))) {
      const r = await req('POST', `/api/projects/${p1}/dms`, { file: f, xml: fs.readFileSync(path.join(SAMPLES, f), 'utf8') });
      if (r.status !== 201) throw new Error('seed ' + f + ' ' + JSON.stringify(r.json));
    }
    // project 2: MIXED model codes and issues, as hand-merged projects are
    const p2 = (await req('POST', '/api/projects', { name: 'Merged (mixed)' })).json.project.id;
    const mk = (mic, dir, sys) => ({
      file: `DMC-${mic}-A-${sys}-00-00-00A-040A-D_001-00_EN-US.xml`,
      xml: `<?xml version="1.0"?><dmodule xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.s1000d.org/${dir}/xml_schema_flat/descript.xsd"><identAndStatusSection><dmAddress><dmIdent><dmCode modelIdentCode="${mic}" systemDiffCode="A" systemCode="${sys}" subSystemCode="0" subSubSystemCode="0" assyCode="00" disassyCode="00" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="D"/><language languageIsoCode="en" countryIsoCode="US"/><issueInfo issueNumber="001" inWork="00"/></dmIdent><dmAddressItems><issueDate year="2026" month="01" day="01"/><dmTitle><techName>T</techName></dmTitle></dmAddressItems></dmAddress><dmStatus issueType="new"><security securityClassification="01"/></dmStatus></identAndStatusSection><content><description><para>x</para></description></content></dmodule>`,
    });
    for (const [mic, dir, sys] of [['AAAAA', 'S1000D_4-2', '10'], ['BBBBB', 'S1000D_6', '20']]) { const d = mk(mic, dir, sys); await req('POST', `/api/projects/${p2}/dms`, d); }
    const p3 = (await req('POST', '/api/projects', { name: 'Empty' })).json.project.id;
    out.projects = { p1, p2, p3 };
  } else if (mode === 'report') {
    await req('POST', '/api/auth/login', { username: 'meera', password: PW });
    const list = (await req('GET', '/api/projects')).json.projects;
    out.configs = {};
    for (const p of list) {
      const c = (await req('GET', `/api/projects/${p.id}/s1000d`)).json;
      out.configs[p.name] = { id: p.id, config: c.config, lock: c.lock, dmCount: c.dmCount, version: c.version, codes: c.codes.infoCode.length };
    }
    await req('POST', '/api/auth/logout', {}); cookie = '';
    await req('POST', '/api/auth/login', { username: 'admin', password: PW });
    out.overview = (await req('GET', '/api/admin/s1000d/overview')).json.summary.map((s) => [s.issue, s.kinds.infoCode.count, s.kinds.infoCode.custom]);
    out.presets = (await req('GET', '/api/s1000d/presets')).json.presets.map((p) => p.id);
  }
  server.close(); process.stdout.write('\n@@' + JSON.stringify(out) + '\n'); process.exit(0);
})().catch((e) => { console.error(e.stack); process.exit(1); });
