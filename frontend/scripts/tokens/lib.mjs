// Shared helpers of the token scripts (audit WP-19): read the token source, resolve a token per theme, measure contrast.
// Dependency-free on purpose; run with plain `node`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const TOKENS_DIR = path.join(FRONTEND, 'src', 'styles', 'tokens');
export const SOURCE = process.env.TOKENS_SOURCE || path.join(TOKENS_DIR, 'tokens.json');
export const OUTPUT = path.join(TOKENS_DIR, 'tokens.css');

export const COLOUR_LITERAL = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b(?![-_\w])|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/;

export function readSource() {
  const src = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
  const strip = (o) => Object.fromEntries(Object.entries(o ?? {}).filter(([k]) => !k.startsWith('$')));
  return {
    primitive: strip(src.primitive), semantic: strip(src.semantic), fixed: strip(src.fixed), alias: strip(src.alias),
    scale: strip(src.scale), density: { comfortable: strip(src.density?.comfortable), compact: strip(src.density?.compact) },
    accentOverride: src.accentOverride ?? [], pairs: src.pairs ?? [],
  };
}

/** Problems with the source itself: literals outside the primitive tier, dangling references, a semantic token without both values. */
export function validateSource(s) {
  const errors = [];
  const ref = (where, v) => {
    if (typeof v !== 'string') { errors.push(`${where}: not a string`); return; }
    const m = /^\{([\w-]+)\}$/.exec(v);
    if (!m) { errors.push(`${where}: must be a {primitive} reference, found ${v}`); return; }
    if (!(m[1] in s.primitive)) errors.push(`${where}: unknown primitive ${m[1]}`);
  };
  for (const [k, v] of Object.entries(s.semantic)) {
    if (!Array.isArray(v) || v.length !== 2) { errors.push(`semantic.${k}: needs [light, dark]`); continue; }
    ref(`semantic.${k}[light]`, v[0]); ref(`semantic.${k}[dark]`, v[1]);
  }
  for (const [k, v] of Object.entries(s.fixed)) { ref(`fixed.${k}`, v); if (k in s.semantic) errors.push(`fixed.${k}: also in semantic`); }
  const known = new Set([...Object.keys(s.semantic), ...Object.keys(s.fixed), ...Object.keys(s.scale)]);
  for (const [k, v] of Object.entries(s.alias)) {
    if (known.has(k)) errors.push(`alias.${k}: shadows a token of the same name`);
    if (!known.has(v) && COLOUR_LITERAL.test(v)) errors.push(`alias.${k}: aliases may not hold colour literals (${v})`);
  }
  for (const k of s.accentOverride) if (!(k in s.semantic)) errors.push(`accentOverride: ${k} is not a semantic token`);
  for (const p of s.pairs) for (const t of p.slice(0, 2)) if (!(t in s.semantic) && !(t in s.fixed)) errors.push(`pairs: unknown token ${t}`);
  return errors;
}

/** The value of a semantic/fixed token in one theme ('light' | 'dark'), as the literal primitive. */
export function resolve(s, name, theme) {
  const v = name in s.semantic ? s.semantic[name][theme === 'dark' ? 1 : 0] : s.fixed[name];
  if (v === undefined) throw new Error(`unknown token ${name}`);
  return s.primitive[v.slice(1, -1)];
}

// ---------------------------------------------------------------- colour maths (WCAG 2.x relative luminance)
export function parseColour(c) {
  c = c.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(c);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((x) => x + x).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(c);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], a: m[4] === undefined ? 1 : +m[4] };
  throw new Error(`cannot parse colour ${c}`);
}
export const over = (fg, bg) => ({ r: fg.r * fg.a + bg.r * (1 - fg.a), g: fg.g * fg.a + bg.g * (1 - fg.a), b: fg.b * fg.a + bg.b * (1 - fg.a), a: 1 });
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
export const luminance = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
export function ratio(fg, bg) {
  const a = luminance(fg), b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}
export const NEED = { text: 4.5, ui: 3, large: 3 };
