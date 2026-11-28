// WP-21 (UX-003, UX-017, 06 section 7.7): the keys the editor host itself answers, the same in the three editors.
//
//   Ctrl+K, Ctrl+Shift+P   command palette          F1                  keyboard shortcuts
//   Ctrl+.                 focus mode (only the page and a slim header)
//   Ctrl+F, Ctrl+H         find, find and replace   (the JSS editor; JSG and the Studio have their own find bar on the same keys)
//   Escape                 close the find bar, or leave focus mode
//   Alt+Shift+N, Alt+Shift+P   next, previous review comment (WP-22, UX-009; the comments panel opens)
//   Ctrl+Shift+B, Ctrl+J, Ctrl+Alt+Shift+B   show or hide the explorer, the Problems panel, the Properties panel (UI redesign; VS Code's
//                          Ctrl+B and Ctrl+Alt+B are Bold and the Studio's bulleted list here, so they take a Shift)
//   Ctrl+Shift+1, 2, 3     Editor only, Editor and PDF side by side, PDF only
//
// The handler listens on the window after the editors' own handlers: a key an editor has already taken (preventDefault) is left alone, and nothing
// happens while a dialog is open. The S1000D Studio has the palette, F1 and Ctrl+. in its own command registry; when the keyboard is in the Studio it
// answers them itself and this handler only sees them from the page header. Every key here is listed in lib/editorShortcuts.ts (editor 'host').

import { useEffect, useRef } from 'react';

export interface HostKeyActions {
  palette?: () => void;
  shortcuts?: () => void;
  focus?: () => void;
  /** open find (false) or find and replace (true); undefined where the editor has its own find bar */
  find?: (replace: boolean) => void;
  /** WP-22: step to the next (1) or previous (-1) open review comment */
  comment?: (dir: 1 | -1) => void;
  /** Escape: close what the host has open; returns true when it closed something */
  escape?: () => boolean;
  /** UI redesign: show or hide a panel of the workspace */
  panel?: (p: 'explorer' | 'problems' | 'props') => void;
  /** UI redesign: Editor only, Split, PDF only */
  view?: (v: 'edit' | 'split' | 'pdf') => void;
}

/** A dialog (the platform's, the Studio's, a JSS/JSG one) or a pop-up menu is open: the keys belong to it. */
export const dialogOpen = (): boolean => !!document.querySelector('.modal-backdrop, dialog[open], [role="dialog"][aria-modal="true"]');

export function useHostKeys(actions: HostKeyActions, enabled = true): void {
  const ref = useRef(actions); ref.current = actions;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || dialogOpen()) return;
      const a = ref.current; const mod = e.ctrlKey || e.metaKey; const raw = e.key.toLowerCase();
      // the key as printed on it where the key value is no use (Shift turns 1 into !, Ctrl+Alt may compose a character, a non-Latin layout has
      // no Latin B), as the Studio reads its keys (studio/ui/app.ts keyOf)
      const k = /^[a-z0-9]$/.test(raw) ? raw : /^Key[A-Z]$/.test(e.code) ? e.code.slice(3).toLowerCase() : /^Digit\d$/.test(e.code) ? e.code.slice(5) : raw;
      if (mod && !e.altKey && (k === 'k' || (e.shiftKey && k === 'p')) && a.palette) { e.preventDefault(); a.palette(); return; }
      if (e.key === 'F1' && !mod && a.shortcuts) { e.preventDefault(); a.shortcuts(); return; }
      if (mod && !e.shiftKey && !e.altKey && k === '.' && a.focus) { e.preventDefault(); a.focus(); return; }
      if (mod && !e.shiftKey && !e.altKey && (k === 'f' || k === 'h') && a.find) { e.preventDefault(); a.find(k === 'h'); return; }
      if (e.altKey && e.shiftKey && !mod && (k === 'n' || k === 'p') && a.comment) { e.preventDefault(); a.comment(k === 'n' ? 1 : -1); return; }
      // the panels (explorer, Problems, Properties) and the layout (Editor, Split, PDF)
      if (mod && e.shiftKey && k === 'b' && a.panel) { e.preventDefault(); a.panel(e.altKey ? 'props' : 'explorer'); return; }
      if (mod && !e.shiftKey && !e.altKey && k === 'j' && a.panel) { e.preventDefault(); a.panel('problems'); return; }
      if (mod && e.shiftKey && !e.altKey && (k === '1' || k === '2' || k === '3') && a.view) { e.preventDefault(); a.view(k === '1' ? 'edit' : k === '2' ? 'split' : 'pdf'); return; }
      if (e.key === 'Escape' && a.escape) {
        const t = e.target as HTMLElement | null;
        if (t?.closest?.('[role="menu"], .jsg-find, .find-bar')) return;          // a menu or another find bar closes itself
        if (a.escape()) e.preventDefault();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}
