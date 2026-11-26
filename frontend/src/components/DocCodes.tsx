// The S1000D metadata of a JSS / JSG project - document codes (DMC), publication code (PMC), picture names (ICN) and contents list - and the conversion to another format.
//
// The server makes and keeps them (backend/src/services/xengine); the editor does not show them unless asked. Three parts, used by both editors:
//   <DocCodesButton>   the toolbar button: opens the codes, the four switches (all off at first) and the publication identity
//   <DocCodesStrip>    the strip under the toolbar: only what is switched on, nothing at all while everything is off
//   <ConvertButton>    "Convert to ..." as a new project, with what could not be carried over
//   <ExportProjectButton>  "Export": the whole project as one archive (.jsspub.zip), for every format; a project made here or imported and edited

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { create } from 'zustand';
import { xengineApi, FORMAT_LABEL, type Conversion, type ConvertResult, type DocCodes, type DocCodesPatch, type DocCodesShow, type Format, type XFinding } from '../api/xengine';
import { useUi } from '../store/ui';
import { Icon } from './Icon';
import { Alert, Modal, Spinner, errText } from './ui';

// One copy of a project's codes for the button and the strip (they sit in different places of the page).
interface CodesStore { byProject: Record<string, DocCodes | null>; put: (id: string, c: DocCodes | null) => void }
const useCodes = create<CodesStore>((set) => ({ byProject: {}, put: (id, c) => set((s) => ({ byProject: { ...s.byProject, [id]: c } })) }));

/** Load a project's codes; `refresh` loads them again (after a save). A project that cannot have them (an S1000D project) gives null. */
function useDocCodes(id: string, refreshKey: unknown): { codes: DocCodes | null; reload: () => Promise<void> } {
  const codes = useCodes((s) => s.byProject[id] ?? null); const put = useCodes((s) => s.put);
  const reload = useCallback(async () => { try { put(id, await xengineApi.codes(id)); } catch { put(id, null); } }, [id, put]);
  useEffect(() => { void reload(); }, [reload, refreshKey]);
  return { codes, reload };
}

const SWITCHES: Array<[keyof DocCodesShow, string, string]> = [
  ['dmc', 'Document codes (DMC)', 'The code of each section, as it is written in an S1000D package: shown beside each section heading in the editor and listed under the toolbar.'],
  ['pmc', 'Publication code (PMC)', 'The code of the whole publication.'],
  ['icn', 'Picture names (ICN)', 'The standard name each picture has in an S1000D package.'],
  ['toc', 'Contents list', 'The publication\'s contents list with the code of each line.'],
];

const origin = (o: string): string => (o === 'imported' ? 'kept from the imported package' : 'made by the platform');

export function DocCodesButton({ id, writable, refreshKey }: { id: string; writable: boolean; refreshKey?: unknown }) {
  const toast = useUi((s) => s.toast);
  const { codes, reload } = useDocCodes(id, refreshKey); const put = useCodes((s) => s.put);
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<DocCodesPatch>({});
  useEffect(() => { if (open && codes) setForm({ modelIdentCode: codes.modelIdentCode, pmIssuer: codes.pmc.pmIssuer, pmNumber: codes.pmc.pmNumber, pmVolume: codes.pmc.pmVolume }); }, [open, codes?.modelIdentCode, codes?.pmc.pmIssuer, codes?.pmc.pmNumber, codes?.pmc.pmVolume]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!codes) return null;

  const toggle = async (k: keyof DocCodesShow, on: boolean) => {
    put(id, { ...codes, show: { ...codes.show, [k]: on } });                       // at once; the server's answer replaces it
    try { put(id, await xengineApi.setShow(id, { [k]: on })); } catch (e) { toast(errText(e), 'error'); void reload(); }
  };
  const save = async () => {
    setBusy(true);
    try { const patch: DocCodesPatch = {}; for (const k of ['modelIdentCode', 'pmIssuer', 'pmNumber', 'pmVolume'] as const) if (form[k] !== undefined && form[k] !== (k === 'modelIdentCode' ? codes.modelIdentCode : codes.pmc[k])) patch[k] = form[k]; put(id, await xengineApi.setCodes(id, patch)); toast('Codes saved.', 'success'); }
    catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  const inp = (k: 'modelIdentCode' | 'pmIssuer' | 'pmNumber' | 'pmVolume', label: string, w: number) => (
    <label className="v2-field" style={{ width: w }}><span>{label}</span><input className="v2-input" value={form[k] ?? ''} disabled={!writable} onChange={(e) => setForm({ ...form, [k]: e.target.value.toUpperCase() })} /></label>
  );

  return (
    <>
      <button className="btn btn-sm" onClick={() => setOpen(true)} data-testid="doc-codes" title="The document codes kept for this document (for S1000D export and conversion). Hidden in the editor unless you switch them on."><Icon name="key" />Codes</button>
      {open ? (
        <Modal title="Document codes" onClose={() => setOpen(false)} width={760} buttons={<><button className="btn" onClick={() => setOpen(false)}>Close</button>{writable ? <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? <Spinner /> : null}Save identity</button> : null}</>}>
          <p className="v2-hint" style={{ marginTop: 0 }}>The platform makes and keeps a code for every section, a code for the publication and a name for every picture, from the structure of this document. They are used when the document is exported as S1000D or converted. They stay in the background unless you switch them on here.</p>
          <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }} data-testid="doc-codes-switches">
            <legend style={{ fontWeight: 600, fontSize: 13, marginBottom: 4 }}>Show in the editor</legend>
            {SWITCHES.map(([k, label, hint]) => (
              <label key={k} className="v2-row" style={{ gap: 8, alignItems: 'flex-start', marginBottom: 4 }}>
                <input type="checkbox" checked={codes.show[k]} onChange={(e) => void toggle(k, e.target.checked)} data-testid={`doc-codes-show-${k}`} />
                <span><strong>{label}</strong><br /><span className="v2-hint">{hint}</span></span>
              </label>
            ))}
          </fieldset>
          <div className="v2-row wrap" style={{ gap: 12, marginBottom: 8 }}>{inp('modelIdentCode', 'Model code', 140)}{inp('pmIssuer', 'Publication issuer', 140)}{inp('pmNumber', 'Publication number', 140)}{inp('pmVolume', 'Volume', 80)}</div>
          <p className="v2-hint">Publication code: <strong data-testid="doc-codes-pmc">{codes.pmc.code}</strong> ({origin(codes.pmc.origin)}). {codes.counts.modules} sections, {codes.counts.pictures} pictures{codes.counts.imported ? `, ${codes.counts.imported} sections with codes kept from an imported package` : ''}.</p>
          <div style={{ maxHeight: 280, overflow: 'auto' }}>
            <table className="v2-table" data-testid="doc-codes-table">
              <thead><tr><th>Section</th><th>Document code</th><th>Origin</th></tr></thead>
              <tbody>{codes.modules.map((m) => <tr key={m.key}><td>{m.chapter}. {m.title}</td><td><code>{m.dmc}</code></td><td className="v2-hint">{origin(m.origin)}</td></tr>)}</tbody>
            </table>
            {codes.pictures.length ? (
              <table className="v2-table" style={{ marginTop: 8 }}>
                <thead><tr><th>Picture</th><th>Picture name (ICN)</th><th>Origin</th></tr></thead>
                <tbody>{codes.pictures.map((p) => <tr key={p.file}><td>{p.file}</td><td><code>{p.icn}</code></td><td className="v2-hint">{origin(p.origin)}</td></tr>)}</tbody>
              </table>
            ) : null}
          </div>
        </Modal>
      ) : null}
    </>
  );
}

/** What is switched on, under the toolbar. Renders nothing while everything is off (the default). */
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

export function DocCodesStrip({ id, refreshKey }: { id: string; refreshKey?: unknown }) {
  const { codes } = useDocCodes(id, refreshKey);
  if (!codes || !(codes.show.dmc || codes.show.pmc || codes.show.icn || codes.show.toc)) return null;
  const s = codes.show;
  return (
    <div className="v2-hint" data-testid="doc-codes-strip" style={{ padding: '4px 12px', borderBottom: '1px solid var(--line, #ddd)', maxHeight: 150, overflow: 'auto', fontSize: 12 }}>
      {s.pmc ? <div><strong>Publication</strong> <code data-testid="doc-codes-strip-pmc">{codes.pmc.code}</code> — {codes.pmc.title} ({codes.pmc.issue}, {codes.pmc.language})</div> : null}
      {s.toc ? <div data-testid="doc-codes-strip-toc"><strong>Contents</strong>{codes.toc.map((t, i) => <div key={i} style={{ paddingLeft: (t.level - 1) * 14 }}>{t.number} {t.title}{s.dmc && t.dmc ? <> <code>{t.dmc}</code></> : null}</div>)}</div>
        : s.dmc ? <div data-testid="doc-codes-strip-dmc"><strong>Sections</strong>{codes.modules.map((m) => <div key={m.key}>{m.chapter}. {m.title} <code>{m.dmc}</code></div>)}</div> : null}
      {s.icn ? <div data-testid="doc-codes-strip-icn"><strong>Pictures</strong>{codes.pictures.length ? codes.pictures.map((p) => <div key={p.file}>{p.file} <code>{p.icn}</code></div>) : <div>No pictures in this document.</div>}</div> : null}
    </div>
  );
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
  return <button type="button" className={small ? 'btn btn-sm' : 'btn'} onClick={() => void go()} disabled={busy} data-testid="export-project-archive" title="Download the whole project as one file (.jsspub.zip): its files, house style, logos and review comments. Import brings it back as a new project.">{busy ? <Spinner /> : <Icon name="download" size={12} />}{label}</button>;
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
      <button className="btn btn-sm" onClick={() => { setTitle(''); setOpen(true); }} data-testid="convert-open" title="Make a new project from this document in another format; this one is not changed"><Icon name="refresh" />Convert</button>
      {open ? (
        <Modal title={done ? 'Conversion finished' : `Convert “${name}”`} onClose={close} width={640} buttons={done
          ? <><button className="btn" onClick={close}>Stay here</button><button className="btn btn-primary" onClick={() => nav(`/projects/${done.project.id}`)} data-testid="convert-go">Open “{done.project.name}”</button></>
          : <><button className="btn" onClick={close}>Cancel</button><button className="btn btn-primary" disabled={!to || busy} onClick={() => void run()} data-testid="convert-run">{busy ? <Spinner /> : null}Convert</button></>}>
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
                {conv.length && !options.length ? <Alert tone="warn">No conversion is available from this format.</Alert> : null}
              </div>
              <label className="v2-field"><span>Name of the new project (optional)</span><input className="v2-input" value={title} maxLength={80} placeholder={to ? `${name} (${FORMAT_LABEL[to]})` : ''} onChange={(e) => setTitle(e.target.value)} /></label>
            </>
          )}
        </Modal>
      ) : null}
    </>
  );
}
