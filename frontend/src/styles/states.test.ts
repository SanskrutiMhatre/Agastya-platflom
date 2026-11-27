// WP-19 (DS-002, 08 section 7.7): the component x state matrix, checked on the real stylesheets with the token values of both themes.
// jsdom does not resolve custom properties, so the cascade is evaluated here: for each control the declarations of its base rule and
// of its state rule are collected in source order, var() is resolved against tokens.css (light, then dark), and each state must
// (a) exist, (b) look different from the default where the matrix says so, (c) keep its text readable. The browser-level version of
// this matrix (computed styles after real :hover / :focus-visible) is e2e/zz-theme-states.spec.ts.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { BASE_CSS } from '../jsg/shared';
import { JSS_CSS } from '../jss/style';

const SRC = path.resolve(__dirname, '..');
const read = (p: string): string => fs.readFileSync(path.join(SRC, p), 'utf8');
const TOKENS = read('styles/tokens/tokens.css');
const SHEETS = ['studio/styles/app.css', 'studio/styles/document.css', 'styles/platform.css', 'styles/pdf.css', 'styles/states.css'].map(read).join('\n') + BASE_CSS + JSS_CSS;

interface Rule { media: string; selectors: string[]; decls: Record<string, string> }
/** Split a selector list on the commas that are not inside parentheses (:where(a, b), :is(...)). */
function splitTop(s: string): string[] { const out: string[] = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out; }
function parse(css: string): Rule[] {
  css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: Rule[] = []; let i = 0; const media: string[] = [];
  let buf = '';
  while (i < css.length) {
    const ch = css[i++];
    if (ch === '{') {
      const head = buf.trim(); buf = '';
      if (head.startsWith('@media') || head.startsWith('@supports')) { media.push(head); continue; }
      if (head.startsWith('@keyframes')) { let depth = 1; while (i < css.length && depth) { if (css[i] === '{') depth++; else if (css[i] === '}') depth--; i++; } continue; }
      const end = css.indexOf('}', i); const body = css.slice(i, end); i = end + 1;
      const decls: Record<string, string> = {};
      for (const d of body.split(';')) { const k = d.indexOf(':'); if (k > 0) decls[d.slice(0, k).trim()] = d.slice(k + 1).trim(); }
      rules.push({ media: media.join(' '), selectors: splitTop(head).map((s) => s.trim().replace(/\s+/g, ' ')), decls });
    } else if (ch === '}') { media.pop(); buf = ''; } else buf += ch;
  }
  return rules;
}
const RULES = parse(SHEETS).filter((r) => !r.media.includes('print') && !r.media.includes('forced-colors') && !r.media.includes('prefers-') && !r.media.includes('max-width'));
const TOKEN_RULES = parse(TOKENS);
const vars = (theme: 'light' | 'dark'): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const r of TOKEN_RULES) {
    const applies = r.selectors.includes(':root') || (theme === 'dark' && r.selectors.includes(":root[data-theme='dark']"));
    if (applies) for (const [k, v] of Object.entries(r.decls)) if (k.startsWith('--')) out[k] = v;
  }
  return out;
};
const VARS = { light: vars('light'), dark: vars('dark') };
function resolve(v: string, theme: 'light' | 'dark', depth = 0): string {
  if (depth > 20) throw new Error(`var() loop in ${v}`);
  return v.replace(/var\(\s*(--[\w-]+)\s*(?:,\s*((?:[^()]|\([^()]*\))*))?\)/g, (_m, name: string, fb?: string) => {
    const val = VARS[theme][name] ?? fb;
    if (val === undefined) throw new Error(`undefined ${name}`);
    return resolve(val, theme, depth + 1);
  }).trim();
}
/** The declarations an element gets from these selectors, in source order (later rule wins, like equal-specificity cascade). */
function cascade(selectors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RULES) if (r.selectors.some((s) => selectors.includes(s))) Object.assign(out, r.decls);
  return out;
}
const has = (sel: string): boolean => RULES.some((r) => r.selectors.includes(sel));
const bgOf = (d: Record<string, string>): string | undefined => d['background-color'] ?? d.background;

// --- WCAG contrast
const hex = (c: string): [number, number, number] | null => { const m = /^#([0-9a-f]{6})$/i.exec(c); return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) as [number, number, number] : null; };
const lum = (c: [number, number, number]): number => c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
const ratio = (a: string, b: string): number | null => { const x = hex(a), y = hex(b); if (!x || !y) return null; const p = lum(x), q = lum(y); return (Math.max(p, q) + 0.05) / (Math.min(p, q) + 0.05); };

interface Control { name: string; base: string[]; states: Partial<Record<'hover' | 'active' | 'selected' | 'focus' | 'disabled' | 'busy' | 'error', string[]>>; surface?: string }
const FOCUS_GLOBAL = ':where(button, [tabindex], select, input, textarea, a, summary):focus-visible';
const MATRIX: Control[] = [
  { name: 'button', base: ['.btn'], states: { hover: ['.btn:hover'], active: ['.btn:active:not(:disabled)'], focus: ['.btn:focus-visible'], disabled: ['.btn:disabled'], busy: [".btn[aria-busy='true']"] } },
  { name: 'primary button', base: ['.btn', '.btn-primary'], states: { hover: ['.btn-primary:hover'], active: ['.btn-primary:active:not(:disabled)'], focus: ['.btn:focus-visible'], disabled: ['.btn:disabled', '.btn-primary:disabled'], busy: [".btn[aria-busy='true']"] } },
  { name: 'danger solid button', base: ['.btn', '.btn-primary', '.btn-danger-solid'], states: { disabled: ['.btn:disabled', '.btn-danger-solid:disabled'], busy: [".btn[aria-busy='true']"], focus: ['.btn:focus-visible'] } },
  { name: 'compat button', base: ['.x-btn'], states: { hover: ['.x-btn:hover'], active: ['.x-btn:active:not(:disabled)'], disabled: ['.x-btn:disabled'], focus: [FOCUS_GLOBAL] } },
  { name: 'icon button', base: ['.icon-btn'], states: { hover: ['.icon-btn:hover:not(:disabled)'], selected: ['.icon-btn.pressed'], focus: ['.icon-btn:focus-visible'], disabled: ['.icon-btn:disabled'] } },
  { name: 'ribbon button', base: ['.rb'], states: { hover: ['.rb:hover:not(:disabled)'], active: ['.rb:active:not(:disabled)'], selected: ['.rb.pressed'], focus: ['.rb:focus-visible'], disabled: ['.rb:disabled'] } },
  { name: 'view switch', base: ['.vs-btn'], states: { hover: ['.vs-btn:hover:not(:disabled)'], selected: ['.vs-btn.pressed'], focus: ['.vs-btn:focus-visible'], disabled: ['.vs-btn:disabled'] } },
  { name: 'segmented control', base: ['.v2-seg button'], states: { hover: ['.v2-seg button:hover:not(:disabled):not(.on)'], selected: ['.v2-seg button.on'], focus: ['.v2-seg button:focus-visible'], disabled: ['.v2-seg button:disabled'] } },
  { name: 'tab', base: ['.v2-tab'], states: { hover: ['.v2-tab:hover'], selected: ['.v2-tab.active'], focus: ['.v2-tab:focus-visible'], disabled: ['.v2-tab:disabled'] } },
  { name: 'menu item', base: ['.ctx-item'], states: { hover: ['.ctx-item:hover:not(:disabled)'], disabled: ['.ctx-item:disabled'], focus: [FOCUS_GLOBAL] } },
  { name: 'file menu item', base: ['.fm-item'], states: { hover: ['.fm-item:hover:not(:disabled)'], disabled: ['.fm-item:disabled'], focus: [FOCUS_GLOBAL] } },
  { name: 'list row (data module)', base: ['.v2-dm'], states: { hover: ['.v2-dm:hover'], selected: ['.v2-dm.active'], focus: ['.v2-dm:focus-visible'] } },
  { name: 'JSG toolbar button', base: ['.jsg-bar .jsg-tb'], states: { hover: ['.jsg-bar .jsg-tb:hover:not(:disabled)'], active: ['.jsg-bar .jsg-tb:active:not(:disabled)'], selected: ['.jsg-bar .jsg-tb.on'], focus: ['.jsg-bar .jsg-tb:focus-visible'], disabled: ['.jsg-bar .jsg-tb:disabled'] } },
  { name: 'JSG toolbar tab', base: ['.jsg-tab'], states: { hover: ['.jsg-tab:hover'], selected: ['.jsg-tab.on'], focus: ['.jsg-tab:focus-visible'] } },
  { name: 'shell input', base: ['.v2-input, .v2-select, .v2-textarea'.split(', ')[0]], states: { focus: ['.v2-input:focus'], disabled: ['.v2-input:disabled'], error: [".v2-input[aria-invalid='true']"] } },
  { name: 'shell select', base: ['.v2-select'], states: { focus: ['.v2-select:focus'], disabled: ['.v2-select:disabled'], error: [".v2-select[aria-invalid='true']"] } },
  { name: 'Studio input', base: ['.input'], states: { focus: ['.input:focus'], disabled: ['.input:disabled'], error: [".input[aria-invalid='true']"] } },
];
const THEMES = ['light', 'dark'] as const;
const PANEL = { light: resolve('var(--surface-panel)', 'light'), dark: resolve('var(--surface-panel)', 'dark') };
const TEXT = { light: resolve('var(--text-primary)', 'light'), dark: resolve('var(--text-primary)', 'dark') };
const colour = (d: Record<string, string>, theme: 'light' | 'dark'): { fg: string; bg: string } => {
  const bgRaw = bgOf(d); const fgRaw = d.color;
  const bg = !bgRaw || /^(none|transparent)$/.test(bgRaw) ? PANEL[theme] : resolve(bgRaw, theme);
  const fg = !fgRaw || fgRaw === 'inherit' ? TEXT[theme] : resolve(fgRaw, theme);
  return { fg, bg };
};

let executions = 0;
describe('component x state matrix (both themes)', () => {
  for (const c of MATRIX) for (const [state, sels] of Object.entries(c.states)) for (const theme of THEMES) {
    it(`${c.name} / ${state} / ${theme}`, () => {
      executions++;
      for (const s of sels!) expect(has(s), `no rule ${s}`).toBe(true);
      const base = cascade(c.base), st = cascade([...c.base, ...sels!]);
      const b = colour(base, theme), x = colour(st, theme);
      if (state === 'hover' || state === 'active' || state === 'selected') {
        expect(`${x.fg}|${x.bg}|${st['border-color'] ?? ''}|${st['box-shadow'] ?? ''}|${st['border-bottom-color'] ?? ''}`, `${state} looks like the default`)
          .not.toBe(`${b.fg}|${b.bg}|${base['border-color'] ?? ''}|${base['box-shadow'] ?? ''}|${base['border-bottom-color'] ?? ''}`);
        const r = ratio(x.fg, x.bg); if (r !== null) expect(r, `${state} text ${x.fg} on ${x.bg}`).toBeGreaterThanOrEqual(4.5);
      }
      if (state === 'disabled') {
        expect(st.cursor, 'disabled cursor').toBe('not-allowed');
        expect(Number(st.opacity ?? 1), 'disabled by opacity alone').toBe(1);
        expect(`${x.fg}|${x.bg}`, 'disabled looks like enabled').not.toBe(`${b.fg}|${b.bg}`);
        const r = ratio(x.fg, x.bg); if (r !== null) expect(r, 'disabled text stays legible').toBeGreaterThanOrEqual(2.2);
      }
      if (state === 'focus') {
        const o = st.outline ?? '';
        const visible = /2px solid/.test(o) || /box-shadow/.test(Object.keys(st).join()) && st['box-shadow'] !== 'none' || (st['border-color'] && st['border-color'] !== base['border-color']);
        expect(visible, `no visible focus (${o})`).toBeTruthy();
        if (/2px solid/.test(o)) { const ring = resolve(o.replace('2px solid', ''), theme); const r = ratio(ring, PANEL[theme]); if (r !== null) expect(r, 'focus ring vs panel').toBeGreaterThanOrEqual(3); }
      }
      if (state === 'busy') { expect(st['pointer-events']).toBe('none'); expect(has(`${sels![0]}::after`)).toBe(true); }
      if (state === 'error') expect(resolve(st['border-color'], theme)).toBe(resolve('var(--danger)', theme));
    });
  }
  it('ran every applicable cell in both themes', () => {
    const cells = MATRIX.reduce((n, c) => n + Object.keys(c.states).length, 0);
    expect(executions).toBe(cells * 2);
    expect(cells).toBeGreaterThanOrEqual(60);
  });
});

describe('the JSG toolbar no longer out-specifies the tokens (TH-001)', () => {
  it('no generic .jsg-bar button rule reaches the tabbed toolbar', () => {
    const generic = RULES.filter((r) => r.selectors.some((s) => /^\.jsg-bar button/.test(s)));
    expect(generic).toEqual([]);
  });
  it('the selected tab reads in both themes, hovered or not', () => {
    for (const theme of THEMES) {
      const on = cascade(['.jsg-tab', '.jsg-tab:hover', '.jsg-tab.on']);
      const r = ratio(resolve(on.color, theme), resolve(on.background, theme));
      expect(r, theme).toBeGreaterThanOrEqual(4.5);
    }
  });
});
