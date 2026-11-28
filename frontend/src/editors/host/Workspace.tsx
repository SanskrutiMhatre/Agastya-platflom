// UI redesign (owner-approved mockups 2026-11-28, docs/audit/mockups/editor.html): the pieces of the editor workspace the three editor pages
// share around their canvases: the shell slots (the editor's top bar and status bar span the whole window, as drawn), the open-document tabs,
// the status bar, the Problems panel, the Properties panel and a resizable side pane. The canvases (S1000D Studio, JSS sheet, JSG editor) keep
// their own editing, commands and keys (D16); these only frame them.

import { useCallback, useLayoutEffect, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/Icon';

const read = (key: string): string | null => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key: string, v: string): void => { try { localStorage.setItem(key, v); } catch { /* private mode */ } };

/**
 * The project shell draws no top bar and no status bar on the editor page (layouts/ProjectShell.tsx): the editor's own are placed in the
 * shell's grid as the mockup draws them, the top bar over the activity bar and the workspace, the status bar under both. `top` is put after the
 * skip link (first in the tab order after it), `status` at the end. The grid rows are in styles/pages/editor-host.css.
 */
export function useShellSlot(kind: 'top' | 'status'): HTMLElement | null {
  const [el, setEl] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    const app = document.querySelector<HTMLElement>('.app.project');
    if (!app) return;
    const slot = document.createElement('div');
    slot.className = kind === 'top' ? 'ed-topslot' : 'ed-statusslot';
    if (kind === 'top') app.insertBefore(slot, app.querySelector(':scope > .activity'));
    else app.appendChild(slot);
    setEl(slot);
    return () => { slot.remove(); };
  }, [kind]);
  return el;
}

/** A side pane's width, dragged on its 1 px separator or moved with the arrow keys (WCAG 2.1.1), remembered under `key`.
 *  `side` is where the pane sits: a right-hand pane grows when the separator moves left. */
export function usePaneWidth(key: string, def: number, min: number, max: number, side: 'left' | 'right', onResize?: () => void) {
  const [width, setWidth] = useState(() => Math.min(max, Math.max(min, Number(read(key)) || def)));
  const [dragging, setDragging] = useState(false);
  const commit = useCallback((w: number) => { setWidth(w); write(key, String(w)); onResize?.(); }, [key, onResize]);
  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    e.preventDefault();
    const x0 = e.clientX; const w0 = width; let last = w0;
    setDragging(true);
    const move = (ev: PointerEvent) => { const d = ev.clientX - x0; last = Math.min(max, Math.max(min, Math.round(side === 'left' ? w0 + d : w0 - d))); setWidth(last); };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); setDragging(false); commit(last); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    const grow = side === 'left' ? 'ArrowRight' : 'ArrowLeft'; const shrink = side === 'left' ? 'ArrowLeft' : 'ArrowRight';
    let w: number;
    if (e.key === grow) w = width + 16; else if (e.key === shrink) w = width - 16; else if (e.key === 'Home') w = min; else if (e.key === 'End') w = max; else return;
    e.preventDefault(); commit(Math.min(max, Math.max(min, w)));
  };
  const separator = (label: string, className = '') => ({
    className: `panel-resize${className ? ` ${className}` : ''}${dragging ? ' drag' : ''}`, role: 'separator', 'aria-orientation': 'vertical' as const, 'aria-label': label,
    'aria-valuenow': width, 'aria-valuemin': min, 'aria-valuemax': max, tabIndex: 0, onPointerDown, onKeyDown,
  });
  return { width, dragging, separator };
}

/** An on/off choice remembered under `key`; `def` decides the first visit. */
export function useRemembered(key: string, def: () => boolean): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => { const v = read(key); return v === '1' ? true : v === '0' ? false : def(); });
  const set = useCallback((v: boolean) => { setOn(v); write(key, v ? '1' : '0'); }, [key]);
  return [on, set];
}

export interface DocTab { key: string; title: string; hint?: string; dirty?: boolean; dot?: 'danger' | 'warning'; active?: boolean; onSelect?: () => void }

/** The open-document tabs (the JSS and JSG pages hold one document; the S1000D Studio draws its own tabs in the same style). */
export function DocTabs({ tabs, children }: { tabs: DocTab[]; children?: ReactNode }) {
  return (
    <div className="doctabs" role="tablist" aria-label="Open documents" data-testid="doc-tabs">
      {tabs.map((t) => (
        <div key={t.key} className="doctab" role="tab" aria-selected={t.active ?? true} tabIndex={0} title={t.hint ?? t.title} onClick={t.onSelect}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && t.onSelect) { e.preventDefault(); t.onSelect(); } }}>
          <Icon name="file" size={14} className="ico sm" /><span className="trunc">{t.title}</span>
          {t.dirty ? <span className="mod" title="Unsaved changes" aria-label="Unsaved changes">●</span> : t.dot ? <span className={`dot ${t.dot}`} aria-hidden="true" /> : null}
        </div>
      ))}
      {children}
    </div>
  );
}

/** The bar under the whole window (placed in the shell's grid): save state, problems, position and mode. */
export function StatusBar({ children, testId }: { children: ReactNode; testId?: string }) {
  const slot = useShellSlot('status');
  const bar = <footer className="statusbar ed-statusbar" aria-label="Status bar" data-testid={testId}>{children}</footer>;
  return slot ? createPortal(bar, slot) : bar;
}

export interface ProblemItem { severity: 'error' | 'warning' | string; message: string; rule?: string; location?: string; line?: number }

export const problemCounts = (items: ProblemItem[]) => ({ errors: items.filter((f) => f.severity === 'error').length, warnings: items.filter((f) => f.severity !== 'error').length });

/** The Problems panel under the document (the findings of the editor's last check), drawn as the mockup's: a tab strip and one row a finding. */
export function ProblemsPanel({ items, onClose, onPick, onCheck, checking }: { items: ProblemItem[]; onClose: () => void; onPick?: (p: ProblemItem) => void; onCheck?: () => void; checking?: boolean }) {
  const { errors, warnings } = problemCounts(items);
  return (
    <section className="pane problems" aria-label="Problems" data-testid="doc-problems"
      onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
      <div className="tabs" role="tablist" aria-label="Problems panel">
        <button className="tab" role="tab" aria-selected="true" type="button">Problems{errors ? <span className="badge danger">{errors}</span> : warnings ? <span className="badge warning">{warnings}</span> : null}</button>
        <span className="grow-r">
          {onCheck ? <button className="btn sm subtle" type="button" onClick={onCheck} disabled={checking} title="Check the document again">Check again</button> : null}
          <button className="icon-btn" type="button" onClick={onClose} aria-label="Collapse the Problems panel" title="Collapse (Esc)"><Icon name="down" size={14} className="ico sm" /></button>
        </span>
      </div>
      <ul className="plist" aria-label="Problems in this document">
        {items.length ? items.map((p, i) => (
          <li key={i} className={`prob${p.severity === 'error' ? '' : ' w'}`} tabIndex={onPick ? 0 : -1} onClick={onPick ? () => onPick(p) : undefined}
            onKeyDown={onPick ? (e) => { if (e.key === 'Enter') onPick(p); } : undefined}>
            <span className="ico"><Icon name={p.severity === 'error' ? 'xcircle' : 'warn'} size={14} /></span>
            <span className="trunc" title={p.message}>{p.message}</span>
            {p.rule ? <span className="badge">{p.rule}</span> : <span />}
            <span className="mono faint" title={p.location}>{p.location || (p.line ? `line ${p.line}` : '')}</span>
          </li>
        )) : <li className="prob-none">No problems found by the last check.</li>}
      </ul>
    </section>
  );
}

export interface PropsTab { id: string; label: string; badge?: number }

/** The Properties panel at the right of the workspace: the mockup's tab strip (Element, Document, Comments) over the panel body. */
export function PropsPanel({ tabs, tab, onTab, children }: { tabs: PropsTab[]; tab: string; onTab: (id: string) => void; children: ReactNode }) {
  return (
    <aside className="pane props" aria-label="Properties" data-testid="doc-props">
      <div className="tabs" role="tablist" aria-label="Properties">
        {tabs.map((t) => (
          <button key={t.id} type="button" className="tab" role="tab" aria-selected={t.id === tab} onClick={() => onTab(t.id)} data-testid={`props-tab-${t.id}`}>
            {t.label}{t.badge ? <span className="badge accent">{t.badge}</span> : null}
          </button>
        ))}
      </div>
      <div className="props-body">{children}</div>
    </aside>
  );
}

/** One "name  value" row of the Properties panel (the mockup's .attr row: the name in mono at the left, the value at the right). */
export function PropRow({ name, children }: { name: string; children: ReactNode }) {
  return <div className="attr"><span className="attr-k mono">{name}</span><span className="attr-v">{children}</span></div>;
}
