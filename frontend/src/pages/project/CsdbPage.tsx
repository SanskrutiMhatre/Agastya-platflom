// Project → CSDB: objects (DML / DDN / Comment / Update / IMF), module lifecycle, packages, HTML publication, extension profiles,
// linked Common Information Repository copies, and the findings list. Every action here is an API the server enforces.

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { csdbApi, type CsdbObject, type ImportReport, type Suggestion } from '../../api/csdb';
import { contentApi } from '../../api';
import { Icon } from '../../components/Icon';
import { PageHeader } from '../../components/PageHeader';
import { PublishRefusal } from '../../components/PublishRefusal';
import { onlyRuleBreaks } from '../../lib/ruleBreaks';
import { refusalOf, type Refusal } from '../../lib/waivers';
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, Modal, errText, fmtSize, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { useUi } from '../../store/ui';

type Tab = 'objects' | 'modules' | 'packages' | 'html' | 'extensions' | 'cir' | 'findings';
const TABS: Array<[Tab, string]> = [['objects', 'Objects'], ['modules', 'Revisions'], ['packages', 'Packages'], ['html', 'HTML'], ['extensions', 'Extensions'], ['cir', 'Shared copies'], ['findings', 'Findings']];

export function CsdbPage() {
  const { id, role } = useProject();
  const [tab, setTab] = useState<Tab>('objects');
  const can = role === 'owner' || role === 'manager' || role === 'editor';
  const manage = role === 'owner' || role === 'manager';
  return (
    <div className="v2-page" data-testid="csdb-page">
      <PageHeader icon="layers" title="Files and revisions (CSDB)" sub="Every S1000D file of this project: its revisions, comments, update files and packages. The CSDB is the store; the publication decides what is printed, and new data modules join the publication when you create them." />
      <div className="v2-tabs" role="tablist" aria-label="CSDB sections">
        {TABS.map(([k, label]) => <button key={k} role="tab" aria-selected={tab === k} className={`v2-tab ${tab === k ? 'active' : ''}`} onClick={() => setTab(k)}>{label}</button>)}
      </div>
      {tab === 'objects' ? <Objects id={id} can={can} /> : null}
      {tab === 'modules' ? <Revisions id={id} can={can} manage={manage} /> : null}
      {tab === 'packages' ? <Packages id={id} can={can} /> : null}
      {tab === 'html' ? <HtmlTab id={id} can={can} /> : null}
      {tab === 'extensions' ? <Extensions id={id} manage={manage} /> : null}
      {tab === 'cir' ? <Cir id={id} manage={manage} /> : null}
      {tab === 'findings' ? <Findings id={id} /> : null}
    </div>
  );
}

function Objects({ id, can }: { id: string; can: boolean }) {
  const toast = useUi((s) => s.toast);
  const nav = useNavigate();
  const list = useAsync(() => csdbApi.objects(id), [id]);
  const dms = useAsync(() => contentApi.dms(id), [id]);
  const [make, setMake] = useState<null | 'comment' | 'update' | 'imf'>(null);
  const [view, setView] = useState<string | null>(null);
  const [del, setDel] = useState<CsdbObject | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const set = (k: string) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const run = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); list.reload(); setMake(null); } catch (e) { toast(errText(e), 'error'); } };
  return (
    <div className="v2-stack">
      {can ? (
        <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap' }}>
          <button className="v2-btn" onClick={() => run(() => csdbApi.generateDml(id, { type: 'p' }), 'Data management list generated')}><Icon name="plus" size={14} /> Generate DML</button>
          <button className="v2-btn" onClick={() => { setForm({}); setMake('comment'); }}>New comment</button>
          <button className="v2-btn" onClick={() => { setForm({}); setMake('update'); }}>New update file</button>
          <button className="v2-btn" onClick={() => { setForm({}); setMake('imf'); }}>New ICN metadata</button>
        </div>
      ) : null}
      {list.loading && !list.data ? <Loading /> : !list.data?.objects.length ? <Empty title="No CSDB objects yet">Generate a data management list, or create a comment, update file or ICN metadata file.</Empty> : (
        <table className="v2-table" data-testid="objects-table"><thead><tr><th>File</th><th>Type</th><th>Issue</th><th>Schema</th><th>Size</th><th /></tr></thead><tbody>
          {list.data.objects.map((o) => (
            <tr key={o.file}><td className="v2-mono">{o.file}</td><td>{o.prefix}</td><td>{o.issueNumber ? `${o.issueNumber}-${o.inWork}` : '—'}</td><td>{o.schema} {o.issue ? <Badge>{o.issue}</Badge> : null}</td><td>{fmtSize(o.size)}</td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="v2-btn v2-btn-sm" onClick={() => setView(o.file)}>View</button>{can && ['comment', 'update', 'imf', 'scorm'].includes(o.kind) ? <button className="v2-btn v2-btn-sm" data-testid="object-edit" onClick={() => nav(`/projects/${id}/editor?object=${encodeURIComponent(o.file)}`)}>Edit</button> : null}{can ? <button className="v2-btn v2-btn-sm v2-btn-danger" onClick={() => setDel(o)}>Delete</button> : null}</td></tr>
          ))}</tbody></table>
      )}
      {view ? <Modal title={view} onClose={() => setView(null)} width={900}><iframe title={view} src={csdbApi.objectHtmlUrl(id, view)} sandbox="" style={{ width: '100%', height: '60vh', border: '1px solid var(--line)' }} /></Modal> : null}
      {del ? <ConfirmModal title="Delete this file?" body={<>This deletes <b>{del.file}</b> from the project.</>} confirmLabel="Delete" danger onConfirm={async () => { await csdbApi.deleteObject(id, del.file); setDel(null); list.reload(); }} onClose={() => setDel(null)} /> : null}
      {make ? (
        <Modal title={{ comment: 'New comment', update: 'New data update file', imf: 'New ICN metadata file' }[make]} onClose={() => setMake(null)}
          buttons={<button className="v2-btn v2-btn-primary" onClick={() => run(() => csdbApi.newObject(id, make, make === 'imf' ? { icn: form.icn, icnTitle: form.title } : make === 'comment' ? { refDm: form.refDm, title: form.title, text: form.text } : { refDm: form.refDm, partNumber: form.partNumber }), 'Created')}>Create</button>}>
          <div className="v2-stack">
            {make !== 'imf' ? <Field label="Data module it is about"><select value={form.refDm ?? ''} onChange={set('refDm')}><option value="">Choose…</option>{(dms.data ?? []).map((d) => <option key={d.file} value={d.file}>{d.file}</option>)}</select></Field> : <Field label="ICN" hint="ICN-…-001-01"><input value={form.icn ?? ''} onChange={set('icn')} /></Field>}
            {make === 'comment' ? <><Field label="Title"><input value={form.title ?? ''} onChange={set('title')} /></Field><Field label="Comment"><textarea rows={4} value={form.text ?? ''} onChange={set('text')} /></Field></> : null}
            {make === 'update' ? <Field label="Part number to delete (template)"><input value={form.partNumber ?? ''} onChange={set('partNumber')} /></Field> : null}
            {make === 'imf' ? <Field label="Illustration title"><input value={form.title ?? ''} onChange={set('title')} /></Field> : null}
            <p className="v2-hint">The file is built from the bundled schema for this project's S1000D issue and validated before it is saved. Issue 7.0 has no Comment or Update schema.</p>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Revisions({ id, can, manage }: { id: string; can: boolean; manage: boolean }) {
  const toast = useUi((s) => s.toast);
  const dms = useAsync(() => contentApi.dms(id), [id]);
  const [open, setOpen] = useState<string | null>(null);
  const hist = useAsync(() => (open ? csdbApi.lifecycle(id, open) : Promise.resolve(null)), [id, open]);
  const [sugg, setSugg] = useState<{ file: string; list: Suggestion[]; against: string | null } | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState<{ kind: 'obsolete' | 'supersede' | 'issue' | 'reinstate'; file: string } | null>(null);
  const [rkind, setRkind] = useState<'status' | 'changed' | 'revised'>('status');
  const [text, setText] = useState(''); const [by, setBy] = useState('');
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, 'success'); dms.reload(); hist.reload(); setReason(null); setText(''); setBy(''); } catch (e) { toast(errText(e), 'error'); } };
  // every dialog starts empty: a reason or a target typed for one module must never carry over to the next
  const openReason = (kind: 'obsolete' | 'supersede' | 'issue' | 'reinstate', file: string) => { setText(''); setBy(''); setReason({ kind, file }); };
  return (
    <div className="v2-stack">
      <Alert tone="warn">Every issue and in-work revision is its own file. Unpinned publication references follow the highest revision. Issuing, superseding and obsoleting are Project Manager actions and are recorded with a reason.</Alert>
      {dms.loading && !dms.data ? <Loading /> : (
        <table className="v2-table"><thead><tr><th>Data module</th><th>Issue</th><th /></tr></thead><tbody>
          {(dms.data ?? []).map((d) => (
            <tr key={d.file}><td className="v2-mono">{d.file}</td><td>{d.issueNumber}-{d.inWork}</td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button className="v2-btn v2-btn-sm" onClick={() => setOpen(open === d.file ? null : d.file)}>History</button>
                {can ? <button className="v2-btn v2-btn-sm" onClick={() => act(() => csdbApi.workingRevision(id, d.file), 'Working revision created')}>New revision</button> : null}
                {can ? <button className="v2-btn v2-btn-sm" onClick={async () => { try { const r = await csdbApi.suggestions(id, d.file); setPicked(new Set()); setSugg({ file: d.file, list: r.suggestions, against: r.against }); } catch (e) { toast(errText(e), 'error'); } }}>Change marks</button> : null}
                {manage ? <button className="v2-btn v2-btn-sm" onClick={() => openReason('issue', d.file)}>Issue</button> : null}
                {manage ? <button className="v2-btn v2-btn-sm" onClick={() => openReason('supersede', d.file)}>Supersede</button> : null}
                {manage ? <button className="v2-btn v2-btn-sm v2-btn-danger" onClick={() => openReason('obsolete', d.file)}>Obsolete</button> : null}
              </td></tr>
          ))}</tbody></table>
      )}
      {open && hist.data ? (
        <div className="v2-card" data-testid="revision-history"><h3 style={{ marginTop: 0 }}>History of {open}</h3>
          {manage && hist.data.revisions.some((r) => r.current && r.issueType === 'deleted') ? <button className="v2-btn v2-btn-sm" data-testid="reinstate" onClick={() => openReason('reinstate', open)}>Reinstate…</button> : null}
          <ul>{hist.data.revisions.map((r) => <li key={r.file}><span className="v2-mono">{r.file}</span> — issue {r.issueNumber}-{r.inWork}, {r.issueType}{r.current ? <> <Badge tone="ok">current</Badge></> : null}{r.events.map((e, i) => <div key={i} className="v2-hint">{e.action}{e.reason ? ` — ${e.reason}` : ''} · {e.by}</div>)}</li>)}</ul></div>
      ) : null}
      {sugg ? (
        <Modal title={`Suggested change marks — ${sugg.file}`} onClose={() => setSugg(null)} width={760}
          buttons={<button className="v2-btn v2-btn-primary" disabled={!picked.size} onClick={() => act(async () => { await csdbApi.applyMarks(id, sugg.file, sugg.list.filter((s) => picked.has(s.path) && s.type !== 'delete').map((s) => ({ path: s.path, type: s.type as 'add' | 'modify' }))); setSugg(null); }, 'Change marks written')}>Apply selected</button>}>
          {!sugg.against ? <Empty title="Nothing to compare">This is the first revision of the module.</Empty> : !sugg.list.length ? <Empty title="No differences">Identical to {sugg.against}.</Empty> : (
            <><p className="v2-hint">Compared with {sugg.against}. Nothing is written until you choose and apply.</p>
              <table className="v2-table"><tbody>{sugg.list.map((s) => <tr key={s.path}><td>{s.type !== 'delete' ? <input type="checkbox" checked={picked.has(s.path)} onChange={(e) => setPicked((p) => { const n = new Set(p); if (e.target.checked) n.add(s.path); else n.delete(s.path); return n; })} /> : null}</td><td><Badge tone={s.type === 'add' ? 'ok' : s.type === 'delete' ? 'bad' : 'warn'}>{s.type}</Badge></td><td className="v2-mono">{s.element}</td><td>line {s.line}</td><td>{s.excerpt}</td></tr>)}</tbody></table></>
          )}
        </Modal>
      ) : null}
      {reason ? (
        <Modal title={{ issue: 'Issue this revision', obsolete: 'Make obsolete', supersede: 'Supersede', reinstate: 'Reinstate' }[reason.kind]} onClose={() => setReason(null)}
          buttons={<button className="v2-btn v2-btn-primary" disabled={(reason.kind !== 'issue' && !text.trim()) || (reason.kind === 'supersede' && !by)} onClick={() => act(() => reason.kind === 'reinstate' ? csdbApi.reinstate(id, reason.file, text, rkind) : reason.kind === 'issue' ? csdbApi.issue(id, reason.file, text) : reason.kind === 'obsolete' ? csdbApi.obsolete(id, reason.file, text) : csdbApi.supersede(id, reason.file, text, by), 'Done')}>Confirm</button>}>
          <div className="v2-stack"><p><b className="v2-mono">{reason.file}</b></p>
            {reason.kind === 'reinstate' ? <Field label="Kind of reinstatement"><select value={rkind} onChange={(e) => setRkind(e.target.value as 'status' | 'changed' | 'revised')} data-testid="reinstate-kind"><option value="status">status - only the status information changed</option><option value="changed">changed - changes are marked</option><option value="revised">revised - changes are not marked</option></select></Field> : null}
            <Field label={reason.kind === 'issue' ? 'Note (optional)' : 'Reason (required)'}><textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} /></Field>
            {reason.kind === 'supersede' ? <Field label="Superseded by"><select value={by} onChange={(e) => setBy(e.target.value)}><option value="">Choose…</option>{(dms.data ?? []).filter((d) => d.file !== reason.file).map((d) => <option key={d.file} value={d.file}>{d.file}</option>)}</select></Field> : null}
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function Packages({ id, can }: { id: string; can: boolean }) {
  const toast = useUi((s) => s.toast);
  const file = useRef<HTMLInputElement>(null);
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [opt, setOpt] = useState({ overwrite: false, partial: false, skipChecks: false, replacePm: false });
  const [dd, setDd] = useState({ sender: '', receiver: '', name: '', includeDml: true });
  const save = async (r: Response, name: string) => { const b = await r.blob(); const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); };
  const doImport = async () => { const f = file.current?.files?.[0]; if (!f) return toast('Choose a ZIP package first.', 'info'); setBusy(true); try { setReport(await csdbApi.importPackage(id, f, opt)); } catch (e) { const b = (e as { body?: ImportReport }).body; if (b && b.items) setReport(b); else toast(errText(e), 'error'); } finally { setBusy(false); } };
  return (
    <div className="v2-stack">
      <div className="v2-card"><h3 style={{ marginTop: 0 }}>Export</h3>
        <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <a className="v2-btn" href={csdbApi.exportProjectUrl(id)} data-testid="export-project"><Icon name="download" size={14} /> Project package (ZIP)</a>
        </div>
        <h4>Delivery package (S1000D transfer: one DDN + flat data files)</h4>
        <div className="v2-row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'end' }}>
          <Field label="Sender code"><input value={dd.sender} onChange={(e) => setDd({ ...dd, sender: e.target.value.toUpperCase() })} maxLength={5} /></Field>
          <Field label="Receiver code"><input value={dd.receiver} onChange={(e) => setDd({ ...dd, receiver: e.target.value.toUpperCase() })} maxLength={5} /></Field>
          <Field label="Receiver name (free entry, if not registered)"><input value={dd.name} onChange={(e) => setDd({ ...dd, name: e.target.value })} /></Field>
          <label><input type="checkbox" checked={dd.includeDml} onChange={(e) => setDd({ ...dd, includeDml: e.target.checked })} /> include a DML</label>
          <button className="v2-btn" onClick={async () => { try { await save(await csdbApi.delivery(id, { sender: { code: dd.sender }, receiver: { code: dd.receiver, name: dd.name || undefined, city: '-', country: '-' }, includeDml: dd.includeDml }), 'delivery.zip'); } catch (e) { toast(errText(e), 'error'); } }}>Build delivery package</button>
        </div></div>
      {can ? (
        <div className="v2-card"><h3 style={{ marginTop: 0 }}>Import</h3>
          <input ref={file} type="file" accept=".zip" data-testid="import-file" />
          <div className="v2-row" style={{ gap: 12, flexWrap: 'wrap', margin: '8px 0' }}>
            {(['overwrite', 'partial', 'skipChecks', 'replacePm'] as const).map((k) => <label key={k}><input type="checkbox" checked={opt[k]} onChange={(e) => setOpt({ ...opt, [k]: e.target.checked })} /> {{ overwrite: 'replace existing files', partial: 'import what is acceptable', skipChecks: 'import without validation', replacePm: 'replace the publication module' }[k]}</label>)}
          </div>
          <button className="v2-btn v2-btn-primary" disabled={busy} onClick={doImport}>{busy ? 'Importing…' : 'Import package'}</button>
          <p className="v2-hint">Each file is checked on its own against its own schema (never against the other modules). Nothing is written if a file is rejected, unless you choose to import what is acceptable.</p>
        </div>
      ) : null}
      {report ? <ReportView r={report} /> : null}
    </div>
  );
}

function ReportView({ r }: { r: ImportReport }) {
  return (
    <div className="v2-card" data-testid="import-report"><h3 style={{ marginTop: 0 }}>Import report — {r.source} {r.applied ? <Badge tone="ok">applied</Badge> : <Badge tone="bad">not applied</Badge>}</h3>
      <p>{r.counts.accepted} accepted · {r.counts.unchanged} unchanged · {r.counts.skipped} skipped · {r.counts.rejected} rejected{r.manifest.present ? ` · manifest: ${r.manifest.checked} checked, ${r.manifest.mismatches.length} differ` : ''}</p>
      {r.manifest.mismatches.map((m) => <Alert key={m} tone="bad">{m}</Alert>)}
      <table className="v2-table"><thead><tr><th>File</th><th>Status</th><th>Message</th></tr></thead><tbody>
        {r.items.map((i) => <tr key={i.path}><td className="v2-mono">{i.path}</td><td><Badge tone={i.status === 'rejected' ? 'bad' : i.status === 'accepted' ? 'ok' : undefined}>{i.status}</Badge></td><td>{i.message}{i.xsdErrors ? <div className="v2-hint">{i.xsdErrors} schema finding(s): {(i.xsdFirst ?? []).join(' | ')}</div> : null}</td></tr>)}</tbody></table>
    </div>
  );
}

function HtmlTab({ id, can }: { id: string; can: boolean }) {
  const toast = useUi((s) => s.toast);
  const builds = useAsync(() => csdbApi.html(id), [id]);
  const { role } = useProject();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [rulesOnly, setRulesOnly] = useState(false);
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  // The same gate as the PDF build, with the same two ways past it: build anyway when ONLY business rules are broken, or a recorded BREX waiver (draft only).
  const build = async (allowRuleBreaks = false) => {
    setBusy(true); setError(''); setRulesOnly(false); setRefusal(null);
    try {
      const b = await csdbApi.buildHtml(id, allowRuleBreaks);
      toast(`HTML built: ${b.pages} pages${b.ruleBreaks?.length ? ` · ${b.ruleBreaks.length} business rule break${b.ruleBreaks.length === 1 ? '' : 's'} not fixed` : ''}`, 'success');
      builds.reload();
    } catch (e) {
      const only = onlyRuleBreaks(e); const r = only ? null : refusalOf(e);
      if (r) setRefusal(r); else { setError(errText(e)); setRulesOnly(only); }
    } finally { setBusy(false); }
  };
  return (
    <div className="v2-stack">
      <p className="v2-hint">A static HTML publication (AGASTYA's own format): contents, one page per data module, graphics, list of illustrations and abbreviations. It opens from a folder or any web server, with no script. Built only from modules that pass validation.</p>
      {can ? <div><button className="v2-btn v2-btn-primary" disabled={busy} onClick={() => void build(false)}>{busy ? 'Building…' : 'Build HTML publication'}</button></div> : null}
      {error ? <div><Alert tone="bad">{error}</Alert>{rulesOnly ? <p className="v2-hint" style={{ margin: '6px 0 0' }}>Only business rules (BREX) are broken. You can still build the HTML to look at it; its front page lists the breaks and it stays NOT RELEASED. <button className="btn btn-sm" disabled={busy} onClick={() => void build(true)}>Build anyway</button></p> : null}</div> : null}
      {refusal ? <PublishRefusal refusal={refusal} projectId={id} role={role} mode="draft" onDismiss={() => setRefusal(null)} onRecorded={() => void build(false)} /> : null}
      {(builds.data?.builds ?? []).map((b) => <div key={b.name} className="v2-row" style={{ gap: 12 }}><span className="v2-mono">{b.name}</span><span>{fmtSize(b.size)}</span><a href={`/api/projects/${id}/publish/html/${b.name}/index.html`} target="_blank" rel="noreferrer">Open</a><a href={`/api/projects/${id}/publish/html/${b.name}.zip`}>Download ZIP</a></div>)}
    </div>
  );
}

function Extensions({ id, manage }: { id: string; manage: boolean }) {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => csdbApi.extensions(id), [id]);
  if (list.loading && !list.data) return <Loading />;
  return (
    <div className="v2-stack">
      <p className="v2-hint">Content in another XML namespace is kept exactly as written. It is an error unless an administrator registered an extension profile for the namespace and this project enabled it; enabled content is validated against the profile's own schema.</p>
      {!list.data?.profiles.length ? <Empty title="No extension profiles registered">An administrator registers them under Administrator → Extension profiles.</Empty> : (
        <table className="v2-table"><thead><tr><th>Profile</th><th>Namespace</th><th>Enabled</th></tr></thead><tbody>
          {list.data.profiles.map((p) => <tr key={p.id}><td>{p.name}</td><td className="v2-mono">{p.namespace}</td><td><input type="checkbox" disabled={!manage} checked={!!p.enabled} onChange={async (e) => { try { await csdbApi.setExtension(id, p.id, e.target.checked); list.reload(); } catch (x) { toast(errText(x), 'error'); } }} /></td></tr>)}</tbody></table>
      )}
    </div>
  );
}

function Cir({ id, manage }: { id: string; manage: boolean }) {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => csdbApi.cirLinks(id), [id]);
  const [force, setForce] = useState<string | null>(null);
  const [detach, setDetach] = useState<string | null>(null);
  const approve = async (file: string, f = false) => { try { await csdbApi.approveCir(id, file, f); toast('Update taken over', 'success'); list.reload(); setForce(null); } catch (e) { if ((e as { code?: string }).code === 'LOCALLY_MODIFIED') setForce(file); else toast(errText(e), 'error'); } };
  if (list.loading && !list.data) return <Loading />;
  return (
    <div className="v2-stack">
      <p className="v2-hint">Modules copied from the Common Information Repository stay linked. They are changed in the repository; a Project Manager approves taking an update into the project.</p>
      {!list.data?.links.length ? <Empty title="No linked copies">Copy a module from the Common Information Repository to link it.</Empty> : (
        <table className="v2-table"><thead><tr><th>Module</th><th>Linked issue</th><th>Repository issue</th><th>State</th><th /></tr></thead><tbody>
          {list.data.links.map((l) => <tr key={l.file}><td className="v2-mono">{l.file}</td><td>{l.linkedIssue}</td><td>{l.cirIssue ?? '—'}</td><td><Badge tone={l.state === 'up-to-date' ? 'ok' : 'warn'}>{l.state}</Badge></td>
            <td>{manage ? <><button className="v2-btn v2-btn-sm" disabled={!l.state.startsWith('update-available')} onClick={() => approve(l.file)}>Approve update</button><button className="v2-btn v2-btn-sm" onClick={() => setDetach(l.file)}>Detach</button></> : null}</td></tr>)}</tbody></table>
      )}
      {detach ? <ConfirmModal title="Detach this copy?" body={<><b>{detach}</b> stops following the Common Information Repository: later repository updates will no longer be offered for it.</>} confirmLabel="Detach" danger onConfirm={async () => { try { await csdbApi.detachCir(id, detach); toast('Detached', 'success'); list.reload(); } catch (e) { toast(errText(e), 'error'); } setDetach(null); }} onClose={() => setDetach(null)} /> : null}
      {force ? <ConfirmModal title="Overwrite local changes?" body="This copy was changed after it was linked. Taking the update replaces those changes (they stay in the module's history)." confirmLabel="Overwrite" danger onConfirm={() => approve(force, true)} onClose={() => setForce(null)} /> : null}
    </div>
  );
}

function Findings({ id }: { id: string }) {
  const [rerun, setRerun] = useState(0);
  const f = useAsync(() => csdbApi.findings(id, rerun > 0), [id, rerun]);
  const [sev, setSev] = useState<'all' | 'error' | 'warn' | 'info'>('all');
  if (f.loading && !f.data) return <Loading />;
  const rows = (f.data?.findings ?? []).filter((x) => sev === 'all' || x.severity === sev);
  return (
    <div className="v2-stack">
      <div className="v2-row" style={{ gap: 8 }}>
        {(['all', 'error', 'warn', 'info'] as const).map((s) => <button key={s} className={`v2-btn v2-btn-sm ${sev === s ? 'v2-btn-primary' : ''}`} onClick={() => setSev(s)}>{s}{s !== 'all' ? ` (${f.data?.counts[s] ?? 0})` : ''}</button>)}
        <button className="v2-btn v2-btn-sm" onClick={() => setRerun((n) => n + 1)}><Icon name="refresh" size={14} /> Run validation again</button>
      </div>
      {!rows.length ? <Empty title="No findings">Nothing in this category.</Empty> : (
        <table className="v2-table" data-testid="findings-table"><thead><tr><th>Module</th><th>Rule</th><th>Where</th><th>Problem</th><th>Suggested fix</th></tr></thead><tbody>
          {rows.slice(0, 500).map((x, i) => <tr key={i}><td className="v2-mono">{x.module}</td><td><Badge tone={x.severity === 'error' ? 'bad' : x.severity === 'warn' ? 'warn' : undefined}>{x.rule}</Badge></td><td className="v2-mono">{x.location}</td><td>{x.message}</td><td>{x.fix}</td></tr>)}</tbody></table>
      )}
    </div>
  );
}
