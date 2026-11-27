// GENERATED COPY of frontend/src/lib/accent.ts for the server (audit WP-19, TH-003): writeSettings() re-validates the administrator accent
// with the same function the Administrator page previews. Do not edit by hand: change the frontend file and re-create this copy;
// frontend/src/lib/accent.test.ts compares the two over a few hundred colours.

// The administrator accent (audit WP-19, TH-003): one brand hex in, a checked light and dark variant out.
//
// The same hex used to replace the accent in both themes while the text on it stayed white (light) or near-black (dark), so
// some choices made primary buttons unreadable (#ffcc00: 1.51:1 in light; #1d3a8a: 1.77:1 in dark). deriveAccent() keeps the
// hue and moves the lightness until, in each theme:
//   - the text on an accent fill (buttons, badges) is at least 4.5:1,
//   - the accent as text and as a control edge is at least 4.5:1 on every surface it sits on (canvas, panel, hover, pressed, selected).
// It repairs rather than refuses; `ok` is false only when no lightness satisfies the rules (the server then refuses the value).
//
// KEEP IDENTICAL to backend/src/services/accent.ts (the server re-validates with the same function); src/lib/accent.test.ts
// compares the two over a few hundred colours.

export interface AccentVariant { accent: string; hover: string; soft: string; onAccent: string; ratios: { onAccent: number; worstSurface: number } }
export interface DerivedAccent { input: string; ok: boolean; adjusted: boolean; light: AccentVariant; dark: AccentVariant; reason?: string }

const BLACK = '#000000', WHITE = '#ffffff';
export const DEFAULT_ACCENT = '#2456c9';

/** The surfaces of each theme the accent must read on: a copy of the semantic tokens of frontend/src/styles/tokens/tokens.json (the parity test fails when they drift). */
export const ACCENT_SURFACES = {
  light: { panel: '#ffffff', canvas: '#f3f4f7', hover: '#e7eaf1', pressed: '#dde4f3', ink: '#ffffff', inkAlt: '#0d1424' },
  dark: { panel: '#1e2128', canvas: '#16181d', hover: '#2a2e37', pressed: '#27344f', ink: '#0d1424', inkAlt: '#ffffff' },
} as const;

const TEXT = 4.5;
type RGB = [number, number, number];

export const isHex = (s: string): boolean => /^#[0-9a-f]{6}$/i.test(s);
const toRgb = (h: string): RGB => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)) as RGB;
const toHex = (c: RGB): string => '#' + c.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const lin = (v: number): number => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c: RGB): number => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
export function contrast(a: string, b: string): number {
  const x = lum(toRgb(a)), y = lum(toRgb(b));
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
const mix = (a: string, b: string, t: number): string => { const x = toRgb(a), y = toRgb(b); return toHex([0, 1, 2].map((i) => x[i] * (1 - t) + y[i] * t) as RGB); };
const round2 = (n: number): number => Math.round(n * 100) / 100;

function variant(c: string, theme: 'light' | 'dark'): AccentVariant | null {
  const s = ACCENT_SURFACES[theme];
  const soft = mix(c, s.panel, theme === 'light' ? 0.9 : 0.78);
  const surfaces = [s.panel, s.canvas, s.hover, s.pressed, soft];
  const worst = Math.min(...surfaces.map((x) => contrast(c, x)));
  if (worst < TEXT) return null;
  const onAccent = contrast(s.ink, c) >= TEXT ? s.ink : contrast(s.inkAlt, c) >= TEXT ? s.inkAlt : null;
  if (!onAccent) return null;
  const hover = theme === 'light' ? mix(c, BLACK, 0.18) : mix(c, WHITE, 0.25);
  return { accent: c, hover, soft, onAccent, ratios: { onAccent: round2(contrast(onAccent, c)), worstSurface: round2(worst) } };
}

/** Light: darken towards black; dark: lighten towards white; the first step that passes every rule wins (step 1/200). */
function search(hex: string, theme: 'light' | 'dark'): AccentVariant | null {
  const target = theme === 'light' ? BLACK : WHITE;
  for (let i = 0; i <= 200; i++) { const v = variant(mix(hex, target, i / 200), theme); if (v) return v; }
  return null;
}

export function deriveAccent(input: string): DerivedAccent {
  const hex = String(input ?? '').trim().toLowerCase();
  const empty: AccentVariant = { accent: '', hover: '', soft: '', onAccent: '', ratios: { onAccent: 0, worstSurface: 0 } };
  // lint-colors-ignore: the example colour in the message
  if (!isHex(hex)) return { input: hex, ok: false, adjusted: false, light: empty, dark: empty, reason: 'The accent colour must look like #1a73e8.' };
  const light = search(hex, 'light'), dark = search(hex, 'dark');
  if (!light || !dark) return { input: hex, ok: false, adjusted: false, light: light ?? empty, dark: dark ?? empty, reason: `No ${!light ? 'light' : 'dark'}-theme shade of ${hex} keeps text readable (4.5:1); choose another colour.` };
  return { input: hex, ok: true, adjusted: light.accent !== hex || dark.accent !== hex, light, dark };
}
