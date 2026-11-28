// Platform-wide look and name, set by the Administrator (Administrator > Settings / Visual settings)
// and applied for everyone once they are signed in.

import { create } from 'zustand';
import { platformApi, type AppSettings } from '../api';
import { applyTheme, useUi } from './ui';
import { deriveAccent } from '../lib/accent';

const ACCENT_TOKENS = { accent: 'accent', 'accent-hover': 'hover', 'surface-selected': 'soft', 'text-on-accent': 'onAccent', 'text-link': 'accent', 'focus-ring': 'accent' } as const;

/** WP-19 (TH-003): the accent is derived per theme (lib/accent.ts) and handed to the token layer as --admin-<token>-light / -dark; tokens.css falls back to the theme default when they are absent. */
export function applyAccent(hex: string): void {
  const root = document.documentElement;
  const d = hex ? deriveAccent(hex) : null;
  for (const [token, key] of Object.entries(ACCENT_TOKENS)) for (const theme of ['light', 'dark'] as const) {
    const name = `--admin-${token}-${theme}`;
    if (d?.ok) root.style.setProperty(name, d[theme][key]); else root.style.removeProperty(name);
  }
}

const DEFAULTS: AppSettings = { appName: 'Agastya', organisation: '', accent: '', compact: false, theme: 'system' };

/** Put the settings on the page: accent colour, compact spacing, and the default theme (only until a person picks their own). */
export function applySettings(s: AppSettings): void {
  const root = document.documentElement;
  applyAccent(s.accent);
  root.classList.toggle('v2-compact', s.compact);
  // TH-008: remember the organisation default so theme-init.js can paint it before the next sign-in (only while the person has no choice of their own).
  try { if (s.theme === 'system') localStorage.removeItem('agastya.theme.default'); else localStorage.setItem('agastya.theme.default', s.theme); } catch { /* private mode */ }
  let chosen: string | null = null;
  try { chosen = localStorage.getItem('agastya.theme'); } catch { /* private mode */ }
  if (!chosen && s.theme !== 'system') { useUi.setState({ theme: s.theme }); applyTheme(s.theme); }
}

interface AppState { settings: AppSettings; load: () => Promise<void>; set: (s: AppSettings) => void }

export const useApp = create<AppState>((set) => ({
  settings: DEFAULTS,
  async load() { try { const s = await platformApi.settings(); set({ settings: s }); applySettings(s); } catch { /* signed out: keep the defaults */ } },
  set(s) { set({ settings: s }); applySettings(s); },
}));
