// WP-22 (UX-021, 06 section 6.3): "Jump to…" (Ctrl+K) on every platform and project page: type a few letters of a project, a page, or - inside an
// S1000D project - a data module's title or code, and Enter opens it. The editors keep Ctrl+K for their own command palette (editors/host,
// the Studio): while an editor page is shown this switcher leaves the key alone, and its button in the page header is the way in.
//
// The list is the command palette's (editors/host/CommandPalette.tsx: arrows, Enter, typing filters by every word), filled from what the
// signed-in person can see: the navigation for their role, their projects, and the open project's sections and data modules.

import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { contentApi, workspaceApi, type Summary } from '../api';
import { CommandPalette, type PaletteCommand } from '../editors/host/CommandPalette';
import { dialogOpen } from '../editors/host/useHostKeys';
import { projectRailItems } from '../layouts/projectRail';
import { Icon } from './Icon';

export interface SwitcherPage { to: string; label: string }

const TEXT = { title: 'Jump to', placeholder: 'A project, a page or a data module…', label: 'Jump to', none: 'Nothing matches' };

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
  return <CommandPalette commands={items} onClose={onClose} text={TEXT} />;
}
