// WP-36 (CLN-001..CLN-004): the dead-code and removal-completeness scan of the front end. No build, no browser: it parses the sources with
// the TypeScript compiler (comments are not references) and reads the stylesheets.
//
// Three dead-code counts, each reported item by item and held at zero outside a reasoned allow-list (allowlist.json):
//   files     a source file that nothing imports (static, dynamic `import()`, `new URL(..., import.meta.url)`, CSS `@import`), starting from
//             src/main.tsx; a file reached only from tests is "test-only" (kept); an ambient `.d.ts` (no import/export of its own, or only
//             `declare module`) is picked up by the compiler without an import and is always kept
//   exports   an exported name that appears nowhere: not in another file (src, e2e, scripts, configs; identifiers and the words of string
//             literals, so `window.studio.<name>` in a test string counts) and not in its own file beyond the declaration itself
//   classes   a CSS class defined in src/**/*.css that no non-test source names: the words of string and template literals in src (JSX
//             className, classList, the DOM-built Studio/JSS/JSG editors) and in backend/src (HTML built by the server). A template or a
//             concatenation that ends in `prefix-` (`x-${name}`, 'sev-' + s) keeps every class with that prefix: those are generated
//   deps      a runtime dependency (package.json `dependencies`) that no source, test, script or config file imports (devDependencies are
//             tools that configs and scripts load by name, so they are not counted)
//
// The removal-completeness check (removed-features.json): for every feature the owner removed, the files that made it must stay deleted,
// and its identifiers, its strings (endpoints, test ids, labels), its CSS class prefixes and its rail labels must not come back in the
// non-test source; the server routes it used are kept by the owner's rule, so each must stay listed in docs/API-ONLY-ROUTES.md (a route
// that is kept but not accounted for is the debris CLN-004 describes). Routes and redirects of the removed screens are checked by the
// parity check (scripts/parity/check.mjs, removedByOwner).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

export const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const ROOT = path.resolve(FRONTEND, '..');

const CODE = /\.(ts|tsx|mts|js|mjs|jsx)$/;
const posix = (p) => p.split(path.sep).join('/');

function walk(dir, filter, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!['node_modules', 'dist', '__fixtures__'].includes(e.name) && !e.name.startsWith('.')) walk(p, filter, out); }
    else if (filter(p)) out.push(p);
  }
  return out.sort();
}

/** A test file, or a file that only tests use by design (the render harness). */
export const isTestFile = (rel) => /\.test\.(tsx?|mjs|js)$/.test(rel) || /(^|\/)__tests__\//.test(rel) || /(^|\/)testing\//.test(rel) || /(^|\/)e2e\//.test(rel);

// ---- parsing --------------------------------------------------------------------------------------------------------------------------
const parsed = new Map();
/** Identifiers (with counts), string/template literal texts, and the module specifiers of one code file. Comments are never seen. */
export function parseCode(file, text = fs.readFileSync(file, 'utf8')) {
  const key = `${file}\0${text.length}`;
  if (parsed.has(key)) return parsed.get(key);
  const kind = file.endsWith('.tsx') || file.endsWith('.jsx') ? ts.ScriptKind.TSX : /\.(m?js)$/.test(file) ? ts.ScriptKind.JS : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const ids = new Map(); const strings = []; const specifiers = []; const prefixes = [];
  const visit = (n) => {
    if (ts.isIdentifier(n) || ts.isPrivateIdentifier(n)) ids.set(n.text, (ids.get(n.text) ?? 0) + 1);
    else if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) strings.push(n.text);
    else if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) strings.push(n.text);
    else if (ts.isJsxText(n)) strings.push(n.text);
    // a generated class: a template part or a concatenated string that ends in `name-` right before the substitution
    if ((ts.isTemplateHead(n) || ts.isTemplateMiddle(n)) || (ts.isStringLiteral(n) && ts.isBinaryExpression(n.parent) && n.parent.left === n && n.parent.operatorToken.kind === ts.SyntaxKind.PlusToken)) {
      const m = /(?:^|[\s"'.])(-?[A-Za-z_][\w-]*-)$/.exec(n.text);
      if (m && m[1].length >= 2) prefixes.push(m[1]);
    }
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) specifiers.push(n.moduleSpecifier.text);
    if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] && ts.isStringLiteralLike(n.arguments[0])) specifiers.push(n.arguments[0].text);
    if (ts.isImportTypeNode(n) && ts.isLiteralTypeNode(n.argument) && ts.isStringLiteral(n.argument.literal)) specifiers.push(n.argument.literal.text);
    if (ts.isNewExpression(n) && ts.isIdentifier(n.expression) && n.expression.text === 'URL' && n.arguments?.length === 2 && ts.isStringLiteralLike(n.arguments[0]) && /import\.meta\.url/.test(n.arguments[1].getText(sf))) specifiers.push(n.arguments[0].text);
    ts.forEachChild(n, visit);
  };
  visit(sf);
  const out = { sf, ids, strings, specifiers, prefixes };
  parsed.set(key, out);
  return out;
}

/** The names a module exports (default and `export *` are not names a search can find, so they are left out). */
export function exportedNames(sf) {
  const names = [];
  const has = (n) => ts.canHaveModifiers(n) && (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (n) => (ts.getModifiers(n) ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);
  for (const st of sf.statements) {
    const line = sf.getLineAndCharacterOfPosition(st.getStart(sf)).line + 1;
    if (ts.isExportDeclaration(st) && st.exportClause && ts.isNamedExports(st.exportClause)) {
      for (const el of st.exportClause.elements) names.push({ name: el.name.text, kind: 'reexport', line, typeOnly: st.isTypeOnly || el.isTypeOnly });
      continue;
    }
    if (!has(st) || isDefault(st)) continue;
    if (ts.isVariableStatement(st)) for (const d of st.declarationList.declarations) { if (ts.isIdentifier(d.name)) names.push({ name: d.name.text, kind: 'const', line, typeOnly: false }); }
    else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name) names.push({ name: st.name.text, kind: ts.isFunctionDeclaration(st) ? 'function' : 'class', line, typeOnly: false });
    else if (ts.isInterfaceDeclaration(st) || ts.isTypeAliasDeclaration(st)) names.push({ name: st.name.text, kind: 'type', line, typeOnly: true });
    else if (ts.isEnumDeclaration(st)) names.push({ name: st.name.text, kind: 'enum', line, typeOnly: false });
  }
  // an overloaded function is declared more than once: one name
  const seen = new Set();
  return names.filter((n) => (seen.has(n.name) ? false : (seen.add(n.name), true)));
}

/** Class names defined by a stylesheet: the selectors only (preludes before `{`), never values such as `url(a.png)` or `0.5em`. */
export function cssClasses(text) {
  const src = text.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, ' '));     // blanked, so the line numbers stay
  const out = new Map();
  let start = 0;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '{') {
      const prelude = src.slice(start, i);
      if (!/^\s*@(?:font-face|keyframes|-webkit-keyframes|property|page)\b/.test(prelude)) {
        for (const m of prelude.replace(/"[^"]*"|'[^']*'/g, ' ').matchAll(/\.(-?[A-Za-z_][\w-]*)/g)) {
          if (/^\s*@/.test(prelude) && !/^\s*@(?:media|supports|container|layer)\b/.test(prelude)) continue;
          if (!out.has(m[1])) out.set(m[1], src.slice(0, start + m.index).split('\n').length);
        }
      }
      start = i + 1;
    } else if (ch === '}' || ch === ';') start = i + 1;
  }
  return out;
}

/** The source text without its comments (printed back by the compiler), for patterns over code. */
const printer = ts.createPrinter({ removeComments: true });
const codeOnly = (sf) => printer.printFile(sf);

/** The CSS files a stylesheet imports. */
const cssImports = (text) => [...text.replace(/\/\*[\s\S]*?\*\//g, ' ').matchAll(/@import\s+(?:url\(\s*)?['"]?([^'")\s;]+)/g)].map((m) => m[1]);

/** An ambient declaration file: the compiler includes it without an import. */
export function isAmbient(file, text = fs.readFileSync(file, 'utf8')) {
  if (!file.endsWith('.d.ts')) return false;
  const { sf } = parseCode(file, text);
  const isModule = sf.statements.some((st) => ts.isImportDeclaration(st) || ts.isExportDeclaration(st) || ts.isExportAssignment(st));
  return !isModule || sf.statements.some((st) => ts.isModuleDeclaration(st) && ts.isStringLiteral(st.name));
}

function resolveSpecifier(fromFile, spec, known) {
  if (!spec.startsWith('.') && !spec.startsWith('/')) return null;                  // a package
  const clean = spec.replace(/[?#].*$/, '');
  const base = spec.startsWith('/') ? path.join(FRONTEND, clean) : path.resolve(path.dirname(fromFile), clean);
  for (const c of [base, ...['.ts', '.tsx', '.d.ts', '.js', '.mjs', '.css', '.json'].map((x) => base + x), ...['index.ts', 'index.tsx', 'index.js'].map((x) => path.join(base, x))]) {
    if (known.has(c)) return c;
  }
  return null;
}

// ---- the scan -------------------------------------------------------------------------------------------------------------------------
/**
 * @param {object} [o]
 * @param {string} [o.frontend]  the front-end root (tests point it at a fixture)
 * @param {string} [o.root]      the repository root (backend/src, docs)
 * @param {string[]} [o.entries] entry files relative to the front end
 */
export function scanDeadCode(o = {}) {
  const fe = o.frontend ?? FRONTEND; const root = o.root ?? path.resolve(fe, '..');
  const src = path.join(fe, 'src');
  const rel = (p) => posix(path.relative(fe, p));
  const srcFiles = walk(src, (p) => CODE.test(p) || p.endsWith('.css'));
  const known = new Set(srcFiles);
  const otherCode = [
    ...walk(path.join(fe, 'e2e'), (p) => CODE.test(p)),
    ...walk(path.join(fe, 'scripts'), (p) => CODE.test(p)),
    ...walk(path.join(fe, 'test-support'), (p) => CODE.test(p)),
    ...fs.readdirSync(fe).filter((f) => CODE.test(f)).map((f) => path.join(fe, f)),
  ];
  const backendCode = walk(path.join(root, 'backend', 'src'), (p) => CODE.test(p));
  const backendTests = walk(path.join(root, 'backend', 'test'), (p) => CODE.test(p));

  // -- files: reachability from the entries; a test is a second root set
  const entries = (o.entries ?? ['src/main.tsx']).map((e) => path.join(fe, e)).filter((e) => known.has(e));
  const edges = new Map();
  for (const f of srcFiles) {
    const specs = f.endsWith('.css') ? cssImports(fs.readFileSync(f, 'utf8')) : parseCode(f).specifiers;
    edges.set(f, specs.map((s) => resolveSpecifier(f, s, known)).filter(Boolean));
  }
  const reach = (roots) => { const seen = new Set(); const stack = [...roots]; while (stack.length) { const f = stack.pop(); if (seen.has(f)) continue; seen.add(f); for (const t of edges.get(f) ?? []) stack.push(t); } return seen; };
  const fromApp = reach(entries);
  const fromTests = reach(srcFiles.filter((f) => isTestFile(rel(f))));
  // a front-end file that a backend test or a script names by path is used by that script (accent.test, scripts/parity)
  const mentions = [...otherCode, ...backendCode, ...backendTests].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const files = []; const filesTestOnly = []; const filesAmbient = [];
  for (const f of srcFiles) {
    const r = rel(f);
    if (fromApp.has(f) || isTestFile(r)) continue;
    if (isAmbient(f)) { filesAmbient.push(r); continue; }
    if (fromTests.has(f)) { filesTestOnly.push(r); continue; }
    if (mentions.includes(r.replace(/^src\//, '').replace(/\.(tsx?|mjs|js)$/, ''))) { filesTestOnly.push(r); continue; }
    files.push(r);
  }

  // -- exports: name searched in every other file and in its own beyond the declaration
  const codeFiles = [...srcFiles.filter((f) => !f.endsWith('.css')), ...otherCode];
  const wordFiles = new Map();                              // word -> Map(file -> count) over identifiers and string-literal words
  const add = (w, f, n = 1) => { let m = wordFiles.get(w); if (!m) wordFiles.set(w, (m = new Map())); m.set(f, (m.get(f) ?? 0) + n); };
  for (const f of codeFiles) {
    const p = parseCode(f);
    for (const [w, n] of p.ids) add(w, f, n);
    for (const s of p.strings) for (const w of s.split(/[^A-Za-z0-9_$]+/)) if (w) add(w, f);
  }
  const exportsDead = []; let exportsTestOnly = 0; let exportsOwnFileOnly = 0;
  for (const f of srcFiles) {
    const r = rel(f);
    if (f.endsWith('.css') || f.endsWith('.d.ts') || isTestFile(r)) continue;
    for (const e of exportedNames(parseCode(f).sf)) {
      const where = wordFiles.get(e.name) ?? new Map();
      const own = where.get(f) ?? 0;
      const others = [...where.keys()].filter((x) => x !== f);
      if (others.length === 0 && own <= 1) exportsDead.push({ file: r, name: e.name, kind: e.kind, line: e.line });
      else if (others.length === 0) exportsOwnFileOnly++;
      else if (others.every((x) => isTestFile(rel(x)) || !x.startsWith(src))) exportsTestOnly++;
    }
  }

  // -- CSS classes
  const defined = new Map();                                // class -> [{file, line}]
  for (const f of srcFiles.filter((x) => x.endsWith('.css'))) {
    for (const [c, line] of cssClasses(fs.readFileSync(f, 'utf8'))) { if (!defined.has(c)) defined.set(c, []); defined.get(c).push({ file: rel(f), line }); }
  }
  const used = new Set(); const prefixes = new Map();      // prefix -> first file that builds it
  const usageFiles = [...srcFiles.filter((f) => !f.endsWith('.css') && !isTestFile(rel(f))), ...backendCode];
  for (const f of usageFiles) {
    const p = parseCode(f);
    for (const s of p.strings) for (const w of s.split(/[^A-Za-z0-9_-]+/)) if (w) used.add(w);
    for (const x of p.prefixes) if (!prefixes.has(x)) prefixes.set(x, posix(path.relative(root, f)));
  }
  for (const h of [path.join(fe, 'index.html'), ...walk(path.join(fe, 'public'), (p) => /\.(html|js)$/.test(p) && fs.statSync(p).size < 512 * 1024)]) {
    if (fs.existsSync(h)) for (const w of fs.readFileSync(h, 'utf8').split(/[^A-Za-z0-9_-]+/)) if (w) used.add(w);
  }
  const classesDead = []; const classesGenerated = [];
  for (const [c, where] of [...defined].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (used.has(c)) continue;
    const pre = [...prefixes.keys()].find((x) => c.startsWith(x));
    if (pre) { classesGenerated.push({ name: c, prefix: pre }); continue; }
    classesDead.push({ name: c, ...where[0] });
  }

  // -- runtime dependencies (package.json `dependencies`) that no source or config file imports
  const pkgFile = path.join(fe, 'package.json');
  const runtimeDeps = fs.existsSync(pkgFile) ? Object.keys(JSON.parse(fs.readFileSync(pkgFile, 'utf8')).dependencies ?? {}) : [];
  const imported = new Set();
  // the page also bundles backend/src/shared (the co-editing schema and protocol, the JSS/JSG serialisers): vite.config.ts resolves (dedupes)
  // the packages those files import from the frontend's own dependencies, so they count as the frontend's imports (lib0: the wire protocol)
  const sharedDir = path.join(root, 'backend', 'src', 'shared');
  const sharedCode = fs.existsSync(sharedDir) ? walk(sharedDir, (f) => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) : [];
  for (const f of [...codeFiles, ...sharedCode]) for (const s of parseCode(f).specifiers) if (!s.startsWith('.') && !s.startsWith('/')) imported.add(s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0]);
  const deps = runtimeDeps.filter((d) => !imported.has(d));

  return {
    counts: { sourceFiles: srcFiles.length, classesDefined: defined.size, exportsTestOnly, exportsOwnFileOnly, classesGenerated: classesGenerated.length },
    files, filesTestOnly, filesAmbient, exports: exportsDead, classes: classesDead, classesGenerated, prefixes: Object.fromEntries(prefixes), deps,
  };
}

/** Applies the allow-list: `{ files: [{file, reason}], exports: [{file, name, reason}], classes: [{name | pattern, reason}] }`. */
export function applyAllowList(scan, allow) {
  const reasonOK = (x) => typeof x.reason === 'string' && x.reason.trim().length >= 10;
  const problems = [];
  for (const k of ['files', 'exports', 'classes', 'deps']) for (const x of allow[k] ?? []) if (!reasonOK(x)) problems.push(`allow-list ${k}: an entry without a reason (${JSON.stringify(x)})`);
  const classAllowed = (c) => (allow.classes ?? []).find((a) => (a.name && a.name === c) || (a.pattern && new RegExp(a.pattern).test(c)));
  const fileAllowed = (f) => (allow.files ?? []).find((a) => a.file === f);
  const exportAllowed = (e) => (allow.exports ?? []).find((a) => a.file === e.file && a.name === e.name);
  const out = {
    files: scan.files.filter((f) => !fileAllowed(f)),
    exports: scan.exports.filter((e) => !exportAllowed(e)),
    classes: scan.classes.filter((c) => !classAllowed(c.name)),
    deps: (scan.deps ?? []).filter((d) => !(allow.deps ?? []).some((a) => a.name === d)),
  };
  const stale = [
    ...(allow.files ?? []).filter((a) => !scan.files.includes(a.file)).map((a) => `file ${a.file}`),
    ...(allow.exports ?? []).filter((a) => !scan.exports.some((e) => e.file === a.file && e.name === a.name)).map((a) => `export ${a.file}::${a.name}`),
    ...(allow.classes ?? []).filter((a) => a.name && !scan.classes.some((c) => c.name === a.name)).map((a) => `class ${a.name}`),
  ];
  stale.push(...(allow.deps ?? []).filter((a) => !(scan.deps ?? []).includes(a.name)).map((a) => `dependency ${a.name}`));
  return { ...out, allowed: { files: scan.files.length - out.files.length, exports: scan.exports.length - out.exports.length, classes: scan.classes.length - out.classes.length, deps: (scan.deps ?? []).length - out.deps.length }, stale, problems };
}

// ---- removal completeness ---------------------------------------------------------------------------------------------------------------
/**
 * @param {Array<object>} features  removed-features.json `features`
 * @returns {string[]} one line per piece of debris
 */
export function scanRemovalDebris(features, o = {}) {
  const fe = o.frontend ?? FRONTEND; const root = o.root ?? path.resolve(fe, '..');
  const rel = (p) => posix(path.relative(fe, p));
  const src = path.join(fe, 'src');
  const code = walk(src, (p) => CODE.test(p) && !isTestFile(rel(p)) && !p.endsWith('.d.ts'));
  const css = walk(src, (p) => p.endsWith('.css'));
  const idsBy = code.map((f) => ({ f: rel(f), p: parseCode(f) }));
  const apiOnly = fs.existsSync(path.join(root, 'docs', 'API-ONLY-ROUTES.md')) ? fs.readFileSync(path.join(root, 'docs', 'API-ONLY-ROUTES.md'), 'utf8') : '';
  const out = [];
  for (const ft of features) {
    const allowed = (file, what) => (ft.allow ?? []).some((a) => a.file === file && a.text === what);
    for (const f of ft.files ?? []) if (fs.existsSync(path.join(fe, f))) out.push(`${ft.feature}: the file ${f} is back`);
    for (const { f, p } of idsBy) {
      for (const id of ft.identifiers ?? []) if (p.ids.has(id) && !allowed(f, id)) out.push(`${ft.feature}: identifier \`${id}\` in ${f}`);
      for (const s of ft.strings ?? []) if (p.strings.some((x) => x.includes(s)) && !allowed(f, s)) out.push(`${ft.feature}: the string "${s}" in ${f}`);
      for (const s of ft.exactStrings ?? []) if (p.strings.some((x) => x.trim() === s) && !allowed(f, s)) out.push(`${ft.feature}: the string "${s}" in ${f}`);
      if (ft.codePatterns?.length) {
        const text = codeOnly(p.sf);
        for (const re of ft.codePatterns) if (new RegExp(re).test(text) && !allowed(f, re)) out.push(`${ft.feature}: code matching /${re}/ in ${f}`);
      }
    }
    for (const f of css) {
      const classes = cssClasses(fs.readFileSync(f, 'utf8'));
      for (const pre of ft.classPrefixes ?? []) for (const c of classes.keys()) if (c.startsWith(pre)) out.push(`${ft.feature}: CSS class .${c} in ${rel(f)}`);
    }
    if (ft.railLabels?.length) {
      const rail = idsBy.find((x) => x.f === 'src/layouts/projectRail.ts');
      for (const l of ft.railLabels) if (rail?.p.strings.includes(l)) out.push(`${ft.feature}: rail item "${l}"`);
    }
    for (const r of ft.keptRoutes ?? []) if (!apiOnly.includes(r)) out.push(`${ft.feature}: the kept server route \`${r}\` is not listed in docs/API-ONLY-ROUTES.md`);
  }
  return out;
}
