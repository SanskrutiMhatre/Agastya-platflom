import { create } from 'zustand';

export type ThemeChoice = 'system' | 'light' | 'dark';
const KEY = 'agastya.theme';

function read(): ThemeChoice {
  try { const v = localStorage.getItem(KEY); return v === 'light' || v === 'dark' ? v : 'system'; } catch { return 'system'; }
}

export function applyTheme(choice: ThemeChoice): void {
  // 'system' = the organisation default when the administrator set one (cached by store/appSettings.ts, TH-008), else the OS.
  let fallback: string | null = null;
  try { fallback = localStorage.getItem('agastya.theme.default'); } catch { /* private mode */ }
  const dark = choice === 'dark' || (choice === 'system' && (fallback === 'dark' || (fallback !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}

export interface Toast { id: number; kind: 'info' | 'error' | 'success'; text: string }

interface UiState {
  theme: ThemeChoice;
  setTheme: (t: ThemeChoice) => void;
  toasts: Toast[];
  toast: (text: string, kind?: Toast['kind']) => void;
  dismiss: (id: number) => void;
}

let seq = 0;
export const useUi = create<UiState>((set, get) => ({
  theme: read(),
  setTheme(t) {
    try { if (t === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, t); } catch { /* private mode */ }
    applyTheme(t);
    set({ theme: t });
  },
  toasts: [],
  toast(text, kind = 'info') {
    const id = ++seq;
    set({ toasts: [...get().toasts, { id, kind, text }].slice(-4) });
    // the timer lives in the toast itself (components/ui.tsx ToastItem): it pauses on hover and focus (DS-005)
  },
  dismiss(id) { set({ toasts: get().toasts.filter((t) => t.id !== id) }); },
}));
