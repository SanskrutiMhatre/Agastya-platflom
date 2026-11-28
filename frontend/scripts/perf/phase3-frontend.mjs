#!/usr/bin/env node
// Phase 3 frontend performance baseline (docs/phase3/perf-baseline.md): what the browser pays, measured on the reference browser (Edge, D18).
//
//   node scripts/perf/phase3-frontend.mjs [--port 4302] [--channel msedge] [--out FILE.json] [--md FILE.md] [--switches 10] [--headed]
//
// Build first with a manifest so the chunks can be named:  npx vite build --manifest   (the server serves frontend/dist)
//
//   bundle       every chunk of dist/.vite/manifest.json (raw and gzip -9), which ones index.html loads at once, the lazy route chunks
//   first load   overview, project home, and each editor (S1000D Studio, JSS sheet, JSG editor), cold (a new browser profile) and warm (the
//                same profile again): LCP, long tasks (count, total, longest), DOMContentLoaded, load, bytes transferred, until the page's
//                ready element shows
//   interaction  in each editor, via the Event Timing API (the INP measure: the longest input-to-next-paint of each interaction, >= 16 ms):
//                typing 30 characters, opening a module / outline item, switching modules, the panel toggles, Quick preview (with the time
//                until the draft is drawn); plus the wall time from the action to its visible result
//   memory       JS heap, DOM nodes and listeners (CDP, after a forced GC) before and after `--switches` module switches in the Studio
//
// The real server (backend/dist) runs in a child process on --port with a throwaway workspace. Never 4040/4041/4050/4060/4061.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, request as pwRequest } from '@playwright/test';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND = path.resolve(HERE, '..', '..'); const ROOT = path.resolve(FRONTEND, '..'); const BACKEND = path.join(ROOT, 'backend');
const argv = process.argv.slice(2);
const opt = (k, d) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : d; };
const PORT = Number(opt('port', 4302)); const CHANNEL = opt('channel', 'msedge'); const OUT = opt('out', ''); const MD = opt('md', '');
const SWITCHES = Number(opt('switches', 10)); const HEADED = argv.includes('--headed');
if ([4040, 4041, 4050, 4060, 4061].includes(PORT)) { console.error(`port ${PORT} belongs to another run`); process.exit(2); }
const BASE = `http://localhost:${PORT}`; const PW = 'Correct-Horse-9!';
const DIST = path.join(FRONTEND, 'dist');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const r1 = (v) => Math.round(v * 10) / 10;
const stats = (xs) => { if (!xs.length) return { n: 0 }; const s = [...xs].sort((a, b) => a - b); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, median: r1(q(0.5)), p75: r1(q(0.75)), p95: r1(q(0.95)), max: r1(s[s.length - 1]) }; };

// ---- bundle ---------------------------------------------------------------------------------------------------------------------------
function bundle() {
  const gz = (b) => zlib.gzipSync(b, { level: 9 }).length;
  const html = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
  const initialRefs = new Set();
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) initialRefs.add(m[1].replace(/^\//, ''));
  for (const m of html.matchAll(/<link\b[^>]*\brel="(?:modulepreload|stylesheet)"[^>]*\bhref="([^"]+)"/g)) initialRefs.add(m[1].replace(/^\//, ''));
  const mf = path.join(DIST, '.vite', 'manifest.json');
  const manifest = fs.existsSync(mf) ? JSON.parse(fs.readFileSync(mf, 'utf8')) : null;
  const chunks = [];
  const seen = new Set();
  const add = (file, src, kind) => {
    if (seen.has(file) || !fs.existsSync(path.join(DIST, file))) return; seen.add(file);
    const b = fs.readFileSync(path.join(DIST, file));
    chunks.push({ file, src: src ?? null, kind, raw: b.length, gzip: gz(b), initial: initialRefs.has(file) });
  };
  if (manifest) {
    for (const [src, e] of Object.entries(manifest)) {
      add(e.file, src, e.isEntry ? 'entry' : e.isDynamicEntry ? 'lazy' : 'shared');
      for (const c of e.css ?? []) add(c, src, 'css');
    }
  }
  for (const f of fs.readdirSync(path.join(DIST, 'assets'))) if (/\.(js|css)$/.test(f)) add(`assets/${f}`, null, f.endsWith('.css') ? 'css' : 'other');
  chunks.sort((a, b) => b.gzip - a.gzip);
  const sum = (xs, k) => xs.reduce((s, x) => s + x[k], 0);
  const initial = chunks.filter((c) => c.initial);
  return { manifest: !!manifest, chunks: chunks.length, totalRaw: sum(chunks, 'raw'), totalGzip: sum(chunks, 'gzip'), initialRaw: sum(initial, 'raw'), initialGzip: sum(initial, 'gzip'), initialFiles: initial.map((c) => c.file), largest: chunks.slice(0, 25) };
}

// ---- server ---------------------------------------------------------------------------------------------------------------------------
function startServer() {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'agastya-p3fe-'));
  const env = { ...process.env, PORT: String(PORT), AGASTYA_HOST: '127.0.0.1', AGASTYA_WORKSPACE_DIR: ws, AGASTYA_CLIENT_DIST: DIST, AGASTYA_SHUTDOWN_ON_STDIN_CLOSE: '1' };
  const child = spawn(process.execPath, [path.join(BACKEND, 'dist', 'index.js')], { cwd: BACKEND, env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  const log = []; child.stdout.on('data', (d) => log.push(String(d))); child.stderr.on('data', (d) => log.push(String(d)));
  return { child, ws, log };
}
async function waitHealthy() {
  for (let i = 0; i < 240; i++) { try { const r = await fetch(`${BASE}/api/health`); if (r.ok) return; } catch { /* not yet */ } await sleep(250); }
  throw new Error('server did not start');
}
async function stopServer(s) {
  await new Promise((resolve) => { s.child.on('exit', resolve); try { s.child.stdin.end(); } catch { resolve(); } setTimeout(() => { try { s.child.kill(); } catch { /* gone */ } resolve(); }, 20_000).unref(); });
  try { fs.rmSync(s.ws, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* held */ }
}

// ---- in-page probes -------------------------------------------------------------------------------------------------------------------
const PROBE = () => {
  const P = (window.__p3 = { lcp: 0, lcpEl: '', long: [], events: [] });
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) { P.lcp = e.startTime; P.lcpEl = e.element ? `${e.element.tagName.toLowerCase()}${e.element.className && typeof e.element.className === 'string' ? '.' + e.element.className.split(' ')[0] : ''}` : ''; } }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* unsupported */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.long.push({ start: e.startTime, dur: e.duration }); }).observe({ type: 'longtask', buffered: true }); } catch { /* unsupported */ }
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) P.events.push({ name: e.name, start: e.startTime, dur: e.duration, id: e.interactionId || 0, delay: e.processingStart - e.startTime, proc: e.processingEnd - e.processingStart }); }).observe({ type: 'event', buffered: true, durationThreshold: 16 }); } catch { /* unsupported */ }
};
const loadFigures = (page) => page.evaluate(() => {
  const P = window.__p3; const nav = performance.getEntriesByType('navigation')[0];
  const res = performance.getEntriesByType('resource'); const bytes = res.reduce((s, r) => s + (r.transferSize || 0), 0) + (nav?.transferSize || 0);
  const long = P.long; return {
    lcp: Math.round(P.lcp), lcpElement: P.lcpEl, longTasks: long.length, longTaskTotal: Math.round(long.reduce((s, x) => s + x.dur, 0)), longestTask: Math.round(Math.max(0, ...long.map((x) => x.dur))),
    dcl: Math.round(nav?.domContentLoadedEventEnd || 0), load: Math.round(nav?.loadEventEnd || 0), transferredKB: Math.round(bytes / 1024), requests: res.length + 1,
  };
});
const mark = (page) => page.evaluate(() => performance.now());
/** the interactions (Event Timing) after `since`: per interaction its longest event duration; the INP-style worst and p75 */
const interactionsSince = (page, since) => page.evaluate((t) => {
  const by = new Map(); const other = [];
  for (const e of window.__p3.events) { if (e.start < t) continue; if (e.id) { const m = by.get(e.id); if (!m || e.dur > m.dur) by.set(e.id, e); } else other.push(e); }
  const xs = [...by.values()].map((e) => ({ name: e.name, dur: e.dur, delay: Math.round(e.delay), proc: Math.round(e.proc) }));
  const long = window.__p3.long.filter((x) => x.start >= t);
  return { interactions: xs, nonInteractionEvents: other.length, longTasks: long.length, longestTask: Math.round(Math.max(0, ...long.map((x) => x.dur))) };
}, since);
function summariseInteractions(r, count) {
  const durs = r.interactions.map((x) => x.dur);
  // 0 = every interaction was under the Event Timing threshold (16 ms); numbers so the budgets can compare them
  return { counted: count, over16ms: durs.length, worst: durs.length ? Math.max(...durs) : 0, p75: durs.length >= 4 ? stats(durs).p75 : (durs.length ? Math.max(...durs) : 0), worstEvent: r.interactions.sort((a, b) => b.dur - a.dur)[0] ?? null, longTasks: r.longTasks, longestTask: r.longestTask };
}

(async () => {
  const out = { kind: 'agastya-phase3-frontend', version: 1, at: new Date().toISOString(), node: process.version, channel: CHANNEL, cpus: os.cpus().length, cpu: os.cpus()[0]?.model, bundle: null, firstLoad: {}, editors: {}, memory: null, errors: [] };
  if (!fs.existsSync(path.join(DIST, 'index.html'))) { console.error('frontend/dist is missing: npx vite build --manifest'); process.exit(2); }
  out.bundle = bundle();
  const srv = startServer();
  let browser;
  try {
    await waitHealthy();
    // people and projects (through the API, like the e2e specs)
    const admin = await pwRequest.newContext({ baseURL: BASE });
    if ((await (await admin.get('/api/auth/setup')).json()).setupRequired) await admin.post('/api/auth/setup', { data: { username: 'admin', password: PW, fullName: 'Bench Admin' } });
    const made = await (await admin.post('/api/team/users', { data: { username: 'feperf', fullName: 'Front Perf', role: 'author' } })).json();
    const api = await pwRequest.newContext({ baseURL: BASE });
    await api.post('/api/auth/login', { data: { username: 'feperf', password: made.tempPassword } });
    await api.post('/api/auth/onboarding', { data: { username: 'feperf', password: PW } });
    const ids = {
      s1000d: (await (await api.post('/api/projects/sample', { data: {} })).json()).project.id,
      jss: (await (await api.post('/api/projects/sample-jss', { data: { domain: 'land' } })).json()).project.id,
      jsg: (await (await api.post('/api/projects/sample-jsg', { data: { kind: 'uhb' } })).json()).project.id,
    };
    const dms = (await (await api.get(`/api/projects/${ids.s1000d}/dms`)).json()).dms.map((d) => d.file);
    out.projects = { ...ids, s1000dModules: dms.length };
    const storageState = await api.storageState();
    browser = await chromium.launch({ channel: CHANNEL, headless: !HEADED });
    const newPage = async () => { const ctx = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 }, baseURL: BASE }); await ctx.addInitScript(PROBE); const page = await ctx.newPage(); page.on('dialog', (d) => { void d.accept().catch(() => undefined); }); return { ctx, page }; };

    // ── first load, cold and warm ─────────────────────────────────────────────────────────────────────────────────────────────────────
    const READY = {
      overview: { url: '/overview', ready: (p) => p.getByRole('heading', { name: /Good (morning|afternoon|evening)/ }).waitFor({ timeout: 60_000 }) },
      projectHome: { url: `/projects/${ids.s1000d}/home`, ready: (p) => p.getByTestId('project-bar-name').waitFor({ timeout: 60_000 }) },
      s1000dEditor: { url: `/projects/${ids.s1000d}/editor`, ready: (p) => p.getByTestId('studio-host').waitFor({ timeout: 90_000 }) },
      jssEditor: { url: `/projects/${ids.jss}/editor`, ready: (p) => p.getByTestId('jss-editor').waitFor({ timeout: 60_000 }) },
      jsgEditor: { url: `/projects/${ids.jsg}/editor`, ready: (p) => p.getByTestId('jsg-host').waitFor({ timeout: 60_000 }) },
    };
    for (const [name, r] of Object.entries(READY)) {
      const { ctx, page } = await newPage();
      try {
        const run = async () => { const t = Date.now(); await page.goto(r.url); await r.ready(page); const readyMs = Date.now() - t; await sleep(1200); return { readyMs, ...(await loadFigures(page)) }; };
        const cold = await run(); const warm = await run();
        out.firstLoad[name] = { cold, warm };
      } catch (e) { out.errors.push(`first load ${name}: ${e.message}`); } finally { await ctx.close(); }
    }

    // ── editor interactions ─────────────────────────────────────────────────────────────────────────────────────────────────────────
    async function measure(page, label, fn, count = 1) {
      const t = await mark(page); const w = Date.now(); let wall = null; let note;
      try { const r = await fn(); wall = Date.now() - w; note = r ?? undefined; } catch (e) { out.errors.push(`${label}: ${e.message.split('\n')[0]}`); return { error: e.message.split('\n')[0] }; }
      await sleep(400);
      return { wallMs: wall, ...summariseInteractions(await interactionsSince(page, t), count), ...(note ? { note } : {}) };
    }
    async function typeInto(page, scope) {
      // JSS and JSG edit in contenteditable blocks; the Studio's design page is itself the editable surface: click into a body text there
      const inner = page.locator(`${scope} [contenteditable="true"]:visible`);
      if (await inner.count()) { const ed = inner.first(); await ed.waitFor({ timeout: 30_000 }); await ed.click(); await page.keyboard.press('End'); }
      else { const ed = page.locator(scope).first(); await ed.waitFor({ timeout: 30_000 }); await ed.click({ position: { x: 160, y: 220 } }); await page.keyboard.press('End'); }
      for (const ch of ' perf probe typing 123456789012') { await page.keyboard.type(ch); await sleep(40); }
    }
    async function panels(page) {
      const g = page.getByTestId('editor-header').getByRole('group', { name: 'Panels' });
      for (const id of ['toggle-side', 'toggle-problems', 'doc-props-toggle']) { const b = g.getByTestId(id); if (await b.count()) { await b.click(); await sleep(150); await b.click(); await sleep(150); } }
    }
    const EDITORS = {
      s1000d: { url: `/projects/${ids.s1000d}/editor`, ready: (p) => p.getByTestId('studio-host').waitFor({ timeout: 90_000 }), scope: '.design-page', qp: 'quick-preview-btn' },
      jss: { url: `/projects/${ids.jss}/editor`, ready: (p) => p.getByTestId('jss-editor').waitFor({ timeout: 60_000 }), scope: '[data-testid="jss-host"]', qp: 'jss-quick-preview' },
      jsg: { url: `/projects/${ids.jsg}/editor`, ready: (p) => p.getByTestId('jsg-host').waitFor({ timeout: 60_000 }), scope: '[data-testid="jsg-host"]', qp: 'jsg-quick-preview' },
    };
    for (const [kind, e] of Object.entries(EDITORS)) {
      const { ctx, page } = await newPage(); const res = {};
      try {
        await page.goto(e.url); await e.ready(page); await sleep(1500);
        if (kind === 's1000d') {
          const item = (f) => page.getByTestId('dm-list').locator(`[data-file="${f}"]`);
          res.openModule = await measure(page, 's1000d open', async () => { await item(dms[0]).click(); await page.locator('.design-page:visible').waitFor({ timeout: 30_000 }); });
          res.typing = await measure(page, 's1000d typing', () => typeInto(page, '.design-page:visible'), 30);
          await page.keyboard.press('Control+s'); await sleep(1500);
          res.switchModule = await measure(page, 's1000d switch', async () => { for (let i = 1; i <= 4; i++) { await item(dms[i % dms.length]).click(); await page.locator('.design-page:visible').waitFor({ timeout: 30_000 }); await sleep(250); } }, 4);
        } else {
          const rows = page.locator('[data-testid="doc-explorer"] .ed-outline-host').locator('button, [role="button"], [role="treeitem"], a, [tabindex="0"], [tabindex="-1"]');
          const n = await rows.count();
          res.openModule = await measure(page, `${kind} open outline item`, async () => { if (n < 2) return 'no outline rows'; await rows.nth(Math.min(2, n - 1)).click(); await sleep(300); return `${n} outline rows`; });
          res.typing = await measure(page, `${kind} typing`, () => typeInto(page, e.scope), 30);
          await page.keyboard.press('Control+s'); await sleep(1500);
          res.switchModule = await measure(page, `${kind} switch outline items`, async () => { if (n < 2) return 'no outline rows'; for (let i = 0; i < 4; i++) { await rows.nth(i % n).click(); await sleep(300); } return undefined; }, 4);
        }
        res.panelToggles = await measure(page, `${kind} panels`, () => panels(page), 6);
        res.quickPreview = await measure(page, `${kind} quick preview`, async () => {
          const b = page.getByTestId(e.qp).first(); await b.click();
          await page.locator('[data-testid="pdf-pane"] canvas').first().waitFor({ timeout: 180_000 });
        });
      } catch (err) { out.errors.push(`editor ${kind}: ${err.message.split('\n')[0]}`); } finally { out.editors[kind] = res; await ctx.close(); }
    }

    // ── memory after module switches (Studio) ───────────────────────────────────────────────────────────────────────────────────────
    {
      const { ctx, page } = await newPage();
      try {
        const cdp = await ctx.newCDPSession(page); await cdp.send('Performance.enable');
        const metrics = async () => { await cdp.send('HeapProfiler.collectGarbage'); await sleep(300); const m = Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value])); return { jsHeapUsedMB: r1(m.JSHeapUsedSize / 1048576), jsHeapTotalMB: r1(m.JSHeapTotalSize / 1048576), nodes: m.Nodes, listeners: m.JSEventListeners, documents: m.Documents }; };
        await page.goto(EDITORS.s1000d.url); await EDITORS.s1000d.ready(page);
        const item = (f) => page.getByTestId('dm-list').locator(`[data-file="${f}"]`);
        await item(dms[0]).click(); await page.locator('.design-page:visible').waitFor({ timeout: 30_000 }); await sleep(1000);
        const before = await metrics();
        const t = Date.now();
        for (let i = 1; i <= SWITCHES; i++) { await item(dms[i % dms.length]).click(); await page.locator('.design-page:visible').waitFor({ timeout: 30_000 }); await sleep(300); }
        const switchWall = Date.now() - t;
        const after = await metrics();
        out.memory = { switches: SWITCHES, modules: dms.length, before, after, growthMB: r1(after.jsHeapUsedMB - before.jsHeapUsedMB), nodeGrowth: after.nodes - before.nodes, listenerGrowth: after.listeners - before.listeners, switchWallMs: switchWall };
      } catch (e) { out.errors.push(`memory: ${e.message.split('\n')[0]}`); } finally { await ctx.close(); }
    }
    await api.dispose(); await admin.dispose();
  } catch (e) { out.errors.push(String(e.stack || e)); out.serverLogTail = srv.log.slice(-30).join('').slice(-4000); }
  finally { if (browser) await browser.close(); await stopServer(srv); }
  const text = JSON.stringify(out, null, 1);
  if (OUT) fs.writeFileSync(OUT, text); else console.log(text);
  if (MD) fs.writeFileSync(MD, markdown(out));
  process.exit(out.errors.length ? 1 : 0);
})();

function markdown(o) {
  const L = [`# Phase 3 frontend baseline (${o.at.slice(0, 10)}, ${o.channel})`, ''];
  if (o.errors.length) L.push('**Errors:**', '', ...o.errors.map((e) => `* ${e}`), '');
  const b = o.bundle; const kb = (n) => (n / 1024).toFixed(1);
  L.push('## Bundle', '', `${b.chunks} files, ${kb(b.totalGzip)} KB gzip in all; index.html loads ${b.initialFiles.length} files, ${kb(b.initialGzip)} KB gzip (${kb(b.initialRaw)} KB raw).`, '', '| File | source | kind | raw KB | gzip KB | initial |', '|---|---|---|---|---|---|');
  for (const c of b.largest.slice(0, 15)) L.push(`| ${c.file} | ${c.src ?? '-'} | ${c.kind} | ${kb(c.raw)} | ${kb(c.gzip)} | ${c.initial ? 'yes' : ''} |`);
  L.push('', '## First load', '', '| Page | run | ready ms | LCP ms | long tasks | long total ms | longest ms | DCL ms | KB transferred |', '|---|---|---|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(o.firstLoad)) for (const run of ['cold', 'warm']) { const x = v[run]; L.push(`| ${k} | ${run} | ${x.readyMs} | ${x.lcp} | ${x.longTasks} | ${x.longTaskTotal} | ${x.longestTask} | ${x.dcl} | ${x.transferredKB} |`); }
  L.push('', '## Editor interactions (Event Timing; worst = INP-style longest interaction; 0 = every interaction under 16 ms)', '', '| Editor | action | wall ms | interactions | >=16 ms | worst ms | p75 ms | long tasks | longest task ms |', '|---|---|---|---|---|---|---|---|---|');
  for (const [k, v] of Object.entries(o.editors)) for (const [a, x] of Object.entries(v)) L.push(`| ${k} | ${a} | ${x.wallMs ?? x.error ?? '-'} | ${x.counted ?? '-'} | ${x.over16ms ?? '-'} | ${x.worst ?? '-'} | ${x.p75 ?? '-'} | ${x.longTasks ?? '-'} | ${x.longestTask ?? '-'} |`);
  if (o.memory) { const m = o.memory; L.push('', '## Memory after module switches (Studio)', '', `${m.switches} switches over ${m.modules} modules in ${m.switchWallMs} ms. JS heap ${m.before.jsHeapUsedMB} -> ${m.after.jsHeapUsedMB} MB (${m.growthMB >= 0 ? '+' : ''}${m.growthMB}), DOM nodes ${m.before.nodes} -> ${m.after.nodes}, listeners ${m.before.listeners} -> ${m.after.listeners}.`); }
  return L.join('\n') + '\n';
}
