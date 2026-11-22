// Platform-wide look and name, set by the Administrator (Administrator > Settings / Visual settings)
// and applied for everyone once they are signed in.

import { create } from 'zustand';
import { platformApi, type AppSettings } from '../api';
import { applyTheme, useUi } from './ui';

const DEFAULTS: AppSettings = { appName: 'Agastya', organisation: '', accent: '', compact: false, theme: 'system' };

/** Put the settings on the page: accent colour, compact spacing, and the default theme (only until a person picks their own). */
export function applySettings(s: AppSettings): void {
  const root = document.documentElement;
  if (s.accent) { root.style.setProperty('--accent', s.accent); root.style.setProperty('--accent-soft', `${s.accent}26`); }
  else { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-soft'); }
  root.classList.toggle('v2-compact', s.compact);
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
