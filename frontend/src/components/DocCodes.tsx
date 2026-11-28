// The S1000D metadata of a JSS / JSG project - document codes (DMC), publication code (PMC), picture names (ICN) and contents list - and the conversion to another format.
//
// The server makes and keeps them (backend/src/services/xengine). They are SHOWN on the project's own pages, never on the editor page: Publication (the chapters with the code of
// each section, the publication identity, the picture names) and Explore (the same as a hierarchy, a table and a picture list, with a detail panel). What stays here:
//   useSectionCode      the code beside a section's heading in the editor, only while the author has switched it on (a badge in the heading, not a panel)
//   <ConvertButton>     "Convert to ..." as a new project, with what could not be carried over
//   <ExportProjectButton>  "Export": the whole project as one archive (.jsspub.zip), for every format; a project made here or imported and edited

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { xengineApi, FORMAT_LABEL, type Conversion, type ConvertResult, type DocCodes, type Format, type XFinding } from '../api/xengine';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { Callout, Modal, Spinner, errText } from './ui';

// One copy of a project's codes, kept while the author moves between the pages that use them.
interface CodesStore { byProject: Record<string, DocCodes | null>; put: (id: string, c: DocCodes | null) => void }
const useCodes = create<CodesStore>((set) => ({ byProject: {}, put: (id, c) => set((s) => ({ byProject: { ...s.byProject, [id]: c } })) }));

/** Load a project's codes; `refresh` loads them again (after a save). A project that cannot have them (an S1000D project) gives null. */
function useDocCodes(id: string, refreshKey: unknown): { codes: DocCodes | null; reload: () => Promise<void> } {
  const codes = useCodes((s) => s.byProject[id] ?? null); const put = useCodes((s) => s.put);
  const reload = useCallback(async () => { try { put(id, await xengineApi.codes(id)); } catch { put(id, null); } }, [id, put]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  return { codes, reload };
}


/**
 * What to show beside a section's heading in the editor: its data module code. Only while the "Document codes (DMC)" switch is on; nothing (undefined) while it is off.
 * The function returns null for a section that is not a data module of the package (a sub-section).
 */
export function useSectionCode(id: string, refreshKey?: unknown): ((s: { id?: string; title: string }, chapter: number) => string | null) | undefined {
  const { codes } = useDocCodes(id, refreshKey);
  return useMemo(() => {
    if (!codes?.show.dmc) return undefined;
    const byKey = new Map(codes.modules.map((m) => [m.key, m.dmc]));
    const norm = (t: string): string => t.replace(/[‘’´`]/g, "'").replace(/\s+/g, ' ').trim().toLowerCase();
    return (s, chapter) => (chapter ? ((s.id ? byKey.get(`id:${s.id}`) : undefined) ?? byKey.get(`t:${chapter}:${norm(s.title)}`) ?? null) : null);
  }, [codes]);
}

export function FindingsList({ list }: { list: XFinding[] }) {
  const groups: Array<[XFinding['severity'], string]> = [['error', 'Must be fixed'], ['warning', 'Please review'], ['info', 'For your information']];
  if (!list.length) return <p className="v2-hint">Nothing to report.</p>;
  return <>{groups.map(([sev, title]) => { const items = list.filter((f) => f.severity === sev); return items.length ? (
    <section key={sev} style={{ marginBottom: 10 }}>
      <h3 style={{ fontSize: 13, margin: '0 0 4px' }}>{title} ({items.length})</h3>
      <ul style={{ margin: 0, paddingLeft: 18 }}>{items.map((f, i) => <li key={i} style={{ marginBottom: 2 }}>{f.message}{f.where ? <span className="v2-hint"> — {f.where}</span> : null}</li>)}</ul>
    </section>) : null; })}</>;
}

/**
 * Export the whole project as one archive (.jsspub.zip: its files, house style, logos and review comments), for any format. What is open is saved first. The archive comes
 * back as the same project through Import (it is a new project; nothing is replaced).
 */
export function ExportProjectButton({ id, dirty = false, saveFirst, small = true, label = 'Export' }: { id: string; dirty?: boolean; saveFirst?: () => Promise<boolean>; small?: boolean; label?: string }) {
  const toast = useUi((s) => s.toast); const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      if (dirty && saveFirst && !(await saveFirst())) return;
      const r = await fetch(`/api/projects/${encodeURIComponent(id)}/export`, { credentials: 'same-origin' });
      if (!r.ok) { const b = await r.json().catch(() => null) as { error?: string } | null; throw new Error(b?.error ?? `The export failed (${r.status}).`); }
      const file = /filename="?([^";]+)"?/.exec(r.headers.get('Content-Disposition') ?? '')?.[1] ?? `${id}.jsspub.zip`;
      const a = document.createElement('a'); a.href = URL.createObjectURL(await r.blob()); a.download = file; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      toast('Project exported.', 'success');
    } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  return <button type="button" className={small ? 'btn sm' : 'btn'} onClick={() => void go()} disabled={busy} data-testid="export-project-archive" title="Download the whole project as one file (.jsspub.zip): its files, house style, logos and review comments. Import brings it back as a new project.">{busy ? <Spinner /> : <Icon name="download" size={12} />}{label}</button>;
}

/** Converting the open document to another format: a new project is made, this one is not changed. */
export function ConvertButton({ id, from, name, dirty, saveFirst }: { id: string; from: Format; name: string; dirty: boolean; saveFirst: () => Promise<boolean> }) {
  const nav = useNavigate(); const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false); const [conv, setConv] = useState<Conversion[]>([]);
  const [to, setTo] = useState<Format | ''>(''); const [title, setTitle] = useState(''); const [busy, setBusy] = useState(false); const [done, setDone] = useState<ConvertResult | null>(null);
  useEffect(() => { if (open && !conv.length) void xengineApi.conversions().then(setConv).catch((e) => toast(errText(e), 'error')); }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const options = conv.filter((c) => c.from === from);
  const close = () => { setOpen(false); setDone(null); setTo(''); };
  const run = async () => {
    if (!to) return; setBusy(true);
    try { if (dirty && !(await saveFirst())) return; setDone(await xengineApi.convert(id, to, title.trim() || undefined)); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  return (
    <>
      <button className="btn sm" onClick={() => { setTitle(''); setOpen(true); }} data-testid="convert-open" title="Make a new project from this document in another format; this one is not changed"><Icon name="refresh" />Convert</button>
      {open ? (
        <Modal title={done ? 'Conversion finished' : `Convert “${name}”`} onClose={close} width={640} buttons={done
          ? <><button className="btn" onClick={close}>Stay here</button><button className="btn primary" onClick={() => nav(`/projects/${done.project.id}`)} data-testid="convert-go">Open “{done.project.name}”</button></>
          : <><button className="btn" onClick={close}>Cancel</button><button className="btn primary" disabled={!to || busy} onClick={() => void run()} data-testid="convert-run">{busy ? <Spinner /> : null}Convert</button></>}>
          {done ? (
            <>
              <p>A new {FORMAT_LABEL[done.to]} project, <strong>{done.project.name}</strong>, was made from this {FORMAT_LABEL[done.from]} project: {done.counts.sections} sections{done.counts.pictures ? `, ${done.counts.pictures} pictures` : ''}. This project was not changed.</p>
              <div data-testid="convert-findings"><FindingsList list={done.findings} /></div>
            </>
          ) : (
            <>
              <p className="v2-hint" style={{ marginTop: 0 }}>This {FORMAT_LABEL[from]} project is kept as it is; the conversion makes a new project. Whatever the other format cannot hold is listed afterwards.</p>
              <div role="radiogroup" aria-label="Convert to">
                {options.map((c) => (
                  <label key={c.to} className="v2-row" style={{ gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
                    <input type="radio" name="convert-to" checked={to === c.to} onChange={() => setTo(c.to)} data-testid={`convert-to-${c.to}`} />
                    <span><strong>{FORMAT_LABEL[c.to]}</strong><br /><span className="v2-hint">{c.how}</span></span>
                  </label>
                ))}
                {conv.length && !options.length ? <Callout tone="warning">No conversion is available from this format.</Callout> : null}
              </div>
              <label className="v2-field"><span>Name of the new project (optional)</span><input className="input" value={title} maxLength={80} placeholder={to ? `${name} (${FORMAT_LABEL[to]})` : ''} onChange={(e) => setTitle(e.target.value)} /></label>
            </>
          )}
        </Modal>
      ) : null}
    </>
  );
}
