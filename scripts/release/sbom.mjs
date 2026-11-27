#!/usr/bin/env node
// =============================================================================
// Software bill of materials, CycloneDX 1.5 JSON (audit WP-24: DEP-026, RES-005, ENT-014). No network: everything comes from the lockfiles,
// the installed package.json files, packaging/bundled-components.json and the shipped files themselves.
//
//   node scripts/release/sbom.mjs [--stage DIR] [--out FILE] [--commit SHA] [--built-at ISO]
//       --stage   a staged product tree (release/Agastya-Platform-<v>-win-x64): hashes are taken from the shipped bytes, the npm set from
//                 app/backend/node_modules, versions from the shipped node.exe / JRE. Without it the repository is described instead.
//   node scripts/release/sbom.mjs --check FILE [--stage DIR]
//       structural check of an SBOM (format, unique refs, every component named and versioned or explained, the backend npm set equal to the
//       production packages of backend/package-lock.json, hashes well formed) and, with --stage, that every hashed file still matches.
//
// Contents: the product itself (metadata.component), the first-party host executables, every production npm package of the backend (scope
// required, SHA-512 from the lockfile), the npm packages compiled into the web client (frontend/package-lock.json, non-dev, installed:
// a superset of what the bundler kept, said in a property), Node.js, the JRE, FOP and each jar of its lib folder, xsltproc and each of its
// DLLs, the fonts and the XSD schema sets, with SHA-256 of the shipped files.
// =============================================================================

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sha256File, listFiles, ordinal } from './lib.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const purlNpm = (name, version) => `pkg:npm/${name.startsWith('@') ? '%40' + name.slice(1) : name}@${version}`;
const sriToHex = (sri) => {
  const m = /^(sha512|sha384|sha256|sha1)-(.+)$/.exec(sri || '');
  if (!m) return null;
  return { alg: { sha512: 'SHA-512', sha384: 'SHA-384', sha256: 'SHA-256', sha1: 'SHA-1' }[m[1]], content: Buffer.from(m[2], 'base64').toString('hex') };
};
const licenseOf = (pj) => {
  const l = typeof pj.license === 'string' ? pj.license : pj.license?.type ?? (Array.isArray(pj.licenses) ? pj.licenses.map((x) => x.type).join(' OR ') : null);
  return l ? [{ license: { name: l } }] : undefined;
};
/** A UUID made from the content, so two builds of the same inputs get the same serial number (reproducible-build record, DEP-026). */
const contentUuid = (s) => { const h = crypto.createHash('sha256').update(s).digest('hex'); return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`; };

/** Production packages of a lockfile (lockfileVersion 2/3): non-dev, and installed when an optional platform package. */
export function lockfilePackages(pkgDir, { installedOnly = true } = {}) {
  const lock = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package-lock.json'), 'utf8'));
  if (!lock.packages) throw new Error(`${pkgDir}/package-lock.json is not lockfileVersion 2 or 3`);
  const out = [];
  for (const [key, v] of Object.entries(lock.packages)) {
    if (!key.startsWith('node_modules/') || v.dev || v.link) continue;
    const dir = path.join(pkgDir, ...key.split('/'));
    if (installedOnly && !fs.existsSync(path.join(dir, 'package.json'))) continue;
    const name = v.name || key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    out.push({ key, name, version: v.version, integrity: v.integrity, resolved: v.resolved, dir, optional: !!v.optional });
  }
  return out.sort((a, b) => ordinal(a.key, b.key));
}

/** The npm packages present in a node_modules tree (nested ones too): [{ key: 'node_modules/a/node_modules/b', name, version }]. */
export function stagedPackages(pkgDir) {
  const out = [];
  const visit = (nm, keyPre) => {
    if (!fs.existsSync(nm)) return;
    for (const e of fs.readdirSync(nm, { withFileTypes: true })) {
      if (!e.isDirectory() || e.name.startsWith('.')) continue;
      const dirs = e.name.startsWith('@') ? fs.readdirSync(path.join(nm, e.name), { withFileTypes: true }).filter((x) => x.isDirectory()).map((x) => `${e.name}/${x.name}`) : [e.name];
      for (const d of dirs) {
        const dir = path.join(nm, ...d.split('/'));
        const key = `${keyPre}node_modules/${d}`;
        const pjf = path.join(dir, 'package.json');
        if (fs.existsSync(pjf)) { const pj = JSON.parse(fs.readFileSync(pjf, 'utf8')); if (pj.name && pj.version) out.push({ key, name: pj.name, version: pj.version }); }
        visit(path.join(dir, 'node_modules'), `${key}/`);
      }
    }
  };
  visit(path.join(pkgDir, 'node_modules'), '');
  return out.sort((a, b) => ordinal(a.key, b.key));
}

function readJreVersion(jreDir) {
  try {
    const t = fs.readFileSync(path.join(jreDir, 'release'), 'utf8');
    return (t.match(/JAVA_RUNTIME_VERSION="([^"]+)"/) || t.match(/JAVA_VERSION="([^"]+)"/) || [])[1] || null;
  } catch { return null; }
}

/**
 * Build the SBOM object. opts: { stage, commit, builtAt, product, version, nodeVersion }.
 * `stage` absent = describe the repository (paths app/backend/... map to backend/...).
 */
export function buildSbom(opts = {}) {
  const product = opts.product || JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging', 'product.json'), 'utf8'));
  const version = opts.version || JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
  const stage = opts.stage ? path.resolve(opts.stage) : null;
  const where = (rel) => {
    if (stage) return path.join(stage, ...rel.split('/'));
    if (rel.startsWith('app/backend/')) return path.join(ROOT, 'backend', ...rel.slice('app/backend/'.length).split('/'));
    if (rel.startsWith('app/frontend/')) return path.join(ROOT, 'frontend', ...rel.slice('app/frontend/'.length).split('/'));
    return null;   // runtime/node.exe, the host executables: only in a staged tree
  };
  const hashOf = (rel) => { const p = where(rel); return p && fs.existsSync(p) && fs.statSync(p).isFile() ? [{ alg: 'SHA-256', content: sha256File(p) }] : null; };
  const components = []; const problems = []; const problemsNote = [];
  const prop = (name, value) => ({ name, value: String(value) });

  // first-party executables
  for (const exe of ['AgastyaPlatform.exe', 'AgastyaCtl.exe']) {
    const h = hashOf(exe);
    if (stage && !h) problems.push(`${exe} is not in the staged tree`);
    if (h) components.push({ 'bom-ref': `first-party:${exe}`, type: 'application', name: exe, version, supplier: { name: product.publisher }, hashes: h, properties: [prop('agastya:path', exe)] });
  }

  // backend npm packages: what the staged product really ships when packaging (the truth for the customer), the lockfile's production set
  // otherwise. A staged package that the lockfile does not have at that place and version is listed too, with a property saying so.
  const lockAll = JSON.parse(fs.readFileSync(path.join(ROOT, 'backend', 'package-lock.json'), 'utf8')).packages;
  const beList = stage ? stagedPackages(path.join(stage, 'app', 'backend')) : lockfilePackages(path.join(ROOT, 'backend'));
  for (const p of beList) {
    const pjFile = path.join(stage ? path.join(stage, 'app', 'backend') : path.join(ROOT, 'backend'), ...p.key.split('/'), 'package.json');
    const pj = fs.existsSync(pjFile) ? JSON.parse(fs.readFileSync(pjFile, 'utf8')) : {};
    const lock = lockAll[p.key];
    const inLock = lock && lock.version === p.version;
    const h = inLock ? sriToHex(lock.integrity) : null;
    const props = [prop('agastya:path', `app/backend/${p.key}`)];
    if (h) props.push(prop('agastya:hash-source', 'package-lock.json integrity (registry tarball)'));
    if (!inLock) problemsNote.push(`${p.key}@${p.version}`), props.push(prop('agastya:lockfile', lock ? `differs: the lockfile has ${lock.version}` : 'not in backend/package-lock.json'));
    else if (lock.dev) props.push(prop('agastya:lockfile', 'a development dependency in the lockfile, shipped anyway'));
    components.push({
      'bom-ref': `npm:backend:${p.key.slice('node_modules/'.length)}@${p.version}`, type: 'library', name: p.name, version: p.version, scope: 'required', purl: purlNpm(p.name, p.version),
      ...(licenseOf(pj) ? { licenses: licenseOf(pj) } : {}), ...(h ? { hashes: [h] } : {}),
      ...(inLock && lock.resolved ? { externalReferences: [{ type: 'distribution', url: lock.resolved }] } : {}),
      properties: props,
    });
  }

  // web client: packages compiled into app/frontend/dist
  for (const p of lockfilePackages(path.join(ROOT, 'frontend'))) {
    const pj = JSON.parse(fs.readFileSync(path.join(p.dir, 'package.json'), 'utf8'));
    const h = sriToHex(p.integrity);
    components.push({
      'bom-ref': `npm:frontend:${p.key.slice('node_modules/'.length)}@${p.version}`, type: 'library', name: p.name, version: p.version, scope: 'required', purl: purlNpm(p.name, p.version),
      ...(licenseOf(pj) ? { licenses: licenseOf(pj) } : {}), ...(h ? { hashes: [h] } : {}),
      properties: [prop('agastya:path', 'app/frontend/dist (compiled into the web client)'),
        prop('agastya:note', 'listed from frontend/package-lock.json (non-dev); the bundler may have left parts of it out')],
    });
  }

  // components npm does not describe
  const bundled = JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging', 'bundled-components.json'), 'utf8')).components;
  const nodeVersion = opts.nodeVersion?.replace(/^v/, '') || (stage ? (() => { try { return JSON.parse(fs.readFileSync(path.join(stage, 'version.json'), 'utf8')).node.replace(/^v/, ''); } catch { return null; } })() : null);
  for (const b of bundled) {
    const lic = b.license ? [{ license: { name: b.license } }] : undefined;
    const base = { supplier: b.supplier ? { name: b.supplier } : undefined, licenses: lic };
    const notes = b.notes ? [prop('agastya:note', b.notes)] : [];
    if (b.jarsIn) {
      const dir = where(b.jarsIn);
      if (!dir || !fs.existsSync(dir)) { problems.push(`${b.jarsIn} is missing`); continue; }
      const jars = fs.readdirSync(dir).filter((f) => f.endsWith('.jar') && (!b.jarPattern || new RegExp(b.jarPattern).test(f))).sort();
      if (!jars.length) problems.push(`no .jar in ${b.jarsIn}`);
      for (const j of jars) {
        const m = /^(.*?)-(\d[\w.]*)\.jar$/.exec(j);
        const name = m ? m[1] : j.replace(/\.jar$/, ''); const ver = m ? m[2] : (b.version || '');
        const group = b.groups ? Object.entries(b.groups).find(([pre]) => name.startsWith(pre))?.[1] : null;
        const purl = b.purl && name === 'fop' ? b.purl.replace('{version}', ver) : group ? `pkg:maven/${group}/${name}@${ver}` : undefined;
        components.push({ 'bom-ref': `${b.ref}:${j}`, type: 'library', name, version: ver, ...base, ...(purl ? { purl } : {}),
          hashes: [{ alg: 'SHA-256', content: sha256File(path.join(dir, j)) }], properties: [prop('agastya:path', `${b.jarsIn}/${j}`), prop('agastya:part-of', b.name), ...notes] });
      }
      continue;
    }
    if (b.schemaSetsIn) {
      const dir = where(b.schemaSetsIn);
      if (!dir || !fs.existsSync(dir)) { problems.push(`${b.schemaSetsIn} is missing`); continue; }
      for (const set of fs.readdirSync(dir).filter((d) => fs.statSync(path.join(dir, d)).isDirectory()).sort()) {
        const files = listFiles(path.join(dir, set));
        if (!files.length) continue;
        const tree = crypto.createHash('sha256').update(files.map((f) => `${sha256File(path.join(dir, set, ...f.split('/')))} ${f}\n`).join('')).digest('hex');
        components.push({ 'bom-ref': `${b.ref}:${set}`, type: 'data', name: `${b.name} ${/^\d/.test(set) ? `S1000D issue ${set}` : set.toUpperCase()}`, version: /^\d/.test(set) ? set : 'unversioned',
          ...base, hashes: [{ alg: 'SHA-256', content: tree }],
          properties: [prop('agastya:path', `${b.schemaSetsIn}/${set}`), prop('agastya:files', files.length), prop('agastya:hash-source', 'SHA-256 over "<sha256> <path>" lines of every file, sorted'), ...notes] });
      }
      continue;
    }
    if (b.treeHashOf) {
      const dir = where(b.treeHashOf);
      const files = dir && fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => new RegExp(b.treePattern, 'i').test(f) && fs.statSync(path.join(dir, f)).isFile()).sort() : [];
      if (!files.length) { if (!b.optional) problems.push(`no ${b.treePattern} file in ${b.treeHashOf}`); continue; }
      const tree = crypto.createHash('sha256').update(files.map((f) => `${sha256File(path.join(dir, f))} ${f}\n`).join('')).digest('hex');
      components.push({ 'bom-ref': b.ref, type: 'data', name: b.name, version: b.version || 'unversioned', ...base, hashes: [{ alg: 'SHA-256', content: tree }],
        properties: [prop('agastya:path', `${b.treeHashOf}/${b.treePattern.replace(/^\^/, '')}*`), prop('agastya:files', files.join(' ')), prop('agastya:hash-source', 'SHA-256 over "<sha256> <name>" lines of the files, sorted'), ...notes] });
      continue;
    }
    let ver = b.version;
    if (b.versionFrom === 'node') ver = nodeVersion || JSON.parse(fs.readFileSync(path.join(ROOT, 'packaging', 'product.json'), 'utf8')).runtime?.node || b.version;
    if (b.versionFrom === 'jre-release') ver = readJreVersion(where('app/backend/vendor/tools/jre')) || b.version;
    const fileComps = [];
    for (const f of b.files || []) {
      const h = hashOf(f);
      if (!h) { if (stage || where(f)) problems.push(`${f} is missing`); continue; }
      fileComps.push({ 'bom-ref': `${b.ref}:file:${f}`, type: 'file', name: path.posix.basename(f), hashes: h, properties: [prop('agastya:path', f)] });
    }
    const c = { 'bom-ref': b.ref, type: b.type, name: b.name, ...(ver ? { version: ver } : {}), ...base,
      ...(b.cpe && ver ? { cpe: b.cpe.replace('{version}', ver) } : {}), ...(b.purl && ver ? { purl: b.purl.replace('{version}', ver) } : {}), properties: notes };
    if (fileComps.length === 1) { c.hashes = fileComps[0].hashes; c.properties.push(prop('agastya:path', b.files[0])); }
    else if (fileComps.length) c.components = fileComps;
    if (!ver) c.properties.push(prop('agastya:note', 'the supplier states no version for this build; identified by the hashes'));
    if (!c.properties.length) delete c.properties;
    components.push(c);
  }
  for (const c of components) for (const k of Object.keys(c)) if (c[k] === undefined) delete c[k];

  const body = JSON.stringify(components);
  const bom = {
    bomFormat: 'CycloneDX', specVersion: '1.5', serialNumber: `urn:uuid:${contentUuid(`${version}|${opts.commit || ''}|${body}`)}`, version: 1,
    metadata: {
      timestamp: opts.builtAt || new Date().toISOString(),
      tools: { components: [{ type: 'application', name: 'agastya scripts/release/sbom.mjs', version }] },
      component: { 'bom-ref': 'product', type: 'application', name: product.name, version, supplier: { name: product.publisher }, description: product.description,
        properties: [prop('agastya:commit', opts.commit || 'unknown'), prop('agastya:platform', 'win-x64'), prop('agastya:source', stage ? 'staged product tree' : 'repository')] },
    },
    components,
    dependencies: [{ ref: 'product', dependsOn: components.map((c) => c['bom-ref']) }],
  };
  // lockfileDrift: shipped packages the lockfile does not have at that place and version (the build's node_modules was not `npm ci` of this commit)
  return { bom, problems, lockfileDrift: problemsNote };
}

/** Structural check of an SBOM file. Returns a list of problems (empty = good). */
export function checkSbom(file, { stage } = {}) {
  const p = [];
  let bom;
  try { bom = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { return [`cannot read ${file}: ${e.message}`]; }
  if (bom.bomFormat !== 'CycloneDX') p.push('bomFormat is not CycloneDX');
  if (!/^1\.[4-6]$/.test(bom.specVersion)) p.push(`specVersion ${bom.specVersion} is not 1.4-1.6`);
  if (!/^urn:uuid:[0-9a-f-]{36}$/.test(bom.serialNumber || '')) p.push('serialNumber is not a urn:uuid');
  if (!bom.metadata?.component?.name || !bom.metadata?.component?.version) p.push('metadata.component has no name/version');
  const all = [];
  const walk = (list) => { for (const c of list || []) { all.push(c); walk(c.components); } };
  walk(bom.components);
  if (!all.length) p.push('no components');
  const refs = new Set();
  for (const c of all) {
    if (!c['bom-ref']) p.push(`a component without bom-ref (${c.name})`); else if (refs.has(c['bom-ref'])) p.push(`duplicate bom-ref ${c['bom-ref']}`); else refs.add(c['bom-ref']);
    if (!c.name) p.push(`${c['bom-ref']}: no name`);
    if (!['application', 'framework', 'library', 'container', 'platform', 'operating-system', 'device', 'device-driver', 'firmware', 'file', 'machine-learning-model', 'data'].includes(c.type)) p.push(`${c['bom-ref']}: type ${c.type}`);
    if (c.type !== 'file' && !c.version && !(c.properties || []).some((x) => x.name === 'agastya:note')) p.push(`${c['bom-ref']}: no version and no note saying why`);
    for (const h of c.hashes || []) {
      const len = { 'SHA-1': 40, 'SHA-256': 64, 'SHA-384': 96, 'SHA-512': 128 }[h.alg];
      if (!len || !new RegExp(`^[0-9a-f]{${len}}$`).test(h.content)) p.push(`${c['bom-ref']}: malformed ${h.alg} hash`);
    }
    if (c.purl && !/^pkg:[a-z]+\/.+@.+/.test(c.purl)) p.push(`${c['bom-ref']}: malformed purl ${c.purl}`);
  }
  for (const d of bom.dependencies || []) for (const r of [d.ref, ...(d.dependsOn || [])]) if (r !== 'product' && !refs.has(r)) p.push(`dependency on unknown ref ${r}`);
  // the audit's acceptance: every shipped npm package listed. Against the staged tree when one is given (what really ships), against the
  // lockfile's production set for an SBOM of the repository; an SBOM of a staged tree checked without the tree is checked for structure only.
  const source = (bom.metadata?.component?.properties || []).find((x) => x.name === 'agastya:source')?.value;
  const have = new Set(all.filter((c) => c['bom-ref'].startsWith('npm:backend:')).map((c) => `${c.name}@${c.version}`));
  let want = null; let against = '';
  if (stage) { want = new Set(stagedPackages(path.join(stage, 'app', 'backend')).map((x) => `${x.name}@${x.version}`)); against = 'the staged app/backend/node_modules'; }
  else if (source !== 'staged product tree') { want = new Set(lockfilePackages(path.join(ROOT, 'backend'), { installedOnly: false }).map((x) => `${x.name}@${x.version}`)); against = 'the production set of backend/package-lock.json'; }
  else if (!have.size) p.push('no backend npm package listed');
  if (want) {
    const missing = [...want].filter((x) => !have.has(x)); const unexpected = [...have].filter((x) => !want.has(x));
    if (missing.length) p.push(`backend packages in ${against} missing from the SBOM: ${missing.slice(0, 10).join(', ')}${missing.length > 10 ? ` (+${missing.length - 10})` : ''}`);
    if (unexpected.length) p.push(`SBOM lists backend packages that are not in ${against}: ${unexpected.slice(0, 10).join(', ')}`);
  }
  for (const ref of ['nodejs', 'temurin-jre', 'libxslt', 'libxml2']) if (!refs.has(ref)) p.push(`bundled component ${ref} is missing`);
  if (![...refs].some((r) => r.startsWith('apache-fop:'))) p.push('Apache FOP is missing');
  if (stage) {
    for (const c of all) {
      const rel = (c.properties || []).find((x) => x.name === 'agastya:path')?.value;
      const h = (c.hashes || []).find((x) => x.alg === 'SHA-256');
      if (!rel || !h || c.type === 'data') continue;
      const f = path.join(stage, ...rel.split('/'));
      if (!fs.existsSync(f) || !fs.statSync(f).isFile()) p.push(`${rel} (in the SBOM) is not in ${stage}`);
      else if (sha256File(f) !== h.content) p.push(`${rel} does not match its SBOM hash`);
    }
  }
  return p;
}

export const sbomStats = (bom) => {
  const all = []; const walk = (l) => { for (const c of l || []) { all.push(c); walk(c.components); } }; walk(bom.components);
  return { components: all.length, backendNpm: all.filter((c) => c['bom-ref'].startsWith('npm:backend:')).length, frontendNpm: all.filter((c) => c['bom-ref'].startsWith('npm:frontend:')).length,
    other: all.filter((c) => !c['bom-ref'].startsWith('npm:') && c.type !== 'file').length };
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
  if (opt('--check')) {
    const problems = checkSbom(path.resolve(opt('--check')), { stage: opt('--stage') });
    if (problems.length) { console.error(`SBOM check FAILED:\n  ${problems.join('\n  ')}`); process.exit(1); }
    const s = sbomStats(JSON.parse(fs.readFileSync(opt('--check'), 'utf8')));
    console.log(`SBOM ok: ${s.components} components (${s.backendNpm} backend npm, ${s.frontendNpm} web-client npm, ${s.other} other)`);
    process.exit(0);
  }
  const git = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT, encoding: 'utf8' });
  const { bom, problems } = buildSbom({ stage: opt('--stage'), commit: opt('--commit') || (git.status === 0 ? git.stdout.trim() : undefined), builtAt: opt('--built-at') });
  if (problems.length) { console.error(`SBOM: ${problems.join('; ')}`); process.exit(1); }
  const out = path.resolve(opt('--out') || 'SBOM.cdx.json');
  fs.writeFileSync(out, JSON.stringify(bom, null, 2) + '\n');
  const s = sbomStats(bom);
  console.log(`wrote ${out}: ${s.components} components (${s.backendNpm} backend npm, ${s.frontendNpm} web-client npm, ${s.other} other)`);
}
