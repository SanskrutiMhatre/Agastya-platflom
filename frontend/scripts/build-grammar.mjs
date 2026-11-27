#!/usr/bin/env node
// Copied from Editor/scripts/build-grammar.mjs (unchanged except: skips the schemas/ent entity directory). Run: node scripts/build-grammar.mjs
/**
 * XSD -> editor grammar compiler.
 *
 * Reads the official S1000D flat schemas in public/schemas/<issue>/ and emits
 * compact JSON grammars in public/grammar/<issue>/<schema>.json that the editor
 * uses for schema-aware structured editing (allowed children, required
 * structure, attribute types/enumerations, mixed content detection).
 *
 * Also copies the xmllint wasm worker into public/vendor/xmllint so XSD
 * validation runs in a plain Web Worker without bundler-specific handling.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaDir = path.join(root, 'public/schemas');
// WP-18 (FE-032): these issues are the server's own schema sets (backend/schemas), served to the browser by the backend at /schemas/<issue>/
const SERVER_SETS = { '4-2': '4.2', '5-0': '5.0', '6': '6.0', '7': '7.0' };
const issueDirOf = (issue) => (SERVER_SETS[issue] ? path.join(root, '..', 'backend', 'schemas', SERVER_SETS[issue]) : path.join(schemaDir, issue));
const outDir = path.join(root, 'public/grammar');
const XS = 'http://www.w3.org/2001/XMLSchema';

const KNOWN_PREFIX = {
  'http://www.w3.org/1999/xlink': 'xlink',
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#': 'rdf',
  'http://www.purl.org/dc/elements/1.1/': 'dc',
  'http://purl.org/dc/elements/1.1/': 'dc',
  'http://www.w3.org/XML/1998/namespace': 'xml',
};

const { window } = new JSDOM('');
const parser = new window.DOMParser();

function parseFile(file) {
  const text = fs.readFileSync(file, 'utf8');
  const doc = parser.parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('Cannot parse ' + file);
  return doc;
}

function kids(el, local) {
  const out = [];
  for (const c of el.children) if (c.namespaceURI === XS && (!local || c.localName === local)) out.push(c);
  return out;
}

/** Loads a schema and all of its imports into a component registry. */
function loadSchemaSet(issueDir, mainFile) {
  const reg = { elements: {}, types: {}, groups: {}, attrGroups: {}, attrs: {}, loaded: new Set() };
  function load(file) {
    const full = path.join(issueDir, file);
    if (reg.loaded.has(full) || !fs.existsSync(full)) return;
    reg.loaded.add(full);
    const doc = parseFile(full);
    const s = doc.documentElement;
    const tns = s.getAttribute('targetNamespace') || '';
    const prefix = KNOWN_PREFIX[tns] || '';
    const key = (n) => (prefix ? prefix + ':' + n : n);
    for (const c of kids(s)) {
      const name = c.getAttribute('name');
      switch (c.localName) {
        case 'import':
        case 'include': {
          const loc = c.getAttribute('schemaLocation');
          if (loc && !/^https?:/.test(loc)) load(loc);
          break;
        }
        case 'element': reg.elements[key(name)] = c; break;
        case 'complexType': reg.types[key(name)] = c; break;
        case 'simpleType': reg.types[key(name)] = c; break;
        case 'group': reg.groups[key(name)] = c; break;
        case 'attributeGroup': reg.attrGroups[key(name)] = c; break;
        case 'attribute': reg.attrs[key(name)] = c; break;
      }
    }
  }
  load(mainFile);
  return reg;
}

/** Resolves a QName attribute value to a registry key. */
function qkey(el, qname) {
  const i = qname.indexOf(':');
  const pfx = i >= 0 ? qname.slice(0, i) : null;
  const local = i >= 0 ? qname.slice(i + 1) : qname;
  let ns = el.lookupNamespaceURI(pfx);
  if (pfx === 'xml') ns = 'http://www.w3.org/XML/1998/namespace';
  if (ns === XS) return 'xs:' + local;
  const known = ns ? KNOWN_PREFIX[ns] : '';
  return known ? known + ':' + local : local;
}

function occurs(el) {
  const mn = el.getAttribute('minOccurs');
  const mx = el.getAttribute('maxOccurs');
  return { m: mn == null ? 1 : parseInt(mn, 10), x: mx == null ? 1 : mx === 'unbounded' ? -1 : parseInt(mx, 10) };
}

function withOcc(p, o) {
  if (o.m !== 1) p.m = o.m;
  if (o.x !== 1) p.x = o.x;
  return p;
}

function compileGrammar(issue, schemaName) {
  const issueDir = issueDirOf(issue);
  const reg = loadSchemaSet(issueDir, schemaName + '.xsd');
  const out = { issue, schema: schemaName, root: null, elements: {}, types: {}, groups: {}, simple: {} };

  // ---- simple types
  function simpleType(key, node) {
    if (out.simple[key]) return key;
    out.simple[key] = {}; // recursion guard
    const st = {};
    const r = kids(node, 'restriction')[0];
    const list = kids(node, 'list')[0];
    const union = kids(node, 'union')[0];
    if (r) {
      const base = r.getAttribute('base');
      if (base) {
        const bk = qkey(r, base);
        if (bk.startsWith('xs:')) st.b = bk.slice(3);
        else if (reg.types[bk]) {
          const inner = simpleType(bk, reg.types[bk]);
          Object.assign(st, JSON.parse(JSON.stringify(out.simple[inner])));
        }
      } else if (kids(r, 'simpleType')[0]) {
        const inl = simpleType(key + '#base', kids(r, 'simpleType')[0]);
        Object.assign(st, JSON.parse(JSON.stringify(out.simple[inl])));
      }
      const enums = kids(r, 'enumeration').map((e) => e.getAttribute('value'));
      if (enums.length) st.e = enums;
      const pats = kids(r, 'pattern').map((e) => e.getAttribute('value'));
      if (pats.length) st.p = pats;
      for (const f of ['minInclusive', 'maxInclusive', 'minLength', 'maxLength', 'length']) {
        const fe = kids(r, f)[0];
        if (fe) st[f] = fe.getAttribute('value');
      }
    } else if (list) {
      st.list = true;
      const it = list.getAttribute('itemType');
      st.b = it ? qkey(list, it).replace(/^xs:/, '') : 'string';
    } else if (union) {
      st.b = 'string';
      const members = (union.getAttribute('memberTypes') || '').split(/\s+/).filter(Boolean);
      const enums = [];
      for (const m of members) {
        const mk = qkey(union, m);
        if (reg.types[mk]) {
          const k = simpleType(mk, reg.types[mk]);
          if (out.simple[k].e) enums.push(...out.simple[k].e);
        }
      }
      if (enums.length) { st.e = enums; st.open = true; }
    }
    if (!st.b) st.b = 'string';
    out.simple[key] = st;
    return key;
  }

  function attrTypeKey(attrNode, ownerKey) {
    const t = attrNode.getAttribute('type');
    if (t) {
      const k = qkey(attrNode, t);
      if (k.startsWith('xs:')) {
        const bk = k;
        if (!out.simple[bk]) out.simple[bk] = { b: k.slice(3) };
        return bk;
      }
      if (reg.types[k]) return simpleType(k, reg.types[k]);
      return 'xs:string';
    }
    const inl = kids(attrNode, 'simpleType')[0];
    if (inl) return simpleType('#' + ownerKey, inl);
    if (!out.simple['xs:string']) out.simple['xs:string'] = { b: 'string' };
    return 'xs:string';
  }

  // ---- attributes
  function collectAttrs(node, list, seen) {
    for (const c of kids(node)) {
      if (c.localName === 'attribute') {
        let a = c;
        let name = c.getAttribute('name');
        const ref = c.getAttribute('ref');
        if (ref) {
          const k = qkey(c, ref);
          a = reg.attrs[k];
          name = k;
          if (!a) {
            if (k.startsWith('xml:')) {
              list.push({ n: k, t: 'xs:string' });
              continue;
            }
            continue;
          }
        }
        if (c.getAttribute('use') === 'prohibited') continue;
        if (seen.has(name)) continue;
        seen.add(name);
        const def = { n: name, t: attrTypeKey(a, name) };
        const use = c.getAttribute('use') || a.getAttribute('use');
        if (use === 'required') def.r = 1;
        const dv = c.getAttribute('default') ?? a.getAttribute('default');
        if (dv != null) def.d = dv;
        const fv = c.getAttribute('fixed') ?? a.getAttribute('fixed');
        if (fv != null) def.f = fv;
        list.push(def);
      } else if (c.localName === 'attributeGroup') {
        const k = qkey(c, c.getAttribute('ref'));
        const g = reg.attrGroups[k];
        if (g) collectAttrs(g, list, seen);
      } else if (c.localName === 'anyAttribute') {
        list.push({ n: '*', t: 'xs:string' });
      }
    }
  }

  // ---- particles
  function particle(node) {
    const o = occurs(node);
    switch (node.localName) {
      case 'element': {
        const ref = node.getAttribute('ref');
        const name = ref ? qkey(node, ref) : node.getAttribute('name');
        if (!ref) defineElement(name, node); // local element (rare)
        else ensureElement(name);
        return withOcc({ k: 'e', n: name }, o);
      }
      case 'sequence':
      case 'choice':
      case 'all': {
        const parts = kids(node).filter((c) => ['element', 'sequence', 'choice', 'group', 'any', 'all'].includes(c.localName)).map(particle);
        return withOcc({ k: node.localName === 'choice' ? 'c' : 's', a: parts }, o);
      }
      case 'group': {
        const k = qkey(node, node.getAttribute('ref'));
        if (!(k in out.groups)) {
          out.groups[k] = null; // guard
          const g = reg.groups[k];
          const inner = g ? kids(g).find((c) => ['sequence', 'choice', 'all'].includes(c.localName)) : null;
          out.groups[k] = inner ? particle(inner) : { k: 's', a: [] };
        }
        return withOcc({ k: 'g', n: k }, o);
      }
      case 'any':
        return withOcc({ k: 'a' }, o);
    }
    return { k: 's', a: [] };
  }

  function complexType(key, node) {
    if (key in out.types) return key;
    out.types[key] = null; // guard
    const ct = { mixed: node.getAttribute('mixed') === 'true' ? 1 : 0, c: null, a: [] };
    const seen = new Set();
    const sc = kids(node, 'simpleContent')[0];
    const cc = kids(node, 'complexContent')[0];
    if (sc) {
      ct.text = 1;
      const ext = kids(sc, 'extension')[0] || kids(sc, 'restriction')[0];
      if (ext) {
        const base = ext.getAttribute('base');
        if (base) {
          const bk = qkey(ext, base);
          ct.vt = bk.startsWith('xs:') ? (out.simple[bk] ??= { b: bk.slice(3) }, bk) : reg.types[bk] ? simpleType(bk, reg.types[bk]) : 'xs:string';
        }
        collectAttrs(ext, ct.a, seen);
      }
    } else if (cc) {
      if (cc.getAttribute('mixed') === 'true') ct.mixed = 1;
      const ext = kids(cc, 'extension')[0] || kids(cc, 'restriction')[0];
      if (ext) {
        const bk = qkey(ext, ext.getAttribute('base'));
        if (ext.localName === 'extension' && reg.types[bk]) {
          const bkey = complexType(bk, reg.types[bk]);
          const base = out.types[bkey];
          if (base) {
            ct.mixed = ct.mixed || base.mixed;
            ct.a.push(...base.a);
            base.a.forEach((a) => seen.add(a.n));
            ct.c = base.c;
          }
        }
        const p = kids(ext).find((c) => ['sequence', 'choice', 'all', 'group'].includes(c.localName));
        if (p) ct.c = ct.c ? { k: 's', a: [ct.c, particle(p)] } : particle(p);
        collectAttrs(ext, ct.a, seen);
      }
    } else {
      const p = kids(node).find((c) => ['sequence', 'choice', 'all', 'group'].includes(c.localName));
      if (p) ct.c = particle(p);
      collectAttrs(node, ct.a, seen);
    }
    out.types[key] = ct;
    return key;
  }

  function defineElement(name, node) {
    if (name in out.elements) return;
    out.elements[name] = null; // guard
    const t = node.getAttribute('type');
    const inlineCT = kids(node, 'complexType')[0];
    const inlineST = kids(node, 'simpleType')[0];
    if (t) {
      const k = qkey(node, t);
      if (k.startsWith('xs:')) {
        const tk = '#text:' + k;
        out.simple[k] ??= { b: k.slice(3) };
        out.types[tk] ??= k === 'xs:anyType' ? { mixed: 1, c: { k: 's', a: [{ k: 'a', m: 0, x: -1 }] }, a: [{ n: '*', t: 'xs:string' }] } : { mixed: 0, text: 1, vt: k, c: null, a: [] };
        out.elements[name] = tk;
      } else if (reg.types[k] && reg.types[k].localName === 'complexType') {
        out.elements[name] = complexType(k, reg.types[k]);
      } else if (reg.types[k]) {
        const sk = simpleType(k, reg.types[k]);
        const tk = '#text:' + sk;
        out.types[tk] ??= { mixed: 0, text: 1, vt: sk, c: null, a: [] };
        out.elements[name] = tk;
      } else {
        out.elements[name] = complexType('#' + name, node);
      }
    } else if (inlineCT) {
      out.elements[name] = complexType('#' + name, inlineCT);
    } else if (inlineST) {
      const sk = simpleType('#' + name, inlineST);
      const tk = '#text:' + sk;
      out.types[tk] ??= { mixed: 0, text: 1, vt: sk, c: null, a: [] };
      out.elements[name] = tk;
    } else {
      // anyType
      out.types['#any'] ??= { mixed: 1, c: { k: 's', a: [{ k: 'a', m: 0, x: -1 }] }, a: [{ n: '*', t: 'xs:string' }] };
      out.elements[name] = '#any';
    }
  }

  function ensureElement(name) {
    if (name in out.elements) return;
    const node = reg.elements[name];
    if (node) defineElement(name, node);
  }

  // Root: the documented root element, else every global element.
  const mainDoc = parseFile(path.join(issueDir, schemaName + '.xsd'));
  const docs = [...mainDoc.getElementsByTagNameNS(XS, 'documentation')].map((d) => d.textContent);
  const rootDoc = docs.find((d) => /^Root element:/i.test(d));
  out.root = rootDoc ? rootDoc.replace(/^Root element:\s*/i, '').trim() : null;
  for (const name of Object.keys(reg.elements)) ensureElement(name);
  // Drop recursion guards that never completed.
  for (const k of Object.keys(out.types)) if (out.types[k] == null) delete out.types[k];
  return out;
}

function main() {
  const issues = [...new Set([...Object.keys(SERVER_SETS), ...fs.readdirSync(schemaDir).filter((d) => d !== 'ent' && fs.statSync(path.join(schemaDir, d)).isDirectory())])]; // 'ent' holds entity files, not an issue
  const index = {};
  const skip = new Set(['xlink', 'rdf', 'dc', 'xml']);
  for (const issue of issues) {
    index[issue] = [];
    fs.mkdirSync(path.join(outDir, issue), { recursive: true });
    for (const f of fs.readdirSync(issueDirOf(issue))) {
      if (!f.endsWith('.xsd')) continue;
      const name = f.slice(0, -4);
      if (skip.has(name)) continue;
      const g = compileGrammar(issue, name);
      fs.writeFileSync(path.join(outDir, issue, name + '.json'), JSON.stringify(g));
      index[issue].push({ schema: name, root: g.root, elements: Object.keys(g.elements).length });
    }
    index[issue].sort((a, b) => a.schema.localeCompare(b.schema));
  }
  fs.writeFileSync(path.join(outDir, 'index.json'), JSON.stringify(index, null, 1));

  // Vendor xmllint wasm worker.
  const vend = path.join(root, 'public/vendor/xmllint');
  fs.mkdirSync(vend, { recursive: true });
  for (const f of ['xmllint-browser.mjs', 'xmllint.wasm', 'COPYING']) {
    fs.copyFileSync(path.join(root, 'node_modules/xmllint-wasm', f), path.join(vend, f));
  }
  console.log('Grammars written for issues:', issues.join(', '));
}

main();
