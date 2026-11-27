// WP-19 / TH-003: the administrator accent is derived per theme and always readable; the server copy behaves identically.
import { describe, expect, it } from 'vitest';
import { ACCENT_SURFACES, DEFAULT_ACCENT, contrast, deriveAccent } from './accent';
import * as server from '../../../backend/src/services/accent';

const KNOWN = ['#ffcc00', '#1d3a8a', '#000000', '#ffffff', '#808080', '#2456c9', '#2563eb', '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'];
let seed = 20261127;
const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const RANDOM = Array.from({ length: 250 }, () => '#' + Array.from({ length: 3 }, () => Math.floor(rnd() * 256).toString(16).padStart(2, '0')).join(''));
const ALL = [...KNOWN, ...RANDOM];

describe('deriveAccent', () => {
  it('gives every valid colour a light and a dark variant that pass 4.5:1 for the text on it and on every surface it sits on', () => {
    for (const hex of ALL) {
      const d = deriveAccent(hex);
      expect(d.ok, hex).toBe(true);
      for (const theme of ['light', 'dark'] as const) {
        const v = d[theme], s = ACCENT_SURFACES[theme];
        expect(contrast(v.onAccent, v.accent), `${hex} ${theme} text on accent`).toBeGreaterThanOrEqual(4.5);
        for (const bg of [s.panel, s.canvas, s.hover, s.pressed, v.soft]) expect(contrast(v.accent, bg), `${hex} ${theme} accent on ${bg}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('repairs the two colours the audit found unreadable (#ffcc00 1.51:1 in light, #1d3a8a 1.77:1 in dark)', () => {
    const y = deriveAccent('#ffcc00');
    expect(y.adjusted).toBe(true);
    expect(y.light.accent).not.toBe('#ffcc00');
    const n = deriveAccent('#1d3a8a');
    expect(n.adjusted).toBe(true);
    expect(n.light.accent).toBe('#1d3a8a');            // already fine in light
    expect(n.dark.accent).not.toBe('#1d3a8a');         // lightened for the dark theme
  });

  it('keeps the default accent as it is in the light theme', () => {
    expect(deriveAccent(DEFAULT_ACCENT).light.accent).toBe(DEFAULT_ACCENT);
  });

  it('refuses what is not a #rrggbb colour', () => {
    for (const bad of ['', 'red', '#fff', '#12345g', 'javascript:alert(1)']) expect(deriveAccent(bad).ok, bad).toBe(false);
  });

  it('is the same function the server validates with (backend/src/services/accent.ts)', () => {
    expect(server.DEFAULT_ACCENT).toBe(DEFAULT_ACCENT);
    expect(server.ACCENT_SURFACES).toEqual(ACCENT_SURFACES);
    for (const hex of [...ALL, 'nope', '#abc']) expect(server.deriveAccent(hex), hex).toEqual(deriveAccent(hex));
  });
});
