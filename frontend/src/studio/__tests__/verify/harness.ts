// Boots the REAL embedded editor (ui/app.ts, ui/editor.ts) in jsdom, with grammar fetches served from public/. Same idea as the
// Studio's own tests/unit/ui-harness.ts, pointed at the platform's patched copy.
import fs from 'node:fs';
import path from 'node:path';
import { vi } from 'vitest';
import { setGrammarBase } from '../../core/grammar';
import { App } from '../../ui/app';

const ROOT = path.resolve(__dirname, '../../../..');

/** Node 26 ships its own (file-backed, usually unusable) localStorage that shadows jsdom's; use a plain in-memory one. */
function ensureStorage() {
  for (const k of ['localStorage', 'sessionStorage'] as const) {
    const m = new Map<string, string>();
    const store = {
      getItem: (a: string) => (m.has(a) ? m.get(a)! : null),
      setItem: (a: string, b: string) => void m.set(a, String(b)),
      removeItem: (a: string) => void m.delete(a),
      clear: () => m.clear(),
      key: (i: number) => [...m.keys()][i] ?? null,
      get length() { return m.size; },
    };
    Object.defineProperty(globalThis, k, { configurable: true, value: store });
    Object.defineProperty(window, k, { configurable: true, value: store });
  }
}

export function stubFetch() {
  setGrammarBase('grammar');
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async (url: string) => {
    const f = path.join(ROOT, 'public', String(url));
    if (!fs.existsSync(f)) return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    const txt = fs.readFileSync(f, 'utf8');
    return { ok: true, status: 200, json: async () => JSON.parse(txt), text: async () => txt };
  });
}

// jsdom lacks a few layout APIs CodeMirror / the design view use
export function stubLayout() {
  const r = Range.prototype as unknown as Record<string, unknown>;
  if (!r.getClientRects) r.getClientRects = () => [] as unknown as DOMRectList;
  if (!r.getBoundingClientRect) r.getBoundingClientRect = () => new DOMRect(0, 0, 0, 0);
  const e = Element.prototype as unknown as Record<string, unknown>;
  if (!e.scrollIntoView) e.scrollIntoView = () => {};
  const w = window as unknown as Record<string, unknown>;
  if (!w.requestAnimationFrame) w.requestAnimationFrame = (cb: FrameRequestCallback) => setTimeout(() => cb(0), 0);
  if (!w.matchMedia) w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  const g = globalThis as Record<string, unknown>;
  if (!g.ResizeObserver) g.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

/** Every App registers window/document listeners and never removes them (one App per page); remove the previous App's first. */
type Reg = { target: EventTarget; type: string; fn: EventListenerOrEventListenerObject; opts?: boolean | AddEventListenerOptions };
let registered: Reg[] = [];
export function bootApp(): App {
  ensureStorage();
  stubFetch();
  stubLayout();
  for (const r of registered) r.target.removeEventListener(r.type, r.fn, r.opts);
  registered = [];
  const targets: EventTarget[] = [window, document];
  const originals = targets.map((t) => t.addEventListener);
  targets.forEach((t, i) => {
    t.addEventListener = function (type: string, fn: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) {
      registered.push({ target: t, type, fn, opts });
      return originals[i].call(t, type, fn, opts);
    } as typeof t.addEventListener;
  });
  try {
    document.body.innerHTML = '<div id="app" class="app"></div>';
    localStorage.clear();
    return new App(document.getElementById('app')!);
  } finally {
    targets.forEach((t, i) => { t.addEventListener = originals[i]; });
  }
}

export const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
