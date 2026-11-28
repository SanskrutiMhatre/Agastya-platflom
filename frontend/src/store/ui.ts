import { create } from 'zustand';

/** Owner rule (2026-11-28): two themes only, light and dark; there is no "follow the system" state. */
export type ThemeChoice = 'light' | 'dark';
const KEY = 'agastya.theme';
const DEFAULT_KEY = 'agastya.theme.default';

/** The theme a page starts in: the person's own choice, else the organisation default (cached by store/appSettings.ts, TH-008), else light.
 *  Anything else stored (an old "system", a typo) counts as no choice and is cleared. */
export function initialTheme(): ThemeChoice {
  try {
    const own = localStorage.getItem(KEY);
    if (own === 'light' || own === 'dark') return own;
    if (own !== null) localStorage.removeItem(KEY);
    return localStorage.getItem(DEFAULT_KEY) === 'dark' ? 'dark' : 'light';
  } catch { return 'light'; }
}

export function applyTheme(choice: ThemeChoice): void {
  document.documentElement.dataset.theme = choice === 'dark' ? 'dark' : 'light';
}

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

interface UiState {
  theme: ThemeChoice;
  /** The person picks a theme: it is remembered on this computer and applied at once. */
  setTheme: (t: ThemeChoice) => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useUi = create<UiState>((set, get) => ({
  theme: initialTheme(),
  setTheme(t) {
    const v: ThemeChoice = t === 'dark' ? 'dark' : 'light';
    try { localStorage.setItem(KEY, v); } catch { /* private mode */ }
    applyTheme(v);
    set({ theme: v });
  },
  toasts: [],
  toast(text, kind = 'info') {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, kind, text }].slice(-4) });
    // the timer lives in the toast itself (components/ui.tsx ToastItem): it pauses on hover and focus (DS-005)
  },
  dismiss(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },
}));
