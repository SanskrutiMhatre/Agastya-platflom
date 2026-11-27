// Administrator → S1000D catalogue and SNS presets.
//   Catalogue   information / learn / learn-event / item-location codes per S1000D issue, read from the issue's default BREX
//               (file, SHA-256 and rule shown), plus the administrator's own custom codes. Changing a custom code that projects use shows
//               exactly which projects and data modules it touches, and asks for confirmation.
//   SNS presets reusable starting points (the S1000D 4.2 maintained SNS tables are read-only; custom ones are editable).

import { useEffect, useMemo, useState } from 'react';
import { s1000dApi, issueLabel, KIND_LABEL, type CodeKind, type CodeRow, type Impact, type IssueKey, type PresetNode } from '../api';
import { Icon } from '../components/Icon';
import { RowButton, tablistKeys } from '../components/a11y';
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, Modal, PromptModal, errText, useAsync } from '../components/ui';
import { useUi } from '../store/ui';
import { csdbApi } from '../api/csdb';

const KINDS: CodeKind[] = ['infoCode', 'learnCode', 'learnEventCode', 'itemLocationCode'];

function ImpactBody({ impact, verb }: { impact: Impact; verb: string }) {
  return (
    <div className="v2-stack" style={{ gap: 6 }} data-testid="impact">
      <p style={{ margin: 0 }}>{verb} <b className="v2-mono">{impact.code}</b> affects <b>{impact.projects.length}</b> project{impact.projects.length === 1 ? '' : 's'} ({impact.dmsUsing} data module{impact.dmsUsing === 1 ? '' : 's'} use it):</p>
      <table className="v2-table"><thead><tr><th>Project</th><th>Selected in its configuration</th><th>Data modules using it</th></tr></thead><tbody>
        {impact.projects.map((p) => <tr key={p.id}><td>{p.name}</td><td>{p.selected ? 'yes' : 'no'}</td><td>{p.dmsUsing}</td></tr>)}</tbody></table>
      <p className="v2-hint" style={{ margin: 0 }}>No data module is changed. A deleted code simply stops being offered; the BREX check still judges existing modules.</p>
    </div>
  );
}

export function CatalogueSection() {
  const toast = useUi((s) => s.toast);
  const overview = useAsync(() => s1000dApi.overview(), []);
  const [issue, setIssue] = useState<IssueKey>('4-2');
  const [kind, setKind] = useState<CodeKind>('infoCode');
  const cat = useAsync(() => s1000dApi.catalogue(issue, kind), [issue, kind]);
  const [q, setQ] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<CodeRow | null>(null);
  const [deleting, setDeleting] = useState<{ row: CodeRow; impact: Impact } | null>(null);
  const rows = useMemo(() => (cat.data?.codes ?? []).filter((c) => !q || `${c.code} ${c.title}`.toLowerCase().includes(q.toLowerCase())), [cat.data, q]);
  const reload = () => { cat.reload(); overview.reload(); };
  if (overview.loading && !overview.data) return <Loading />;
  if (!overview.data) return <Alert tone="bad">{overview.error}</Alert>;
  const ov = overview.data;
  const src = cat.data?.sources.find((s) => s.id === `brex:${issue}`);
  const askDelete = async (row: CodeRow) => {
    try { const impact = await s1000dApi.impact(row.kind, row.issue, row.code); if (impact.projects.length) setDeleting({ row, impact }); else { await s1000dApi.deleteCode(row.kind, row.issue, row.code); toast('Deleted', 'success'); reload(); } }
    catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <div className="v2-stack" data-testid="s1000d-catalogue">
      <div><h3 style={{ margin: 0 }}>Information codes</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>The codes projects choose from when they create a data module, for each S1000D issue. Pick the issue, search the list, and add your own code if a project needs one. Where the codes come from is under <b>Technical details</b> at the bottom.</p></div>
      <div className="v2-row wrap">
        <select className="v2-select" style={{ width: 150 }} value={issue} onChange={(e) => setIssue(e.target.value as IssueKey)} aria-label="Issue" data-testid="cat-issue">{ov.issues.map((i) => <option key={i.key} value={i.key}>Issue {i.label}</option>)}</select>
        <div className="v2-tabs" role="tablist" aria-label="Code lists" onKeyDown={tablistKeys}>{KINDS.map((k) => <button key={k} role="tab" aria-selected={kind === k} className={`v2-tab ${kind === k ? 'active' : ''}`} onClick={() => setKind(k)}>{KIND_LABEL[k]}</button>)}</div>
        <input className="v2-input" style={{ width: 220 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter codes" />
        <button className="btn btn-primary" onClick={() => setAdding(true)} data-testid="cat-add"><Icon name="plus" />Add custom code</button>
      </div>
      <div className="v2-card">
        {cat.loading && !cat.data ? <Loading /> : rows.length === 0 ? <Empty title="Nothing matches" /> : (
          <div className="v2-scroll-x" style={{ maxHeight: 520, overflow: 'auto' }}><table className="v2-table"><thead><tr><th style={{ width: 90 }}>Code</th><th>Title</th><th style={{ width: 230 }}>Source</th><th /></tr></thead><tbody>
            {rows.map((c) => (
              <tr key={c.code} data-testid="cat-row">
                <td className="v2-mono">{c.code}</td><td>{c.title}</td>
                <td>{c.origin === 'brex' ? <Badge title={`${c.sourceLabel} · ${c.ruleId}`}>{c.ruleId}</Badge> : <Badge tone={c.brexAccepts ? 'ok' : 'warn'} title={c.brexAccepts ? 'Falls in a project-available range the BREX accepts' : 'Not in the default BREX: fails the BREX rule unless the project BREX allows it'}>{c.brexAccepts ? 'custom, in BREX range' : 'custom, outside BREX'}</Badge>}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{c.origin === 'custom' ? <>
                  <button className="icon-btn" aria-label={`Edit ${c.code}`} title={`Edit ${c.code}`} onClick={() => setEditing(c)}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" aria-label={`Delete ${c.code}`} title={`Delete ${c.code}`} onClick={() => void askDelete(c)}><Icon name="trash" size={14} /></button></> : null}</td>
              </tr>))}</tbody></table></div>
        )}
      </div>
      <details className="v2-card v2-card-pad" data-testid="cat-technical"><summary><b>Technical details</b> — where the codes come from</summary><div className="v2-stack" style={{ marginTop: 8 }}>
      <div className="v2-card"><table className="v2-table"><thead><tr><th>Issue</th>{KINDS.map((k) => <th key={k}>{KIND_LABEL[k]}</th>)}</tr></thead><tbody>
        {ov.summary.map((s) => <tr key={s.issue}><td><b>{s.label}</b></td>{KINDS.map((k) => <td key={k}>{s.kinds[k].count}{s.kinds[k].ranges ? ` + ${s.kinds[k].ranges} ranges` : ''}{s.kinds[k].custom ? <> <Badge tone="warn">{s.kinds[k].custom} custom</Badge></> : null}</td>)}</tr>)}</tbody></table></div>
      <details className="v2-card v2-card-pad" data-testid="default-evidence"><summary><b>Default information codes: what the specification says</b> ({Object.keys(ov.evidence.types).length} checked, {Object.keys(ov.unresolved).length} still open)</summary>
        <p className="v2-hint">The six defaults that were unconfirmed were read against the S1000D specification. {ov.evidence.limitation} <b>Still open</b> (flagged, author-editable, nothing invented): {Object.keys(ov.unresolved).join(', ')}.</p>
        <table className="v2-table"><thead><tr><th>Type</th><th>Default</th><th>Status</th><th>Evidence</th></tr></thead><tbody>{Object.entries(ov.evidence.types).map(([schema, e]) => (
          <tr key={schema}><td className="v2-mono">{schema}</td>
            <td className="v2-mono">{ov.advice['5-0'].find((a) => a.schema === schema)?.defaultCode}{e.previousDefault ? <span className="v2-hint"> (was {e.previousDefault})</span> : null}</td>
            <td><Badge tone={e.status === 'confirmed' || e.status === 'supported' || e.status === 'corrected' ? 'ok' : 'warn'} title={ov.evidence.statuses[e.status]}>{e.status}</Badge></td>
            <td>{e.note}<div className="v2-hint">{e.refs.join(' · ')}{e.codes.length ? ` — codes: ${e.codes.join(', ')}` : ''}</div></td></tr>))}</tbody></table></details>
      {src ? (
        <p className="v2-hint" style={{ margin: 0 }} data-testid="cat-source"><b>Source:</b> {src.label} — <span className="v2-mono">{src.file}</span>, SHA-256 <span className="v2-mono">{src.sha256?.slice(0, 16)}…</span>, rule <span className="v2-mono">{cat.data?.rule}</span>. {src.limitation}</p>
      ) : null}
      {cat.data?.ranges.length ? <p className="v2-hint" style={{ margin: 0 }}><b>Project-available ranges</b> (any code matching is accepted by the BREX; the project defines its meaning): <span className="v2-mono">{cat.data.ranges.map((r) => r.pattern).join('  ')}</span></p> : null}
      </div></details>
      {adding ? <AddCode kind={kind} issue={issue} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); reload(); }} /> : null}
      {editing ? <EditCode row={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); reload(); }} /> : null}
      {deleting ? (
        <ConfirmModal title="Delete this code?" danger confirmLabel="Delete anyway" onClose={() => setDeleting(null)} body={<ImpactBody impact={deleting.impact} verb="Deleting" />}
          onConfirm={async () => { const d = deleting; setDeleting(null); try { await s1000dApi.deleteCode(d.row.kind, d.row.issue, d.row.code, true); toast('Deleted', 'success'); reload(); } catch (e) { toast(errText(e), 'error'); } }} />
      ) : null}
    </div>
  );
}

function AddCode({ kind, issue, onClose, onSaved }: { kind: CodeKind; issue: IssueKey; onClose: () => void; onSaved: () => void }) {
  const toast = useUi((s) => s.toast);
  const [issues, setIssues] = useState<IssueKey[]>([issue]); const [code, setCode] = useState(''); const [title, setTitle] = useState(''); const [err, setErr] = useState('');
  const save = async () => { try { const r = await s1000dApi.addCode({ kind, issues, code, title }); toast(r.note, r.brexAccepts ? 'success' : 'info'); onSaved(); } catch (e) { setErr(errText(e)); } };
  return (
    <Modal title={`Add a custom ${KIND_LABEL[kind].toLowerCase().replace(/s$/, '')}`} onClose={onClose} width={480} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!code.trim() || !title.trim() || !issues.length} data-testid="cat-save">Add</button></>}>
      <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Alert tone="warn">A custom code is not in the default BREX. A data module using it fails the BREX check unless the code falls in a range the BREX leaves to projects, or the project's own BREX allows it.</Alert>
        <Field label="Code"><input className="v2-input v2-mono" autoFocus value={code} maxLength={3} onChange={(e) => setCode(e.target.value)} data-testid="cat-code" /></Field>
        <Field label="Title"><input className="v2-input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="cat-title" /></Field>
        <div className="v2-row wrap">{(['4-2', '5-0', '6', '7'] as IssueKey[]).map((i) => <label key={i} className="v2-row" style={{ gap: 4 }}><input type="checkbox" checked={issues.includes(i)} onChange={(e) => setIssues(e.target.checked ? [...issues, i] : issues.filter((x) => x !== i))} />Issue {issueLabel(i)}</label>)}</div>
        {err ? <Alert tone="bad">{err}</Alert> : null}<button type="submit" hidden />
      </form>
    </Modal>
  );
}

function EditCode({ row, onClose, onSaved }: { row: CodeRow; onClose: () => void; onSaved: () => void }) {
  const toast = useUi((s) => s.toast);
  const [title, setTitle] = useState(row.title); const [err, setErr] = useState(''); const [impact, setImpact] = useState<Impact | null>(null);
  const go = async (confirm: boolean) => {
    try { await s1000dApi.editCode({ kind: row.kind, issue: row.issue, code: row.code, title, confirmImpact: confirm }); toast('Saved', 'success'); onSaved(); }
    catch (e) { const body = (e as { body?: { code?: string; impact?: Impact } }).body; if (body?.code === 'IMPACT_CONFIRMATION_REQUIRED' && body.impact) setImpact(body.impact); else setErr(errText(e)); }
  };
  return (
    <Modal title={`Edit ${row.code}`} onClose={onClose} width={520} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={() => void go(!!impact)} data-testid="cat-edit-save">{impact ? 'Confirm and save' : 'Save'}</button></>}>
      <div className="v2-stack"><Field label="Title"><input className="v2-input" value={title} onChange={(e) => { setTitle(e.target.value); setImpact(null); }} /></Field>
        {impact ? <ImpactBody impact={impact} verb="Changing" /> : null}{err ? <Alert tone="bad">{err}</Alert> : null}</div>
    </Modal>
  );
}

// ── SNS presets ──────────────────────────────────────────────────────────────

/** The model code a custom preset belongs to (a project with that code is offered the preset when it is created). */
function ModelField({ preset, onSaved }: { preset: { id: string; model: string | null }; onSaved: () => void }) {
  const toast = useUi((s) => s.toast);
  const [v, setV] = useState(preset.model ?? '');
  useEffect(() => { setV(preset.model ?? ''); }, [preset.id, preset.model]);
  const save = async () => { try { await s1000dApi.setPresetModel(preset.id, v.trim()); toast(v.trim() ? `Offered to projects with model code ${v.trim().toUpperCase()}` : 'No model code: offered to nobody automatically', 'success'); onSaved(); } catch (e) { toast(errText(e), 'error'); } };
  return (
    <div className="v2-row wrap" style={{ gap: 8 }} data-testid="preset-model">
      <label className="v2-row" style={{ gap: 6 }}>Model code<input className="v2-input v2-mono" style={{ width: 150 }} maxLength={14} value={v} onChange={(e) => setV(e.target.value)} placeholder="e.g. RDR" aria-label="Model code of this preset" /></label>
      <button className="btn btn-sm" disabled={v.trim().toUpperCase() === (preset.model ?? '')} onClick={() => void save()}>Save</button>
      <span className="v2-hint">Projects with this model code are offered this numbering.</span>
    </div>
  );
}

export function SnsPresetsSection() {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => s1000dApi.presets(), []);
  const [sel, setSel] = useState('');
  const [creating, setCreating] = useState(false);
  const [dup, setDup] = useState(false);
  const [del, setDel] = useState(false);
  const detail = useAsync(async () => (sel ? s1000dApi.preset(sel) : null), [sel]);
  const [q, setQ] = useState('');
  const p = list.data?.find((x) => x.id === sel);
  const nodes = useMemo(() => (detail.data?.nodes ?? []).filter((n) => !q || `${n.path} ${n.title}`.toLowerCase().includes(q.toLowerCase())), [detail.data, q]);
  if (list.loading && !list.data) return <Loading />;
  return (
    <div className="v2-stack" data-testid="sns-presets">
      <div className="v2-row v2-spread"><div><h3 style={{ margin: 0 }}>Numbering (SNS)</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>The system / subsystem / assembly numbers of a data module code. Give a preset a <b>model code</b> and every project with that model code is offered it when it is created: add the model's systems once, and its data module codes follow. Reusable starting points. Projects copy a preset and then own their SNS; changing a preset never changes a project.</p></div>
        <button className="btn btn-primary" onClick={() => setCreating(true)} data-testid="preset-new"><Icon name="plus" />New preset</button></div>
      <div className="v2-card"><table className="v2-table"><thead><tr><th>Preset</th><th>Model code</th><th>Systems</th><th>Entries</th><th /></tr></thead><tbody>
        {(list.data ?? []).map((x) => <tr key={x.id} className="clickable" onClick={() => setSel(x.id)} data-testid="preset-row"><td><b><RowButton onSelect={() => setSel(x.id)} selected={sel === x.id}>{x.name}</RowButton></b> {x.readOnly ? <Badge>read-only</Badge> : <Badge tone="ok">custom</Badge>}</td><td className="v2-mono">{x.model ?? '—'}</td><td>{x.systems}</td><td>{x.entries}</td><td style={{ textAlign: 'right' }}>{sel === x.id ? <Badge tone="accent">open</Badge> : null}</td></tr>)}</tbody></table></div>
      {p ? (
        <div className="v2-card v2-card-pad v2-stack">
          <div className="v2-row v2-spread wrap"><h4 style={{ margin: 0 }}>{p.name}</h4>
            <div className="v2-row wrap"><input className="v2-input" style={{ width: 200 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the preset" />
              <a className="btn" href={s1000dApi.presetExportUrl(p.id, 'csv')} download>Export CSV</a><a className="btn" href={s1000dApi.presetExportUrl(p.id, 'json')} download>Export JSON</a>
              <button className="btn" onClick={() => setDup(true)}>Copy as custom…</button>
              {!p.readOnly ? <button className="btn" onClick={() => setDel(true)}>Delete preset</button> : null}</div></div>
          {!p.readOnly ? <ModelField preset={p} onSaved={() => list.reload()} /> : null}
          <p className="v2-hint" style={{ margin: 0 }}><b>Source:</b> {p.source}<br /><b>Limitation:</b> {p.limitation ?? 'none recorded'}</p>
          {!p.readOnly ? <PresetEditor id={p.id} onChanged={() => { detail.reload(); list.reload(); }} /> : null}
          <div className="v2-card" style={{ maxHeight: 460, overflow: 'auto' }}><table className="v2-table"><tbody>{nodes.map((n: PresetNode) => (
            <tr key={n.path}><td style={{ paddingLeft: 8 + Math.max(0, n.level - 1) * 22, width: 160 }} className="v2-mono">{n.code}{n.note?.ambiguous ? '*' : ''}</td>
              <td>{n.title}{n.note?.category ? <> <Badge>category</Badge></> : null}{n.note?.ambiguous ? <> <Badge tone="warn" title="The specification defines this system more than once; it is not copied into projects automatically">defined twice</Badge></> : null}{n.note?.rangeEnd ? <> <Badge>range to {String(n.note.rangeEnd)}</Badge></> : null}
                {n.definition ? <div className="v2-hint">{n.definition}</div> : null}</td>
              {!p.readOnly ? <td style={{ textAlign: 'right' }}><button className="icon-btn" aria-label={`Delete ${n.path}`} title={`Delete ${n.path}`} onClick={async () => { try { await s1000dApi.deletePresetNode(p.id, n.path, true); detail.reload(); list.reload(); } catch (e) { toast(errText(e), 'error'); } }}><Icon name="trash" size={14} /></button></td> : null}</tr>))}</tbody></table></div>
        </div>
      ) : <Empty title="Choose a preset to see its entries" />}
      {creating ? <PromptModal title="New SNS preset" label="Name" confirmLabel="Create" onClose={() => setCreating(false)} onSubmit={async (name) => { const r = await s1000dApi.createPreset(name); toast('Preset created', 'success'); list.reload(); setSel(r.preset.id); }} /> : null}
      {dup && p ? <PromptModal title="Copy as a custom preset" label="Name" initial={`${p.name} (copy)`} confirmLabel="Copy" onClose={() => setDup(false)} onSubmit={async (name) => { const r = await s1000dApi.duplicatePreset(p.id, name); list.reload(); setSel(r.preset.id); }} /> : null}
      {del && p ? <ConfirmModal title="Delete this preset?" danger confirmLabel="Delete" onClose={() => setDel(false)} body={<p style={{ marginTop: 0 }}>{p.name}. Projects that copied it keep their SNS.</p>} onConfirm={async () => { setDel(false); try { await s1000dApi.deletePreset(p.id); setSel(''); list.reload(); } catch (e) { toast(errText(e), 'error'); } }} /> : null}
    </div>
  );
}

function PresetEditor({ id, onChanged }: { id: string; onChanged: () => void }) {
  const toast = useUi((s) => s.toast);
  const [path, setPath] = useState(''); const [title, setTitle] = useState('');
  const add = async () => { try { await s1000dApi.putPresetNode(id, path.trim().toUpperCase(), title); setPath(''); setTitle(''); onChanged(); } catch (e) { toast(errText(e), 'error'); } };
  return (
    <div className="v2-row wrap">
      <input className="v2-input v2-mono" style={{ width: 160 }} placeholder="21 or 21/10 or 21/10/00" value={path} onChange={(e) => setPath(e.target.value)} aria-label="Path" />
      <input className="v2-input" style={{ width: 280 }} placeholder="Title" value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Title" />
      <button className="btn" onClick={add} disabled={!path.trim()}>Add / retitle</button>
    </div>
  );
}


/** Extension profiles: a namespace plus the XSD that validates content in it. Projects enable them one by one. */
export function ExtensionsSection() {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => csdbApi.adminExtensions(), []);
  const [form, setForm] = useState({ name: '', namespace: '', description: '', xsd: '', xsdName: '' });
  const [del, setDel] = useState<string | null>(null);
  const pick = async (f: File | undefined) => { if (f) setForm((x) => ({ ...x, xsd: '', xsdName: f.name })); if (f) { const t = await f.text(); setForm((x) => ({ ...x, xsd: t, xsdName: f.name })); } };
  const add = async () => { try { await csdbApi.registerExtension(form); toast('Profile registered', 'success'); setForm({ name: '', namespace: '', description: '', xsd: '', xsdName: '' }); list.reload(); } catch (e) { toast(errText(e), 'error'); } };
  if (list.loading && !list.data) return <Loading />;
  return (
    <div className="v2-stack" data-testid="ext-admin">
      <Alert tone="ok"><b>What is this?</b> Some organisations add their own elements to S1000D data modules (a customer-specific tag, for example). S1000D allows that only when the elements sit in their own XML namespace and come with their own schema. An extension profile registers that namespace and schema, so the platform accepts and checks those elements instead of reporting them as errors. <b>Most projects never need one</b>: if nobody adds custom elements, you can ignore this page.</Alert>
      <p className="v2-hint">An extension profile lets a project use content in another XML namespace. The XSD must be one self-contained file whose targetNamespace equals the namespace. Content in a namespace with no profile is a validation error; nothing is ever dropped.</p>
      {!list.data?.profiles.length ? <Empty title="No profiles yet">Register one below.</Empty> : (
        <table className="v2-table"><thead><tr><th>Name</th><th>Namespace</th><th>Schema</th><th>Projects</th><th /></tr></thead><tbody>
          {list.data.profiles.map((p) => <tr key={p.id}><td>{p.name}</td><td className="v2-mono">{p.namespace}</td><td>{p.xsdName}</td><td>{p.projects}</td><td><button className="v2-btn v2-btn-sm v2-btn-danger" onClick={() => setDel(p.id)}>Delete</button></td></tr>)}</tbody></table>
      )}
      <div className="v2-card"><h3 style={{ marginTop: 0 }}>Register a profile</h3>
        <div className="v2-stack">
          <Field label="Name"><input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Namespace URI"><input value={form.namespace} onChange={(e) => setForm({ ...form, namespace: e.target.value })} placeholder="http://example.com/ns/ext" /></Field>
          <Field label="Description"><input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></Field>
          <Field label="XSD file"><input type="file" accept=".xsd" onChange={(e) => pick(e.target.files?.[0])} /></Field>
          <div><button className="v2-btn v2-btn-primary" disabled={!form.name || !form.namespace || !form.xsd} onClick={add}>Register</button></div>
        </div></div>
      {del ? <ConfirmModal title="Delete this profile?" body="Projects that enabled it must disable it first." confirmLabel="Delete" danger onConfirm={async () => { try { await csdbApi.deleteExtension(del); list.reload(); } catch (e) { toast(errText(e), 'error'); } setDel(null); }} onClose={() => setDel(null)} /> : null}
    </div>
  );
}

/** The document-type registry, as the platform reads it: which schema is bundled for which issue. Generated from backend/schemas, not typed in. */
export function CoverageSection() {
  const cov = useAsync(() => csdbApi.coverage(), []);
  if (cov.loading && !cov.data) return <Loading />;
  const issues = [['4-2', '4.2'], ['5-0', '5.0'], ['6', '6.0'], ['7', '7.0']];
  return (
    <div className="v2-stack" data-testid="coverage">
      <p className="v2-hint">Schema availability per S1000D issue, read from the bundled XSD sets. A missing cell means no schema is bundled for that issue (nothing is invented).</p>
      <table className="v2-table"><thead><tr><th>Schema</th><th>Name</th><th>Category</th><th>File prefix</th>{issues.map(([, l]) => <th key={l}>{l}</th>)}</tr></thead><tbody>
        {(cov.data?.rows ?? []).map((r) => <tr key={r.schema}><td className="v2-mono">{r.schema}</td><td>{r.name}</td><td>{r.category}</td><td>{r.filePrefix ?? '—'}</td>{issues.map(([k]) => <td key={k}>{r.xsd[k] ? <Badge tone="ok">{r.root[k]}</Badge> : <Badge tone="bad">missing</Badge>}</td>)}</tr>)}</tbody></table>
    </div>
  );
}
