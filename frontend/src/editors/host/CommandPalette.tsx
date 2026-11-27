// WP-21 (UX-017, 06 section 7.7): the command palette of the JSS and JSG editors (the S1000D Studio has its own, on the same keys).
//
// It lists the host's commands (save, check, build, find, layout, focus) and every button of the editor's own toolbar, by the name the button
// carries, so a command added to an editor's toolbar is in the palette without being written down twice. Typing filters; the arrow keys and
// Enter pick. The caret the author had in the document is put back before the command runs, so "Bold" or "Insert table" act where they were.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Modal } from '../../components/ui';

export interface PaletteCommand { id: string; label: string; group: string; keys?: string; disabled?: boolean; run: () => void }

/** The buttons of an editor toolbar as palette commands (`[data-cmd]` with a name), opening the toolbar tab that holds a button before pressing it. */
export function toolbarCommands(root: HTMLElement | null, group: string): PaletteCommand[] {
  if (!root) return [];
  const seen = new Set<string>(); const out: PaletteCommand[] = [];
  for (const b of root.querySelectorAll<HTMLButtonElement>('[role="toolbar"] button[data-cmd], .jsg-bar button[data-cmd]')) {
    const label = (b.getAttribute('aria-label') || b.title || b.textContent || '').replace(/\s*\((?:Ctrl|Shift|Tab|Enter)[^)]*\)\s*$/, '').trim();
    const id = `${group}.${b.dataset.cmd}`;
    if (!label || seen.has(id)) continue;
    seen.add(id);
    const keys = /\(((?:Ctrl|Shift)[^)]*)\)\s*$/.exec(b.title)?.[1];
    out.push({ id, label, group, keys, disabled: b.disabled, run: () => {
      const panel = b.closest<HTMLElement>('[role="tabpanel"]');
      if (panel?.hidden) {
        const name = panel.getAttribute('aria-label');
        const tab = [...(panel.parentElement?.parentElement?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])].find((t) => t.textContent?.trim() === name);
        tab?.click();
      }
      b.click();
    } });
  }
  return out;
}

const words = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);

export function CommandPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLUListElement>(null);
  // the caret in the document when the palette opened
  const saved = useRef<Range | null>(null);
  useEffect(() => { const s = window.getSelection(); saved.current = s && s.rangeCount ? s.getRangeAt(0).cloneRange() : null; }, []);

  const shown = useMemo(() => {
    const w = words(q);
    return commands.filter((c) => { const hay = `${c.label} ${c.group}`.toLowerCase(); return w.every((x) => hay.includes(x)); });
  }, [commands, q]);
  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [at]);

  const pick = (c: PaletteCommand | undefined) => {
    if (!c || c.disabled) return;
    onClose();
    // after the dialog has gone and focus is back where it was
    setTimeout(() => {
      const r = saved.current;
      if (r && r.startContainer.isConnected) {
        const host = (r.startContainer.nodeType === 1 ? r.startContainer as Element : r.startContainer.parentElement)?.closest<HTMLElement>('[contenteditable="true"]');
        host?.focus({ preventScroll: true });
        const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r);
      }
      c.run();
    }, 0);
  };

  return (
    <Modal title="Command palette" onClose={onClose} width={560}>
      <input className="v2-input" autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command…" aria-label="Command" data-testid="palette-input"
        role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[at] ? `palette-${at}` : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setAt((i) => Math.min(shown.length - 1, i + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((i) => Math.max(0, i - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); pick(shown[at]); }
        }} />
      <ul className="v2-palette" id="palette-list" role="listbox" aria-label="Commands" ref={listRef} data-testid="palette-list">
        {shown.length ? shown.map((c, i) => (
          <li key={c.id} id={`palette-${i}`} data-i={i} role="option" aria-selected={i === at} aria-disabled={c.disabled || undefined} className={`${i === at ? 'on' : ''}${c.disabled ? ' off' : ''}`}
            onMouseMove={() => setAt(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
            <span className="v2-palette-label">{c.label}</span><span className="v2-palette-group">{c.group}</span>{c.keys ? <kbd className="v2-kbd">{c.keys}</kbd> : null}
          </li>
        )) : <li className="v2-palette-none" role="option" aria-selected="false" aria-disabled="true">No command matches “{q}”.</li>}
      </ul>
    </Modal>
  );
}
