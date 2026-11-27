// WP-34 (GAP-009): the static half of the feature-preservation baseline. Reads the source (no build, no browser) and returns the
// front-end surface that a text scan can see: routes, test ids, the browser test titles, the unit and backend test files, and the keys that
// the editors handle in their own keydown handlers. The run-time half (the Studio command registry with its generated commands, the rail
// per project kind, the JSS/JSG shortcut registry) is dumped by src/parity/parity-dump.test.ts. scripts/parity/check.mjs puts both together.
//
// Every item has a stable `key`: the check compares keys. Anything that matters for "the feature is still there" (a route's permission
// condition, whether a path is a page or only a redirect) is part of the key, so a change shows as a removal that has to be explained.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT = path.resolve(FRONTEND, '..');
const SRC = path.join(FRONTEND, 'src');

const rel = (p) => path.relative(SRC, p).split(path.sep).join('/');
const read = (p) => fs.readFileSync(p, 'utf8');

function walk(dir, filter, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== '__fixtures__') walk(p, filter, out); }
    else if (filter(p)) out.push(p);
  }
  return out.sort();
}

// ---- routes --------------------------------------------------------------------------------------------------------------------
// The files that declare <Route>s and where their routes are mounted. A new file with routes that is not listed here fails the scan, so the
// map is kept up to date (otherwise its routes would be invisible to the baseline).
export const ROUTE_MOUNTS = {
  'App.tsx': '',
  'pages/Administrator.tsx': '/administrator',
  'pages/Settings.tsx': '/settings',
  'pages/project/ProjectSettingsPage.tsx': '/projects/:id/settings',
};

/** The end of a JSX tag that starts at `i` (the `<`): the first `>` outside braces. */
function tagEnd(text, i) {
  let depth = 0;
  for (let j = i; j < text.length; j++) {
    const ch = text[j];
    if (ch === '{') depth++;
    else if (ch === '}') depth--;
    else if (ch === '>' && depth === 0) return { end: j, selfClosing: text[j - 1] === '/' };
  }
  throw new Error(`unterminated <Route at ${i}`);
}

/** A string array constant `const NAME ... = [['a', ...], ...]` or `['a', 'b']`: the first string of each entry. */
function arrayIds(text, name) {
  const m = new RegExp(`const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\];`).exec(text);
  if (!m) return null;
  const pairs = [...m[1].matchAll(/\[\s*'([^']+)'/g)].map((x) => x[1]);
  return pairs.length ? pairs : [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

function lineOf(text, i) { return text.slice(0, i).split('\n').length; }

/** The condition a route is rendered under: `{cond ? <Route` or `{cond ? <>` wrapping it, on its own line or the fragment's. */
function conditionBefore(text, i, fragments) {
  const lineStart = text.lastIndexOf('\n', i) + 1;
  const before = text.slice(lineStart, i);
  const m = /\{\s*([^{}?]+?)\s*\?\s*(?:<>\s*)?$/.exec(before);
  if (m) return m[1].trim();
  for (const f of fragments) if (i > f.start && i < f.end) return f.cond;
  return '';
}

export function scanRoutes() {
  const files = walk(SRC, (p) => /\.tsx$/.test(p) && !/\.test\./.test(p)).filter((p) => /<Route[\s>]/.test(read(p)));
  const unknown = files.map(rel).filter((f) => !(f in ROUTE_MOUNTS));
  if (unknown.length) throw new Error(`parity scan: <Route> declared in ${unknown.join(', ')}, which scripts/parity/scan.mjs ROUTE_MOUNTS does not list`);
  const items = [];
  for (const f of Object.keys(ROUTE_MOUNTS)) {
    const text = read(path.join(SRC, f));
    // conditional fragments: `{isAdmin ? <> ... </> : null}`
    const fragments = [];
    for (const m of text.matchAll(/\{\s*([^{}?]+?)\s*\?\s*<>/g)) {
      const close = text.indexOf('</>', m.index);
      fragments.push({ start: m.index, end: close < 0 ? text.length : close, cond: m[1].trim() });
    }
    const stack = [ROUTE_MOUNTS[f]];
    const re = /<Route\b|<\/Route>/g; let m;
    while ((m = re.exec(text))) {
      if (m[0] === '</Route>') { stack.pop(); continue; }
      const { end, selfClosing } = tagEnd(text, m.index);
      const tag = text.slice(m.index, end + 1);
      const parent = stack[stack.length - 1];
      const index = /\sindex[\s/>]/.test(tag);
      const lit = /\spath="([^"]*)"/.exec(tag);
      const nav = /<Navigate\s+to=(?:"([^"]*)"|\{[`']([^`']*)[`']\})/.exec(tag);
      const cond = conditionBefore(text, m.index, fragments);
      let paths;
      if (!index && !/\spath=/.test(tag)) {                               // a layout route (no path): its children sit at the parent's path
        if (!selfClosing) stack.push(parent);
        continue;
      }
      if (index) paths = [''];
      else if (lit) paths = [lit[1]];
      else {
        const dyn = /\spath=\{(\w+)\}/.exec(tag);
        const lineStart = text.lastIndexOf('\n', m.index) + 1;
        const mapM = /(\w+)\.map\(\(\[(\w+)\]\)\s*=>\s*$/.exec(text.slice(lineStart, m.index));
        const ids = dyn && mapM && mapM[2] === dyn[1] ? arrayIds(text, mapM[1]) : null;
        if (!ids) throw new Error(`parity scan: a computed route path in ${f}:${lineOf(text, m.index)} that the scan cannot expand`);
        paths = ids;
      }
      for (const p of paths) {
        const full = p === '*' ? `${parent}/*` : (index ? (parent || '/') : `${parent}/${p}`.replace(/\/+/g, '/'));
        const kind = nav ? 'redirect' : 'page';
        const key = `${full}${kind === 'redirect' ? ` -> ${nav[1] ?? nav[2]}` : ''}${cond ? ` [if ${cond}]` : ''}`;
        items.push({ key, path: full, kind, ...(nav ? { to: nav[1] ?? nav[2] } : {}), ...(cond ? { condition: cond } : {}), ...(index ? { index: true } : {}), file: f, line: lineOf(text, m.index) });
      }
      if (!selfClosing) stack.push(lit ? `${parent}/${lit[1]}`.replace(/\/+/g, '/') : parent);
    }
  }
  return dedupe(items);
}

// ---- test ids --------------------------------------------------------------------------------------------------------------------
const TESTID_LITERAL = [
  /data-testid="([^"]+)"/g,                                        // JSX attribute
  /data-testid=\{\s*'([^']+)'\s*\}/g,                              // JSX attribute, string expression
  /'data-testid':\s*'([^']+)'/g,                                   // h('div', { 'data-testid': 'x' })
  /setAttribute\(\s*'data-testid',\s*'([^']+)'\s*\)/g,             // el.setAttribute('data-testid', 'x')
  /\.dataset\.testid\s*=\s*'([^']+)'/g,
];
const TESTID_COMPUTED = [/data-testid=\{(?!\s*'[^']+'\s*\})/g, /'data-testid':\s*(?!')/g, /setAttribute\(\s*'data-testid',\s*(?!')/g, /\.dataset\.testid\s*=\s*(?!')/g];

export function scanTestIds() {
  const files = walk(SRC, (p) => /\.(tsx?|mts)$/.test(p) && !/\.test\.|\.d\.ts$/.test(p) && !p.includes(`${path.sep}parity${path.sep}`));
  const byId = new Map(); const computed = {};
  let auditScope = { files: 0, literal: 0 };                         // the audit's scan: .tsx under components/layouts/pages, `data-testid="..."` only
  for (const p of files) {
    const text = read(p); const f = rel(p);
    if (/^(components|layouts|pages)\//.test(f) && f.endsWith('.tsx')) {
      auditScope.files++;
      auditScope.literal += new Set([...text.matchAll(/data-testid="([^"]+)"/g)].map((m) => m[1])).size;
    }
    for (const re of TESTID_LITERAL) for (const m of text.matchAll(re)) {
      if (!byId.has(m[1])) byId.set(m[1], new Set());
      byId.get(m[1]).add(f);
    }
    const n = TESTID_COMPUTED.reduce((s, re) => s + [...text.matchAll(re)].length, 0);
    if (n) computed[f] = n;
  }
  const items = [...byId.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, fs_]) => ({ key: id, files: [...fs_].sort() }));
  return { items, computed, auditScope };
}

// ---- tests ---------------------------------------------------------------------------------------------------------------------------
export function scanTests() {
  const items = [];
  const e2e = path.join(FRONTEND, 'e2e');
  for (const p of walk(e2e, (x) => x.endsWith('.spec.ts'))) {
    const text = read(p); const spec = path.relative(e2e, p).split(path.sep).join('/');
    const seen = new Map();
    for (const m of text.matchAll(/(?<![\w.])test(?:\.(?:only|fail|slow))?\(\s*(['"`])((?:\\.|(?!\1)[\s\S])*?)\1\s*,/g)) {
      const title = m[2].replace(/\s+/g, ' ');
      const n = (seen.get(title) ?? 0) + 1; seen.set(title, n);
      items.push({ key: `e2e ${spec} > ${title}${n > 1 ? ` #${n}` : ''}`, kind: 'e2e', spec, line: lineOf(text, m.index) });
    }
  }
  for (const p of walk(SRC, (x) => x.endsWith('.test.ts'))) items.push({ key: `unit ${rel(p)}`, kind: 'unit' });
  const bt = path.join(ROOT, 'backend', 'test');
  if (fs.existsSync(bt)) for (const p of walk(bt, (x) => x.endsWith('.test.js'))) items.push({ key: `backend ${path.relative(bt, p).split(path.sep).join('/')}`, kind: 'backend' });
  return dedupe(items);
}

// ---- keys handled outside the Studio registry ---------------------------------------------------------------------------------------
// The files whose keydown handlers the audit listed (baseline/studio-commands.md). The scan records which key names each file compares
// against; src/lib/editorShortcuts.test.ts holds the JSS/JSG registry to the same scan, so a key added to or removed from a handler without
// the registry fails there.
export const KEY_HANDLER_FILES = [
  'jss/editor.ts', 'jss/dom.ts', 'jsg/editor.ts', 'jsg/ispl-editor.ts', 'jsg/shared.ts', 'studio/ui/app.ts', 'pages/project/EditorPage.tsx',
];

// A compared value is taken as a key only when it looks like one (a variable such as `k` is also used for other things in these files).
const KEYLIKE = /^(?:(?:Mod|Ctrl|Shift|Alt|Meta)\+)*(?:[A-Za-z0-9=,.\-]| |Escape|Enter|Tab|Backspace|Delete|Insert|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right)|F\d{1,2}|Space)$/i;

export function handlerKeys(text) {
  const keys = new Set();
  const add = (k) => { if (KEYLIKE.test(k)) keys.add(k === ' ' ? 'Space' : k); };
  for (const m of text.matchAll(/\b(?:e|ev|event)\.key\s*===\s*'([^']+)'/g)) add(m[1]);
  for (const m of text.matchAll(/\b(?:e|ev|event)\.key\.toLowerCase\(\)\s*===\s*'([^']+)'/g)) add(m[1]);
  for (const m of text.matchAll(/\bk\s*===\s*'([^']*)'/g)) add(m[1]);
  for (const m of text.matchAll(/\[((?:\s*'[A-Z][A-Za-z]+'\s*,?)+)\]\.includes\((?:e|ev)\.key\)/g)) for (const k of m[1].matchAll(/'([^']+)'/g)) add(k[1]);
  for (const m of text.matchAll(/\b(?:e|ev)\.code\s*===\s*'([^']+)'/g)) keys.add(`code:${m[1]}`);
  return [...keys].sort();
}

export function scanHandlerKeys() {
  const items = [];
  for (const f of KEY_HANDLER_FILES) {
    const p = path.join(SRC, f);
    if (!fs.existsSync(p)) continue;
    for (const k of handlerKeys(read(p))) items.push({ key: `handler ${f} ${k}`, file: f, keyName: k });
  }
  return items;
}

function dedupe(items) {
  const seen = new Map();
  return items.map((it) => { const n = (seen.get(it.key) ?? 0) + 1; seen.set(it.key, n); return n > 1 ? { ...it, key: `${it.key} #${n}` } : it; });
}

/** The test ids no browser spec mentions: controls with no browser guard (the "guard gap" of the checklist). */
export function testidsWithoutBrowserTest(ids) {
  const e2e = path.join(FRONTEND, 'e2e');
  const text = walk(e2e, (x) => /\.(ts|mjs)$/.test(x)).map(read).join('\n');
  return ids.filter((id) => !text.includes(id));
}

export function staticSurface() {
  const testids = scanTestIds();
  return {
    routes: scanRoutes(),
    testids: testids.items,
    tests: scanTests(),
    handlerKeys: scanHandlerKeys(),
    info: {
      testidsComputedPerFile: testids.computed, auditScopeTestids: testids.auditScope,
      testidsWithoutBrowserTest: testidsWithoutBrowserTest(testids.items.map((i) => i.key)),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(staticSurface(), null, 2)}\n`);
}
