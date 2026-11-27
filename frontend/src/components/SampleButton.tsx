import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspaceApi } from '../api';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { errText } from './ui';

/**
 * Creates a ready-made sample project and opens it: the S1000D one (three data modules, a figure, a three-chapter publication), or with `kind="jsg"` the JSG User Handbook
 * (a real filled handbook: cover, certificate, associated handbooks, abbreviations, five chapters, 244 figures, 126 tables).
 */
export function SampleButton({ folder, onCreated, kind = 's1000d' }: { folder?: string; onCreated?: () => void; kind?: 's1000d' | 'jsg' | 'jsg-ispl' }) {
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  return (
    <button className="btn" disabled={busy} data-testid={kind === 'jsg' ? 'create-jsg-sample' : kind === 'jsg-ispl' ? 'create-jsg-ispl-sample' : 'create-sample'} title={kind === 'jsg' ? 'Create a ready-made JSG User Handbook (a real filled handbook) to try the editor, the ancillary pages and the PDF' : kind === 'jsg-ispl' ? 'Create a ready-made JSG Illustrated Spare Parts List (a real filled list with plates and appendices) to try the editor, the ancillary pages and the PDF' : 'Create a ready-made project to try the platform'} onClick={async () => {
      setBusy(true);
      try { const p = kind === 'jsg' ? await workspaceApi.createJsgSample(folder) : kind === 'jsg-ispl' ? await workspaceApi.createJsgSample(folder, 'ispl') : await workspaceApi.createSample(folder); toast(`Created "${p.name}"`, 'success'); onCreated?.(); nav(`/projects/${p.id}`); }
      catch (e) { toast(errText(e), 'error'); setBusy(false); }
    }}><Icon name="layers" />{busy ? 'Creating…' : kind === 'jsg' ? 'JSG sample' : kind === 'jsg-ispl' ? 'ISPL sample' : 'Sample project'}</button>
  );
}

/**
 * WP-35 (UX-014): the three sample buttons stood beside New project on Overview, Workspace and Projects and crowded the first screens. They
 * now sit behind one "Samples" button (a disclosure: the three buttons, with their ids and titles, appear under it). Nothing else changed:
 * each still creates its sample and opens it. Escape or a click elsewhere closes the panel.
 */
export function SampleMenu({ folder, onCreated }: { folder?: string; onCreated?: () => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return undefined;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);
  return (
    <div className="v2-pop-anchor" ref={box} onKeyDown={(e) => { if (e.key === 'Escape' && open) { e.preventDefault(); e.stopPropagation(); setOpen(false); toggle.current?.focus(); } }}>
      <button ref={toggle} type="button" className="btn" aria-expanded={open} aria-controls="sample-panel" data-testid="samples-menu"
        title="Create a ready-made sample project (S1000D, JSG User Handbook or JSG Illustrated Spare Parts List) to try the platform" onClick={() => setOpen((o) => !o)}>
        <Icon name="layers" />Samples<Icon name="down" size={13} />
      </button>
      {open ? (
        <div id="sample-panel" className="v2-pop" role="group" aria-label="Sample projects">
          <SampleButton folder={folder} onCreated={onCreated} />
          <SampleButton kind="jsg" folder={folder} onCreated={onCreated} />
          <SampleButton kind="jsg-ispl" folder={folder} onCreated={onCreated} />
        </div>
      ) : null}
    </div>
  );
}
