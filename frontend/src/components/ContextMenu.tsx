// WP-35 (UID-005): one context menu for the platform pages (the Studio keeps its own inside the design view). It opens on a right-click,
// the keyboard Menu key or Shift+F10 on the element it is attached to, and it is fed by the SAME list of actions as the visible buttons of
// that row or heading, so nothing is ever only in the menu (the rule of the audit). Up/Down/Home/End move, Enter or Space chooses, Escape
// or Tab closes and returns the focus to where it was, a click elsewhere closes it.

import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon, type IconName } from './Icon';

export interface MenuAction {
  label: string;
  onSelect: () => void;
  icon?: IconName;
  danger?: boolean;
  disabled?: boolean;
}

type At = { x: number; y: number; actions: MenuAction[]; label: string; back: HTMLElement | null };

export function useContextMenu(): {
  /** Props for the element that owns the menu: right-click, the Menu key and Shift+F10 open it. */
  bind: (label: string, actions: MenuAction[]) => { onContextMenu: (e: ReactMouseEvent) => void; onKeyDown: (e: ReactKeyboardEvent) => void };
  menu: ReactNode;
} {
  const [at, setAt] = useState<At | null>(null);
  const bind = (label: string, actions: MenuAction[]) => ({
    onContextMenu: (e: ReactMouseEvent) => {
      if (!actions.length) return;
      e.preventDefault(); e.stopPropagation();
      setAt({ x: e.clientX, y: e.clientY, actions, label, back: document.activeElement as HTMLElement | null });
    },
    onKeyDown: (e: ReactKeyboardEvent) => {
      if (!actions.length || !(e.key === 'ContextMenu' || (e.key === 'F10' && e.shiftKey))) return;
      e.preventDefault(); e.stopPropagation();
      const r = (e.target as HTMLElement).getBoundingClientRect();
      setAt({ x: r.left + 8, y: r.bottom, actions, label, back: e.target as HTMLElement });
    },
  });
  const menu = at ? <MenuBox at={at} onClose={(refocus) => { const back = at.back; setAt(null); if (refocus && back?.isConnected) back.focus(); }} /> : null;
  return { bind, menu };
}

function MenuBox({ at, onClose }: { at: At; onClose: (refocus: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  // keep it inside the window
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(at.x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(at.y, window.innerHeight - r.height - 4)) });
  }, [at.x, at.y]);
  const items = () => [...(box.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  useEffect(() => { items()[0]?.focus(); }, []);
  useEffect(() => {
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) onClose(false); };
    const gone = () => onClose(false);
    document.addEventListener('mousedown', away, true);
    window.addEventListener('blur', gone); window.addEventListener('resize', gone);
    return () => { document.removeEventListener('mousedown', away, true); window.removeEventListener('blur', gone); window.removeEventListener('resize', gone); };
  }, [onClose]);
  const keys = (e: ReactKeyboardEvent) => {
    const list = items(); const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(true); }
    else if (e.key === 'Tab') { e.preventDefault(); onClose(true); }
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home' || e.key === 'End') { e.preventDefault(); list[e.key === 'Home' ? 0 : list.length - 1]?.focus(); }
  };
  return createPortal(
    <div ref={box} className="v2-ctx" role="menu" aria-label={at.label} style={{ left: pos.left, top: pos.top }} onKeyDown={keys} data-testid="context-menu">
      {at.actions.map((a) => (
        <button key={a.label} type="button" role="menuitem" tabIndex={-1} disabled={a.disabled} className={`v2-ctx-item${a.danger ? ' danger' : ''}`}
          onClick={() => { onClose(true); a.onSelect(); }}>
          {a.icon ? <Icon name={a.icon} size={14} /> : <span className="v2-ctx-pad" />}{a.label}
        </button>
      ))}
    </div>,
    document.body,
  );
}
