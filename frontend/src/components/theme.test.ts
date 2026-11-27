// WP-20 (TH-009, QA-012; audit 08 section 7.5): component-level theme tests. The shared shell components (components/ui.tsx, lists.tsx,
// PageHeader.tsx, ThemeToggle.tsx) are RENDERED with React in jsdom, once per theme, and every rendered element is styled by the real entry
// stylesheets (tokens.css, base.css, platform.css, pdf.css, states.css, in the order main.tsx imports them).
//
// jsdom applies no custom properties (08 section 7.5 warns about it), so the cascade is computed here: the rules whose selector the element
// matches (Element.matches, so the real selectors decide, not class-name guesses) are ordered by specificity and source order, custom properties
// inherit, var() resolves with its fallback, colours composite through the ancestors' backgrounds. Per component and theme:
//   1. no inline colour (a literal or a token in style="" bypasses the theme: 08 section 7.6 #1);
//   2. every var() the component's colours need resolves in that theme (no missing dark value: TH-007);
//   3. every text it draws meets WCAG 1.4.3 (4.5:1, 3:1 for large text) on the background it really sits on;
//   4. it looks different in dark than in light (a component that does not follow the theme is a literal in disguise).
// The browser-level twin (computed styles after real :hover/:focus-visible) is e2e/visual/screens.spec.ts on the design-system fixture.
import fs from 'node:fs';
import path from 'node:path';
import * as React from 'react';
import { createElement as h, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import * as TestUtils from 'react-dom/test-utils';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { Alert, Badge, ConfirmModal, Empty, Field, PromptModal, Spinner, Toasts } from './ui';
import { Section } from './lists';
import { PageHeader } from './PageHeader';
import { ThemeChoiceControl, ThemeToggle } from './ThemeToggle';
import { useUi } from '../store/ui';

type Theme = 'light' | 'dark';
const THEMES: Theme[] = ['light', 'dark'];
const SRC = path.resolve(__dirname, '..');
const CSS = ['styles/tokens/tokens.css', 'styles/base.css', 'styles/platform.css', 'styles/pdf.css', 'styles/states.css'].map((p) => fs.readFileSync(path.join(SRC, p), 'utf8')).join('\n');

// ------------------------------------------------------------------ CSS parsing
interface Decl { value: string; important: boolean }
interface Rule { selectors: string[]; decls: Record<string, Decl>; order: number }
function splitTop(s: string, sep = ','): string[] { const out: string[] = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(' || ch === '[') d++; if (ch === ')' || ch === ']') d--; if (ch === sep && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function parse(css: string): Rule[] {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = []; let i = 0, buf = ''; const media: boolean[] = [];   // true = a block whose rules do not apply on a plain screen
  const skipBlock = () => { let depth = 1; while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; } };
  while (i < css.length) {
    const ch = css[i++];
    if (ch === '{') {
      const head = buf.trim(); buf = '';
      if (head.startsWith('@media')) {
        // the default screen: no print, no forced colours, no contrast preference, no reduced motion, a desktop width
        const off = /print|forced-colors|prefers-|max-width|hover: none|pointer: coarse/.test(head);
        if (off) { skipBlock(); continue; }
        media.push(false); continue;
      }
      if (head.startsWith('@supports')) { media.push(false); continue; }
      if (head.startsWith('@')) { skipBlock(); continue; }
      const end = css.indexOf('}', i); const body = css.slice(i, end); i = end + 1;
      const decls: Record<string, Decl> = {};
      for (const d of splitTop(body, ';')) {
        const k = d.indexOf(':'); if (k <= 0) continue;
        let v = d.slice(k + 1).trim(); const important = /!important\s*$/.test(v); v = v.replace(/!important\s*$/, '').trim();
        decls[d.slice(0, k).trim()] = { value: v, important };
      }
      rules.push({ selectors: splitTop(head).map((s) => s.trim()).filter(Boolean), decls, order: rules.length });
    } else if (ch === '}') { media.pop(); buf = ''; } else buf += ch;
  }
  return rules;
}
const RULES = parse(CSS);

/** [ids, classes/attributes/pseudo-classes, types] of one selector; :where() counts 0, :is()/:not()/:has() their most specific argument. */
function specificity(sel: string): [number, number, number] {
  let a = 0, b = 0, c = 0;
  sel = sel.replace(/:where\((?:[^()]|\([^()]*\))*\)/g, '');
  sel = sel.replace(/:(is|not|has)\(((?:[^()]|\([^()]*\))*)\)/g, (_m, _k, inner: string) => {
    const best = splitTop(inner).map((x) => specificity(x.trim())).sort((x, y) => x[0] - y[0] || x[1] - y[1] || x[2] - y[2]).pop() ?? [0, 0, 0];
    a += best[0]; b += best[1]; c += best[2]; return '';
  });
  sel = sel.replace(/\[[^\]]*\]/g, () => { b++; return ''; });
  a += (sel.match(/#[\w-]+/g) ?? []).length;
  b += (sel.match(/\.[\w-]+/g) ?? []).length + (sel.match(/(?<!:):[\w-]+/g) ?? []).length;
  c += (sel.replace(/[#.:][\w-]+/g, ' ').match(/(^|[\s>+~])([a-z][\w-]*)/gi) ?? []).length;
  return [a, b, c];
}
const SPEC = new Map<string, [number, number, number]>();
const specOf = (s: string) => { let v = SPEC.get(s); if (!v) { v = specificity(s); SPEC.set(s, v); } return v; };
const safeMatches = (el: Element, sel: string): boolean => { if (sel.includes('::')) return false; try { return el.matches(sel); } catch { return false; } };

// ------------------------------------------------------------------ colours
interface RGBA { r: number; g: number; b: number; a: number }
const TRANSPARENT: RGBA = { r: 0, g: 0, b: 0, a: 0 };
function colour(v: string): RGBA | null {
  v = v.trim();
  if (v === 'transparent' || v === 'none') return TRANSPARENT;
  let m = /^#([0-9a-f]{3,8})$/i.exec(v);
  if (m) { let x = m[1]; if (x.length <= 4) x = x.split('').map((q) => q + q).join(''); return { r: parseInt(x.slice(0, 2), 16), g: parseInt(x.slice(2, 4), 16), b: parseInt(x.slice(4, 6), 16), a: x.length === 8 ? parseInt(x.slice(6, 8), 16) / 255 : 1 }; }
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4] };
  m = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*(.+?)(?:\s+([\d.]+)%)?\s*\)$/.exec(v);
  if (m) {
    const x = colour(m[1]), y = colour(m[3]); if (!x || !y) return null;
    const p = +m[2] / 100, q = m[4] ? +m[4] / 100 : 1 - p;
    const a = x.a * p + y.a * q; if (!a) return TRANSPARENT;
    return { r: (x.r * x.a * p + y.r * y.a * q) / a, g: (x.g * x.a * p + y.g * y.a * q) / a, b: (x.b * x.a * p + y.b * y.a * q) / a, a };
  }
  return null;
}
const over = (f: RGBA, b: RGBA): RGBA => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
const lin = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c: RGBA) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (x: RGBA, y: RGBA) => { const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };
const show = (c: RGBA) => `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+c.a.toFixed(2)})`;

// ------------------------------------------------------------------ the cascade
interface Computed { vars: Record<string, string>; color: RGBA; bg: RGBA | 'image'; fontSize: number; bold: boolean; opacity: number }
let cache = new Map<Element, Computed>();
let missing: string[] = [];
function resolveVars(v: string, vars: Record<string, string>, depth = 0): string {
  if (depth > 25) throw new Error(`var() loop in ${v}`);
  return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\((?:[^()]|\([^()]*\))*\))*))?\)/g, (_m, name: string, fb?: string) => {
    const val = vars[name] ?? fb;
    if (val === undefined) { missing.push(name); return 'transparent'; }
    return resolveVars(val, vars, depth + 1);
  }).trim();
}
function computed(el: Element): Computed {
  const hit = cache.get(el); if (hit) return hit;
  const parent = el.parentElement ? computed(el.parentElement) : { vars: {}, color: { r: 0, g: 0, b: 0, a: 1 }, bg: TRANSPARENT as RGBA | 'image', fontSize: 16, bold: false, opacity: 1 };
  const matched: Array<{ spec: [number, number, number]; order: number; decls: Record<string, Decl> }> = [];
  for (const r of RULES) {
    let best: [number, number, number] | null = null;
    for (const s of r.selectors) if (safeMatches(el, s)) { const sp = specOf(s); if (!best || sp[0] - best[0] || sp[1] - best[1] || sp[2] - best[2] > 0) best = sp; }
    if (best) matched.push({ spec: best, order: r.order, decls: r.decls });
  }
  const cmp = (x: (typeof matched)[number], y: (typeof matched)[number]) => x.spec[0] - y.spec[0] || x.spec[1] - y.spec[1] || x.spec[2] - y.spec[2] || x.order - y.order;
  matched.sort(cmp);
  const win: Record<string, string> = {};
  for (const imp of [false, true]) for (const m of matched) for (const [k, d] of Object.entries(m.decls)) if (d.important === imp) {
    if (k === 'background' || k === 'background-color') win.bg = d.value; else win[k] = d.value;
  }
  const vars = { ...parent.vars };
  for (const [k, v] of Object.entries(win)) if (k.startsWith('--')) vars[k] = v;
  const style = (el as HTMLElement).style;
  const fgRaw = win.color && win.color !== 'inherit' ? resolveVars(win.color, vars) : null;
  const color = fgRaw ? (colour(fgRaw) ?? parent.color) : parent.color;
  let bg: RGBA | 'image' = TRANSPARENT;
  if (win.bg) {
    if (/gradient\(|url\(/.test(win.bg)) bg = 'image';
    else { const v = resolveVars(win.bg, vars); bg = colour(v) ?? colour(v.split(/\s+(?![^(]*\))/)[0]) ?? TRANSPARENT; }
  }
  const fs_ = win['font-size'] && /^[\d.]+px$/.test(win['font-size']) ? parseFloat(win['font-size']) : parent.fontSize;
  const weight = win['font-weight'] ?? (/^(H[1-6]|STRONG|B|DD|TH)$/.test(el.tagName) ? '700' : undefined);
  const bold = weight ? Number(weight) >= 700 || weight === 'bold' : parent.bold;
  const opacity = parent.opacity * (win.opacity ? Number(win.opacity) : 1) * (style?.opacity ? Number(style.opacity) : 1);
  const out: Computed = { vars, color, bg, fontSize: fs_, bold, opacity };
  cache.set(el, out);
  return out;
}
/** The colour behind an element: its own and its ancestors' backgrounds composited over the page. */
function behind(el: Element): RGBA | 'image' {
  const layers: RGBA[] = [];
  for (let e: Element | null = el; e; e = e.parentElement) {
    const b = computed(e).bg; if (b === 'image') return 'image';
    if (b.a > 0) { layers.push(b); if (b.a >= 1) break; }
  }
  let out: RGBA = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) out = over(layers[i], out);
  return out;
}

// ------------------------------------------------------------------ rendering
let root: Root | null = null; let host: HTMLElement | null = null;
const act: (cb: () => void) => void = ((React as unknown as { act?: typeof TestUtils.act }).act ?? TestUtils.act) as unknown as (cb: () => void) => void;
function mount(theme: Theme, el: ReactElement): HTMLElement {
  document.documentElement.dataset.theme = theme;
  cache = new Map(); missing = [];
  host = document.createElement('div'); host.className = 'v2-page'; document.body.appendChild(host);
  root = createRoot(host);
  act(() => { root!.render(el); });
  return host;
}
afterEach(() => { if (root) act(() => root!.unmount()); host?.remove(); root = null; host = null; useUi.setState({ toasts: [] }); });
beforeAll(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  if (!window.matchMedia) (window as unknown as { matchMedia: (q: string) => MediaQueryList }).matchMedia = (q: string) => ({ matches: false, media: q, addEventListener() { /* none */ }, removeEventListener() { /* none */ } }) as unknown as MediaQueryList;
});

interface Finding { theme: Theme; problem: string }
/** Checks 1-3 on everything under `box`; returns the colour signature of the component (for check 4). */
function inspect(box: HTMLElement, theme: Theme, findings: Finding[]): string {
  const all = [box, ...Array.from(box.querySelectorAll('*'))];
  for (const el of all) {
    const inline = el.getAttribute('style') ?? '';
    if (/(^|;)\s*(color|background(-color)?|border(-\w+)?-color|fill|stroke)\s*:/i.test(inline)) findings.push({ theme, problem: `inline colour on <${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">: ${inline}` });
  }
  const sig: string[] = [];
  for (const el of all) {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim()).map((n) => (n.textContent ?? '').trim()).join(' ');
    if (!own) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .v2-sr, [hidden]')) continue;
    const c = computed(el); const bg = behind(el);
    if (bg === 'image') continue;
    const fg = over({ ...c.color, a: c.color.a * c.opacity }, bg);
    const need = c.fontSize >= 24 || (c.fontSize >= 18.66 && c.bold) ? 3 : 4.5;
    const r = ratio(fg, bg);
    sig.push(`${show(fg)}/${show(bg)}`);
    if (r + 0.005 < need) findings.push({ theme, problem: `"${own.slice(0, 30)}" in <${el.tagName.toLowerCase()} class="${el.getAttribute('class') ?? ''}">: ${r.toFixed(2)}:1 (needs ${need}), ${show(fg)} on ${show(bg)}` });
  }
  for (const m of new Set(missing)) findings.push({ theme, problem: `var(${m}) is not defined in the ${theme} theme` });
  return sig.join(' ');
}

const noop = () => undefined;
// components whose children are a required prop: createElement passes them as the third argument, which its typings do not see
const hx = h as unknown as (type: unknown, props: unknown, ...children: unknown[]) => ReactElement;
const CASES: Array<{ name: string; render: () => ReactElement; before?: () => void }> = [
  { name: 'Badge (every tone)', render: () => h('div', null, hx(Badge, null, 'Draft'), hx(Badge, { tone: 'ok' }, 'Valid'), hx(Badge, { tone: 'warn' }, '3 warnings'), hx(Badge, { tone: 'bad' }, '2 errors'), hx(Badge, { tone: 'accent' }, 'New')) },
  { name: 'Alert (every tone)', render: () => h('div', null, hx(Alert, null, 'A note'), hx(Alert, { tone: 'ok' }, 'Built'), hx(Alert, { tone: 'warn' }, 'Two modules are unplaced'), hx(Alert, { tone: 'bad' }, 'The check failed')) },
  { name: 'Field with a hint and with an error', render: () => h('div', null,
    hx(Field, { label: 'Name', hint: 'Shown on the cover' }, h('input', { className: 'v2-input', defaultValue: 'Pump manual' })),
    hx(Field, { label: 'Code', error: 'This code is taken' }, h('input', { className: 'v2-input', defaultValue: 'AB-1' }))) },
  { name: 'ConfirmModal (danger)', render: () => h(ConfirmModal, { title: 'Delete the project?', body: 'It goes to the recycle bin.', confirmLabel: 'Delete', danger: true, onConfirm: noop, onClose: noop }) },
  { name: 'ConfirmModal (busy)', render: () => h(ConfirmModal, { title: 'Publishing', body: 'Building the PDF.', busy: true, onConfirm: noop, onClose: noop }) },
  { name: 'PromptModal', render: () => h(PromptModal, { title: 'New folder', label: 'Folder name', hint: 'Letters and digits', onSubmit: async () => undefined, onClose: noop }) },
  { name: 'Toasts (info, success, error)', before: () => { const t = useUi.getState().toast; t('Saved.'); t('Publication built.', 'success'); t('The server could not be reached.', 'error'); }, render: () => h(Toasts) },
  { name: 'Spinner and Empty', render: () => h('div', null, h(Spinner, { label: 'Loading modules' }), hx(Empty, { title: 'Nothing here yet' }, 'Create the first item.')) },
  { name: 'PageHeader with stats', render: () => h(PageHeader, { icon: 'book', title: 'Publication', sub: 'Chapters and the build', actions: h('button', { className: 'btn btn-primary' }, 'Generate PDF'),
    stats: [{ label: 'Modules', value: 12 }, { label: 'Valid', value: 10, tone: 'ok' }, { label: 'Warnings', value: 1, tone: 'warn' }, { label: 'Errors', value: 1, tone: 'bad' }, { label: 'New', value: 2, tone: 'accent' }] }) },
  { name: 'Section (open, with a count)', render: () => hx(Section, { title: 'Unplaced modules', count: 2, tone: 'warn', defaultOpen: true }, 'Two modules are not in the publication.') },
  { name: 'ThemeChoiceControl', render: () => h(ThemeChoiceControl) },
  { name: 'Buttons (secondary, primary, danger, small, disabled)', render: () => h('div', { className: 'v2-card v2-card-pad' },
    h('button', { className: 'btn' }, 'Cancel'), h('button', { className: 'btn btn-primary' }, 'Save'), h('button', { className: 'btn btn-danger' }, 'Remove'),
    h('button', { className: 'btn btn-sm' }, 'Small'), h('button', { className: 'btn btn-primary', disabled: true }, 'Disabled')) },
];

describe('shared components in both themes (rendered, real stylesheets)', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const findings: Finding[] = []; const sig: Record<Theme, string> = { light: '', dark: '' };
      for (const theme of THEMES) {
        c.before?.();
        const box = mount(theme, c.render());
        expect(box.textContent?.trim().length, 'the component rendered something').toBeGreaterThan(0);
        sig[theme] = inspect(box, theme, findings);
        act(() => root!.unmount()); host!.remove(); root = null; host = null; useUi.setState({ toasts: [] });
      }
      expect(findings.map((f) => `${f.theme}: ${f.problem}`)).toEqual([]);
      expect(sig.light, 'the component draws text').not.toBe('');
      expect(sig.dark, 'the component looks the same in dark as in light (it does not follow the theme)').not.toBe(sig.light);
    });
  }
});

describe('the theme controls switch the theme live', () => {
  it('ThemeToggle flips html[data-theme] and the page colours follow without a reload', () => {
    act(() => useUi.getState().setTheme('light'));
    const box = mount('light', h(ThemeToggle));
    const before = behind(document.body);
    act(() => { (box.querySelector('[data-testid="theme-toggle"]') as HTMLButtonElement).click(); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    cache = new Map();
    const after = behind(document.body);
    expect(after === 'image' || before === 'image' ? '' : show(after)).not.toBe(before === 'image' ? '' : show(before));
    expect(box.querySelector('button')!.getAttribute('aria-label')).toBe('Switch to light mode');
  });
  it('ThemeChoiceControl marks the chosen theme and applies it', () => {
    const box = mount('light', h(ThemeChoiceControl));
    act(() => { (Array.from(box.querySelectorAll('[role="radio"]')).find((b) => b.textContent === 'Dark') as HTMLButtonElement).click(); });
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(box.querySelector('[aria-checked="true"]')!.textContent).toBe('Dark');
    act(() => { (Array.from(box.querySelectorAll('[role="radio"]')).find((b) => b.textContent === 'Light') as HTMLButtonElement).click(); });
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});

describe('the checker is not vacuous', () => {
  it('reports an inline colour, a weak text colour, an undefined variable and a component that ignores the theme', () => {
    const findings: Finding[] = [];
    const box = mount('dark', h('div', { className: 'v2-card' },
      h('span', { style: { color: '#888' } }, 'inline'),
      h('span', { className: 'v2-hint', style: { opacity: 0.3 } }, 'faded'),
      h('span', { style: { opacity: 1 }, className: 'v2-badge' }, 'ok')));
    // an undefined variable, injected as a rule for this test only
    RULES.push({ selectors: ['.planted-missing'], decls: { color: { value: 'var(--no-such-token)', important: false } }, order: RULES.length });
    box.appendChild(Object.assign(document.createElement('span'), { className: 'planted-missing', textContent: 'missing' }));
    try {
      inspect(box, 'dark', findings);
    } finally { RULES.pop(); }
    const text = findings.map((f) => f.problem).join('\n');
    expect(text).toMatch(/inline colour on <span/);
    expect(text).toMatch(/"faded".*needs 4\.5/);
    expect(text).toMatch(/var\(--no-such-token\) is not defined/);
  });
});
