'use strict';
// WP-33 / PERF-003: synthetic S1000D publications for the FO-stage scaling benchmark and the old-versus-new FO equivalence test.
//
// Every module is a clone of the repository's own e2e description module (frontend/e2e/fixtures/dm21/5-0, 040A): the SAME authored ids
// (fig-0001, tbl-0001, lp-0001 ...) repeat in every module, as they do in a real publication assembled from one template, so the
// duplicate-id branch of `unique-id` is exercised on every figure. Only the dmCode differs (assyCode / disassyCode), so each module
// is a distinct module, not a reprint. Runs xsltproc exactly as engine/build.js's direct S1000D pipeline does (--xinclude --nonet,
// catalogue environment), without FOP: the FO stage is what PERF-003 measured.

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const BACKEND = path.join(__dirname, '..');
const toolPaths = require('../vendor/engine/paths');
const { catalogEnv } = require('../vendor/engine/catalog');
const { writeImageDimIndex } = require('../vendor/engine/imageDims');
const ICN = path.join(BACKEND, 'test', 'fixtures', 'rich', 'ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01.svg');
const STYLESHEET = path.join(BACKEND, 'vendor', 'pipeline', 's1000dtofo', 's1000dtofo.xsl');

const pad = (n, w) => String(n).padStart(w, '0');

/** A data module with `figs` titled figures (plus one untitled), each referenced from the text; ids repeat across modules unless `uniqueIds`. */
function dataModule(i, { figs = 1, uniqueIds = false } = {}) {
  const sfx = uniqueIds ? `-m${pad(i, 4)}` : '';
  const assy = pad(Math.floor(i / 100), 2); const dis = pad(i % 100, 2);
  let figures = '';
  for (let f = 1; f <= figs; f++) {
    const id = `fig-${pad(f, 4)}${sfx}`;
    figures += `
    <para>See <internalRef internalRefId="${id}" internalRefTargetType="irtt01"/>.</para>
    <figure id="${id}">
      <title>System layout ${f}</title>
      <graphic infoEntityIdent="ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01"/>
    </figure>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<dmodule xmlns:xlink="http://www.w3.org/1999/xlink">
  <identAndStatusSection>
    <dmAddress>
      <dmIdent>
        <dmCode modelIdentCode="EXAMPLE" systemDiffCode="A" systemCode="00" subSystemCode="0" subSubSystemCode="0" assyCode="${assy}" disassyCode="${dis}" disassyCodeVariant="A" infoCode="040" infoCodeVariant="A" itemLocationCode="D"/>
        <language languageIsoCode="en" countryIsoCode="US"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </dmIdent>
      <dmAddressItems>
        <issueDate year="2026" month="11" day="17"/>
        <dmTitle><techName>Example system ${i}</techName><infoName>Description</infoName></dmTitle>
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
  <content>
<description>
  <levelledPara id="lp-0001${sfx}">
    <title>Overview</title>
    <para>The unit is <emphasis emphasisType="em01">bold</emphasis>; see <internalRef internalRefId="tbl-0001${sfx}" internalRefTargetType="irtt02"/> and <acronym><acronymTerm>LRU</acronymTerm><acronymDefinition>Line replaceable unit</acronymDefinition></acronym>.</para>${figures}
    <figure>
      <title/>
      <graphic infoEntityIdent="ICN-S1KSTUDIO-A-291000-A-00001-00001-A-001-01"/>
    </figure>
    <table id="tbl-0001${sfx}" frame="all">
      <title>Specifications</title>
      <tgroup cols="2">
        <colspec colname="c1" colwidth="40*"/><colspec colname="c2" colwidth="60*"/>
        <thead><row><entry><para>Item</para></entry><entry><para>Value</para></entry></row></thead>
        <tbody><row><entry><para>Mass</para></entry><entry><para>12 kg</para></entry></row></tbody>
      </tgroup>
    </table>
    <levelledPara id="lp-0002${sfx}">
      <title>Details</title>
      <para>Nested levelled paragraph.</para>
    </levelledPara>
  </levelledPara>
</description>
  </content>
</dmodule>
`;
}

/**
 * Write a publication of `n` modules into `dir` and return the path of its publication module.
 * opts.figs: titled figures per module; opts.uniqueIds; opts.reprint: also include module 1 a second time (a reprint, dm-occurrence-suffix).
 */
function writePublication(dir, n, opts = {}) {
  fs.mkdirSync(path.join(dir, 'csdb'), { recursive: true });
  const files = [];
  for (let i = 1; i <= n; i++) {
    const file = `DMC-EXAMPLE-A-00-0-0-${pad(Math.floor(i / 100), 2)}-${pad(i % 100, 2)}A-040A-D_001-00_EN-US.XML`;
    fs.writeFileSync(path.join(dir, 'csdb', file), dataModule(i, opts));
    files.push(file);
    if (opts.reprint && i === 1) files.push(file);
  }
  return writePm(dir, files, `FO scaling ${n}`);
}

/**
 * Write pm.xml into `dir`, one pmEntry per file (already in dir/csdb; a name listed twice is a reprint), copy the picture and
 * write the image-size index. Returns the path of pm.xml.
 */
function writePm(dir, files, title) {
  fs.mkdirSync(path.join(dir, 'csdb'), { recursive: true });
  const entries = files.map((f, i) => `\n      <pmEntry><pmEntryTitle>Chapter ${i + 1}</pmEntryTitle><xi:include href="csdb/${f}"/></pmEntry>`).join('');
  const n = title;
  const pm = `<?xml version="1.0" encoding="UTF-8"?>
<pm xmlns:xi="http://www.w3.org/2001/XInclude">
  <identAndStatusSection>
    <pmAddress>
      <pmIdent>
        <pmCode modelIdentCode="EXAMPLE" pmIssuer="00000" pmNumber="00001" pmVolume="00"/>
        <language countryIsoCode="US" languageIsoCode="en"/>
        <issueInfo issueNumber="001" inWork="00"/>
      </pmIdent>
      <pmAddressItems>
        <issueDate year="2026" month="11" day="17"/>
        <pmTitle>${n}</pmTitle>
      </pmAddressItems>
    </pmAddress>
    <pmStatus issueType="new">
      <security securityClassification="01"/>
      <responsiblePartnerCompany enterpriseCode="00000"><enterpriseName>Example Company</enterpriseName></responsiblePartnerCompany>
    </pmStatus>
  </identAndStatusSection>
  <content>${entries}
  </content>
</pm>
`;
  const out = path.join(dir, 'pm.xml');
  fs.writeFileSync(out, pm);
  // The picture and the side-car size index, as a real build has them (engine/build.js writes _image-dims.xml before the FO stage).
  if (!fs.existsSync(path.join(dir, 'csdb', path.basename(ICN)))) fs.copyFileSync(ICN, path.join(dir, 'csdb', path.basename(ICN)));
  writeImageDimIndex(dir, 'csdb', 'csdb');
  return out;
}

/**
 * Build a pipeline folder holding the stylesheets as they were BEFORE WP-33: a copy of vendor/pipeline with the files kept in
 * test/fixtures/wp33-old laid over s1000dtofo/. Returns the path of its s1000dtofo.xsl.
 */
function oldPipeline(dir) {
  const root = path.join(dir, 'pipeline-before-wp33');
  fs.cpSync(path.join(BACKEND, 'vendor', 'pipeline'), root, { recursive: true });
  const old = path.join(BACKEND, 'test', 'fixtures', 'wp33-old');
  for (const f of fs.readdirSync(old)) fs.copyFileSync(path.join(old, f), path.join(root, 's1000dtofo', f));
  return path.join(root, 's1000dtofo', 's1000dtofo.xsl');
}

/**
 * Write a driver stylesheet that imports `stylesheet` and overrides top-level params (as engine/build.js's writeDriver does),
 * so a profile such as layout.profile = xignal can be selected. Returns its path, or `stylesheet` itself with no params.
 */
function driver(dir, stylesheet, params) {
  const pairs = Object.entries(params || {});
  if (!pairs.length) return stylesheet;
  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/'/g, '&apos;').replace(/"/g, '&quot;');
  const href = 'file:///' + path.resolve(stylesheet).replace(/\\/g, '/');
  const body = pairs.map(([k, v]) => `  <xsl:param name="${esc(k)}" select="'${esc(v)}'"/>`).join('\n');
  const file = path.join(dir, `driver-${Math.random().toString(36).slice(2)}.xsl`);
  fs.writeFileSync(file, `<?xml version="1.0"?>\n<xsl:stylesheet version="1.0" xmlns:xsl="http://www.w3.org/1999/XSL/Transform">\n  <xsl:import href="${href}"/>\n${body}\n</xsl:stylesheet>\n`);
  return file;
}

/** Run the FO stage: xsltproc --xinclude --nonet over `input`, FO to `foOut`. Resolves { ms, stderr }. */
function runFo({ input, foOut, stylesheet = STYLESHEET, params, cwd, timeoutMs = 30 * 60 * 1000 }) {
  const dir = cwd || path.dirname(input);
  const xsl = driver(dir, stylesheet, params);
  const start = process.hrtime.bigint();
  return new Promise((resolve, reject) => {
    // Output and input relative to the working directory, as engine/build.js passes them (an absolute Windows -o path makes the
    // bundled xsltproc fail with "I/O error : Invalid argument").
    execFile(toolPaths.XSLTPROC, ['--xinclude', '--nonet', '-o', path.relative(dir, foOut), xsl, path.relative(dir, input)],
      { cwd: dir, timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024, env: toolPaths.childEnv({ ...catalogEnv() }) },
      (err, stdout, stderr) => {
        const ms = Number(process.hrtime.bigint() - start) / 1e6;
        if (err) { err.stderr = stderr; return reject(err); }
        resolve({ ms, stderr });
      });
  });
}

module.exports = { writePublication, writePm, runFo, driver, dataModule, oldPipeline, STYLESHEET, BACKEND, ICN };
