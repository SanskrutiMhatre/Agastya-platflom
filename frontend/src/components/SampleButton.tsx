import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { workspaceApi } from '../api';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { errText } from './ui';

/**
 * Creates a ready-made sample project and opens it: the S1000D one (three data modules, a figure, a three-chapter publication), a JSS User Handbook
 * (Land or Naval), or one of the two JSG documents. All of them hold dummy data.
 */
const KINDS = {
  s1000d: { label: 'Sample project', testid: 'create-sample', title: 'Create a ready-made project to try the platform', create: (f?: string) => workspaceApi.createSample(f) },
  'jss-land': { label: 'JSS Land sample', testid: 'create-jss-land-sample', title: 'Create a JSS Land User Handbook filled with dummy data to try the editor and the PDF', create: (f?: string) => workspaceApi.createJssSample(f, 'land') },
  'jss-naval': { label: 'JSS Naval sample', testid: 'create-jss-naval-sample', title: 'Create a JSS Naval User Handbook filled with dummy data to try the editor and the PDF', create: (f?: string) => workspaceApi.createJssSample(f, 'naval') },
  jsg: { label: 'JSG sample', testid: 'create-jsg-sample', title: 'Create a JSG User Handbook filled with dummy data to try the editor, the ancillary pages and the PDF', create: (f?: string) => workspaceApi.createJsgSample(f) },
  'jsg-ispl': { label: 'ISPL sample', testid: 'create-jsg-ispl-sample', title: 'Create a JSG Illustrated Spare Parts List filled with dummy data (plates and appendices) to try the editor, the ancillary pages and the PDF', create: (f?: string) => workspaceApi.createJsgSample(f, 'ispl') },
} as const;

export function SampleButton({ folder, onCreated, kind = 's1000d' }: { folder?: string; onCreated?: () => void; kind?: keyof typeof KINDS }) {
  const nav = useNavigate();
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState(false);
  const k = KINDS[kind];
  return (
    <button className="btn" disabled={busy} data-testid={k.testid} title={k.title} onClick={async () => {
      setBusy(true);
      try { const p = await k.create(folder); toast(`Created "${p.name}"`, 'success'); onCreated?.(); nav(`/projects/${p.id}`); }
      catch (e) { toast(errText(e), 'error'); setBusy(false); }
    }}><Icon name="layers" />{busy ? 'Creating…' : k.label}</button>
  );
}

/**
 * WP-35 (UX-014): the sample buttons stood beside New project on Overview, Workspace and Projects and crowded the first screens. They
 * now sit behind one "Samples" button (a disclosure: the five buttons, JSS Land and Naval added by d87dc48, with their ids and titles, appear under it). Nothing else changed:
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
        title="Create a ready-made sample project (S1000D, JSS Land or Naval User Handbook, JSG User Handbook or JSG Illustrated Spare Parts List) to try the platform" onClick={() => setOpen((o) => !o)}>
        <Icon name="layers" />Samples<Icon name="down" size={13} />
      </button>
      {open ? (
        <div id="sample-panel" className="v2-pop" role="group" aria-label="Sample projects">
          <SampleButton folder={folder} onCreated={onCreated} />
          <SampleButton kind="jss-land" folder={folder} onCreated={onCreated} />
          <SampleButton kind="jss-naval" folder={folder} onCreated={onCreated} />
          <SampleButton kind="jsg" folder={folder} onCreated={onCreated} />
          <SampleButton kind="jsg-ispl" folder={folder} onCreated={onCreated} />
        </div>
      ) : null}
    </div>
  );
}
