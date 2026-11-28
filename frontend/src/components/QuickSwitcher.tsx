// WP-22 (UX-021, 06 section 6.3): "Jump to…" (Ctrl+K) on every platform and project page: type a few letters of a project, a page, or - inside an
// S1000D project - a data module's title or code, and Enter opens it. The editors keep Ctrl+K for their own command palette (editors/host,
// the Studio): while an editor page is shown this switcher leaves the key alone, and its button in the page header is the way in.
//
// The list behaves as the command palette's (editors/host/CommandPalette.tsx: arrows, Enter, typing filters by every word), filled from what
// the signed-in person can see: the navigation for their role, their projects, and the open project's sections and data modules.
// Global UI pass (2026-11-28): it is drawn as the mockups' palette (docs/audit/mockups/editor.html #palette; components.css .palette): a search
// row with the icon and the Esc key, the results under group headings, each with its icon, and a foot naming the keys. Same roles and test
// ids as before (a modal dialog named "Jump to", palette-input as the combobox, palette-list as the listbox).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentApi, workspaceApi, type Summary } from '../api';
import type { PaletteCommand } from '../editors/host/CommandPalette';
import { dialogOpen } from '../editors/host/useHostKeys';
import { projectRailItems } from '../layouts/projectRail';
import { gitlabApi } from '../api/gitlab';
import { Icon, type IconName } from './Icon';

export interface SwitcherPage { to: string; label: string }

const TEXT = { title: 'Jump to', placeholder: 'A project, a page or a data module…', label: 'Jump to', none: 'Nothing matches' };
const words = (s: string): string[] => s.toLowerCase().split(/\s+/).filter(Boolean);
/** The icon of a result by its group (a project's own sections are grouped under the project's name). */
const GROUP_ICON: Record<string, IconName> = { Page: 'dashboard', Project: 'folder', Repository: 'book2', 'Data module': 'file' };

/** The mockup palette over a scrim: type to filter, Up/Down to move, Enter to open, Escape or a click outside to close. */
function JumpPalette({ commands, onClose }: { commands: PaletteCommand[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [at, setAt] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // the results by group, in the order the groups first appear; the keyboard moves through them in that order
  const groups = useMemo(() => {
    const w = words(q);
    const out = new Map<string, PaletteCommand[]>();
    for (const c of commands) {
      if (!w.every((x) => `${c.label} ${c.group}`.toLowerCase().includes(x))) continue;
      out.set(c.group, [...(out.get(c.group) ?? []), c]);
    }
    return [...out.entries()];
  }, [commands, q]);
  const shown = useMemo(() => groups.flatMap(([, cs]) => cs), [groups]);
  useEffect(() => { setAt(0); }, [q]);
  useEffect(() => { listRef.current?.querySelector<HTMLElement>(`[data-i="${at}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [at]);
  // focus in on open, back to the trigger on close; Escape closes (the callback is read through a ref: the shells pass a new one each render)
  const close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !e.defaultPrevented) { e.preventDefault(); close.current(); } };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); if (trigger?.isConnected && typeof trigger.focus === 'function') trigger.focus(); };
  }, []);
  const pick = (c: PaletteCommand | undefined) => { if (!c || c.disabled) return; onClose(); setTimeout(() => c.run(), 0); };
  let i = -1;
  return (
    <div className="palette-scrim open" role="dialog" aria-modal="true" aria-label={TEXT.title} data-testid="jump-palette"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="palette">
        <div className="q">
          <Icon name="search" size={20} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={TEXT.placeholder} aria-label={TEXT.label} data-testid="palette-input"
            role="combobox" aria-expanded="true" aria-controls="palette-list" aria-activedescendant={shown[at] ? `palette-${at}` : undefined}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setAt((n) => Math.min(shown.length - 1, n + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setAt((n) => Math.max(0, n - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); pick(shown[at]); }
              else if (e.key === 'Tab') e.preventDefault();   // the only control: focus stays in the palette
            }} />
          <span className="kbd-group"><kbd>Esc</kbd></span>
        </div>
        <div className="palette-list" id="palette-list" role="listbox" aria-label="Results" ref={listRef} data-testid="palette-list">
          {shown.length ? groups.map(([g, cs]) => (
            <div key={g} role="group" aria-label={g}>
              <div className="grp" aria-hidden="true">{g}</div>
              {cs.map((c) => {
                i += 1; const n = i;
                return (
                  <div key={c.id} id={`palette-${n}`} data-i={n} role="option" aria-selected={n === at} aria-disabled={c.disabled || undefined}
                    className={`opt${n === at ? ' active' : ''}${c.disabled ? ' off' : ''}`}
                    onMouseMove={() => setAt(n)} onMouseDown={(e) => e.preventDefault()} onClick={() => pick(c)}>
                    <Icon name={GROUP_ICON[c.group] ?? 'tree'} /><span className="trunc grow">{c.label}</span>{c.keys ? <span className="kbd-group k"><kbd>{c.keys}</kbd></span> : null}
                  </div>
                );
              })}
            </div>
          )) : <div className="palette-none" role="option" aria-selected="false" aria-disabled="true">{TEXT.none} “{q}”.</div>}
        </div>
        <div className="foot" aria-hidden="true"><span><kbd>↑</kbd> <kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span className="palette-foot-end"><kbd>Esc</kbd> close</span></div>
      </div>
    </div>
  );
}

/** An editor page is shown: Ctrl+K is its command palette. */
const editorShown = (): boolean => !!document.querySelector('[data-testid="editor-header"]');

export function useQuickSwitcher(): { open: boolean; setOpen: (v: boolean) => void } {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || dialogOpen() || editorShown()) return;
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); setOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return { open, setOpen };
}

/** The header button that opens the switcher (it names the key). */
export function JumpButton({ onClick, compact }: { onClick: () => void; /** the project shell's shorter trigger ("Jump to…") */ compact?: boolean }) {
  // UI redesign step 1: the mockups' `.search-trigger` in the top bar (a well with the hint and the Ctrl K keys)
  return (
    <button type="button" className={`search-trigger v2-jump${compact ? ' compact' : ''}`} onClick={onClick} data-testid="jump-open" title="Jump to a project, a page or a data module (Ctrl+K)" aria-keyshortcuts="Control+K">
      <Icon name="search" /><span className="v2-jump-label trunc">{compact ? 'Jump to…' : 'Search projects, pages, modules…'}</span><span className="kbd-group"><kbd>Ctrl</kbd><kbd>K</kbd></span>
    </button>
  );
}

export function QuickSwitcher({ pages, project, onClose }: { pages: SwitcherPage[]; project?: { id: string; summary: Summary } | null; onClose: () => void }) {
  const nav = useNavigate();
  const go = useCallback((to: string) => () => nav(to), [nav]);
  const [items, setItems] = useState<PaletteCommand[]>(() => [
    ...(project ? projectRailItems(project.id, project.summary).map((i) => ({ id: `section:${i.to}`, label: i.label, group: project.summary.project.name, run: go(i.to) })) : []),
    ...pages.map((p) => ({ id: `page:${p.to}`, label: p.label, group: 'Page', run: go(p.to) })),
  ]);
  useEffect(() => {
    let live = true;
    workspaceApi.projects().then((list) => {
      if (!live) return;
      const projects = list.map((p) => ({ id: `project:${p.id}`, label: p.name, group: p.type === 'CIR' ? 'Repository' : 'Project', run: go(`/projects/${p.id}/${p.type === 'CIR' ? 'editor' : 'home'}`) }));
      setItems((cur) => [...cur.filter((c) => !c.id.startsWith('project:')), ...projects]);
    }, () => undefined);
    // phase 8: the Repository page (GitLab) is offered here exactly when the rail shows it: only while an administrator has GitLab on
    if (project) {
      void gitlabApi.enabled().then((on) => {
        if (!live || !on) return;
        const extra = projectRailItems(project.id, project.summary, { gitlab: true }).filter((i) => i.to.endsWith('/repository'))
          .map((i) => ({ id: `section:${i.to}`, label: i.label, group: project.summary.project.name, run: go(i.to) }));
        setItems((cur) => [...cur.filter((c) => !extra.some((x) => x.id === c.id)), ...extra]);
      });
    }
    const s1000d = project && (project.summary.project.format ?? 's1000d') === 's1000d' && project.summary.project.type !== 'CIR';
    if (project && s1000d) {
      contentApi.dms(project.id).then((dms) => {
        if (!live) return;
        const mods = dms.map((d) => ({ id: `dm:${d.file}`, label: `${d.title || d.techName || d.file} ${d.dmc}`.trim(), group: 'Data module', run: go(`/projects/${project.id}/editor?file=${encodeURIComponent(d.file)}`) }));
        setItems((cur) => [...cur.filter((c) => !c.id.startsWith('dm:')), ...mods]);
      }, () => undefined);
    }
    return () => { live = false; };
  }, [project, go]);
  return <JumpPalette commands={items} onClose={onClose} />;
}
