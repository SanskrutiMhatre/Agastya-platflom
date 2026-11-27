// WP-23 (UX-005, FE-014; WCAG 2.2 AA 2.1.1, 2.4.1, 2.4.2, 2.4.3, 4.1.2): the small accessible building blocks the shells and pages share.
//   SkipLink          the first stop of Tab on every signed-in page: moves focus to the page's main landmark (bypass blocks)
//   useDocumentTitle  a title per route ("Projects · Agastya Platform"), so tabs, history and screen readers tell pages apart
//   HeadingLevel      the level PageHeader uses: 2 under the main shell (its top bar holds the page's h1), 1 elsewhere
//   RowLink/RowButton the keyboard target of a clickable table row (a real link or button in the row, the row click stays)
//   tablistKeys       arrow keys, Home and End between the tabs of a platform tab strip
//   splitterKeys      arrow keys, Home and End on a resize divider (role="separator")

import { createContext, useContext, useEffect, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';

export const MAIN_ID = 'main-content';

/** Visually hidden until it has keyboard focus. A click moves focus to the main landmark without touching the address (no #hash route). */
export function SkipLink({ target = MAIN_ID }: { target?: string }) {
  const go = (e: ReactMouseEvent<HTMLAnchorElement>) => {
    const el = document.getElementById(target);
    if (!el) return;
    e.preventDefault();
    el.focus();
    el.scrollIntoView?.({ block: 'start' });
  };
  return <a className="v2-skip" href={`#${target}`} onClick={go} data-testid="skip-link">Skip to main content</a>;
}

export function useDocumentTitle(...parts: Array<string | null | undefined>): void {
  const title = parts.map((p) => (p ?? '').trim()).filter(Boolean).filter((p, i, all) => all.indexOf(p) === i).join(' · ');
  useEffect(() => { if (title) document.title = title; }, [title]);
}

const Level = createContext<1 | 2>(1);
export function HeadingLevel({ level, children }: { level: 1 | 2; children: ReactNode }) { return <Level.Provider value={level}>{children}</Level.Provider>; }
export const useHeadingLevel = (): 1 | 2 => useContext(Level);

/** A link in the first cell of a row that opens something: Tab reaches it, Enter follows it, Ctrl/middle click opens a new tab. */
export function RowLink({ href, onOpen, children, testId }: { href: string; onOpen: () => void; children: ReactNode; testId?: string }) {
  return (
    <a className="v2-row-link" href={href} data-testid={testId}
      onClick={(e) => { e.stopPropagation(); if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return; e.preventDefault(); onOpen(); }}>{children}</a>
  );
}

/** A button in a row that selects it (the row's detail opens beside the table). */
export function RowButton({ onSelect, selected, children, label }: { onSelect: () => void; selected?: boolean; children: ReactNode; label?: string }) {
  return (
    <button type="button" className="v2-row-link" aria-pressed={selected ?? undefined} aria-label={label} onClick={(e) => { e.stopPropagation(); onSelect(); }}>{children}</button>
  );
}

/** onKeyDown for an element with role="tablist": Left/Right (Up/Down) move focus to the neighbouring tab, Home/End to the first/last. */
export function tablistKeys(e: ReactKeyboardEvent<HTMLElement>): void {
  const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
  if (!(e.key in keys) && e.key !== 'Home' && e.key !== 'End') return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]')).filter((t) => !t.hasAttribute('disabled') && t.getAttribute('aria-disabled') !== 'true');
  const at = tabs.indexOf(document.activeElement as HTMLElement);
  if (at < 0 || !tabs.length) return;
  e.preventDefault();
  const next = e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (at + keys[e.key] + tabs.length) % tabs.length;
  tabs[next].focus();
}

/**
 * onKeyDown for a resize divider: Left/Right change the value by `step`, PageUp/PageDown by four steps, Home/End go to the limits.
 * `commit` stores the new value (the same place a drag stores it).
 */
export function splitterKeys(value: number, min: number, max: number, step: number, commit: (v: number) => void) {
  return (e: ReactKeyboardEvent<HTMLElement>): void => {
    const delta: Record<string, number> = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: 4 * step, PageDown: -4 * step };
    let v: number;
    if (e.key === 'Home') v = min; else if (e.key === 'End') v = max; else if (e.key in delta) v = value + delta[e.key]; else return;
    e.preventDefault();
    commit(Math.min(max, Math.max(min, Math.round(v))));
  };
}
