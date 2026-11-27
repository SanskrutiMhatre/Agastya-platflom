// Project settings → S1000D: the project's own configuration.
//   Identity        model identification code, issue, language, enterprises, security, BREX
//   Codes           which information codes the project offers
//   Data modules    which of the 21 types the project offers (with each type's suggested codes)
//   SNS             the project's standard numbering hierarchy (system → subsystem → assembly)
// Project owners and managers change it; everyone else reads it. The SERVER enforces it when a data module is created.

import { useEffect, useMemo, useRef, useState } from 'react';
import { referenceApi, s1000dApi, issueLabel, ISSUE_OPTIONS, type ImportReport, type ModelCodePlan, type ProjectBundle, type SnsNode } from '../../api';
import { Icon } from '../../components/Icon';
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, Modal, errText, useAsync } from '../../components/ui';
import { useProject } from '../../layouts/ProjectShell';
import { useUi } from '../../store/ui';
import { tablistKeys } from '../../components/a11y';

type Section = 'identity' | 'codes' | 'types' | 'sns';
const SECTIONS: Array<[Section, string]> = [['identity', 'Identity'], ['codes', 'Information codes'], ['types', 'Data module types'], ['sns', 'SNS']];

export function S1000dConfig() {
  const { id, role } = useProject();
  const [section, setSection] = useState<Section>('identity');
  const bundle = useAsync(() => s1000dApi.project(id), [id]);
  const can = role === 'owner' || role === 'manager';
  if (bundle.loading && !bundle.data) return <Loading />;
  if (!bundle.data) return <Alert tone="bad">{bundle.error}</Alert>;
  const b = bundle.data;
  return (
    <div className="v2-stack" data-testid="s1000d-config">
      {!can ? <Alert tone="warn">You have {role} access: the configuration is read-only. A project owner or manager changes it.</Alert> : null}
      {b.config.origin.by === 'migration' && b.config.origin.notes.length ? (
        <Alert tone="warn"><b>Derived from the existing data modules.</b> This project was set up before S1000D configuration existed. Please review it.<ul style={{ margin: '6px 0 0 18px' }}>{b.config.origin.notes.map((n) => <li key={n}>{n}</li>)}</ul></Alert>
      ) : null}
      <div className="v2-tabs" role="tablist" aria-label="S1000D configuration" onKeyDown={tablistKeys}>
        {SECTIONS.map(([k, label]) => <button key={k} role="tab" aria-selected={section === k} className={`v2-tab ${section === k ? 'active' : ''}`} onClick={() => setSection(k)} data-testid={`s1000d-tab-${k}`}>{label}</button>)}
      </div>
      {section === 'identity' ? <Identity b={b} id={id} can={can} reload={bundle.reload} /> : null}
      {section === 'codes' ? <Codes b={b} id={id} can={can} reload={bundle.reload} /> : null}
      {section === 'types' ? <Types b={b} id={id} can={can} reload={bundle.reload} /> : null}
      {section === 'sns' ? <Sns b={b} id={id} can={can} reload={bundle.reload} /> : null}
    </div>
  );
}

interface P { b: ProjectBundle; id: string; can: boolean; reload: () => void }

/** Change the model code after data modules exist: type the new code, see exactly what would change, then confirm. A backup of the originals is kept. */
function ModelCodeChange({ id, current, onDone }: { id: string; current: string; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [open, setOpen] = useState(false);
  const [mic, setMic] = useState('');
  const [plan, setPlan] = useState<ModelCodePlan | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const preview = async () => { setBusy(true); setErr(''); setPlan(null); try { setPlan(await s1000dApi.modelCode(id, mic, false)); } catch (e) { const b = (e as { body?: ModelCodePlan }).body; if (b?.problems) setPlan(b); else setErr(errText(e)); } finally { setBusy(false); } };
  const apply = async () => { setBusy(true); setErr(''); try { const r = await s1000dApi.modelCode(id, mic, true); toast(`Model code changed to ${r.to}: ${r.filesChanged} files updated`, 'success'); setOpen(false); onDone(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return (<>
    <button className="btn btn-sm" onClick={() => { setOpen(true); setMic(''); setPlan(null); setErr(''); }} data-testid="change-mic">Change model code…</button>
    {open ? <Modal title={`Change the model code (now ${current})`} onClose={() => setOpen(false)} width={640} buttons={<>
      <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
      <button className="btn" disabled={busy || !mic.trim()} onClick={() => void preview()} data-testid="mic-preview">Show what will change</button>
      <button className="btn btn-primary" disabled={busy || !plan || plan.problems.length > 0} onClick={() => void apply()} data-testid="mic-apply">Change it</button>
    </>}>
      <div className="v2-stack">
        <p className="v2-hint" style={{ margin: 0 }}>Every data module file, its identification and every reference to it - in the data modules and in the publication - move to the new code together. The originals are kept in a backup folder inside the project.</p>
        <Field label="New model code" hint="2–14 letters or digits."><input className="v2-input v2-mono" maxLength={14} value={mic} onChange={(e) => { setMic(e.target.value); setPlan(null); }} data-testid="mic-new" /></Field>
        {plan ? (plan.problems.length
          ? <Alert tone="bad"><ul style={{ margin: 0, paddingLeft: 18 }}>{plan.problems.map((p) => <li key={p}>{p}</li>)}</ul></Alert>
          : <Alert tone="ok" ><div data-testid="mic-plan"><b>{plan.renamed.length} files will be renamed</b> and {plan.codesRewritten} codes rewritten in {plan.filesChanged} files ({plan.from} → {plan.to}).<br />Left alone: {plan.untouched.join('; ')}.</div></Alert>) : null}
        {err ? <Alert tone="bad">{err}</Alert> : null}
      </div>
    </Modal> : null}
  </>);
}

// ── Identity ─────────────────────────────────────────────────────────────────
function Identity({ b, id, can, reload }: P) {
  const toast = useUi((s) => s.toast);
  const c = b.config;
  const ref = useAsync(() => referenceApi.get(), []);
  const [f, setF] = useState({ mic: c.mic, issue: c.issue ?? '', language: c.language, country: c.country, rpcCode: c.responsiblePartner.code, rpcName: c.responsiblePartner.name, orgCode: c.originator.code, orgName: c.originator.name, security: c.security, brexMode: c.brex.mode, brexDmc: c.brex.dmc ?? '' });
  const [busy, setBusy] = useState(false); const [err, setErr] = useState('');
  const locked = (k: string) => b.lock.fields.includes(k);
  const save = async () => {
    setBusy(true); setErr('');
    try {
      await s1000dApi.saveProject(id, {
        mic: f.mic, ...(f.issue ? { issue: f.issue } : {}), language: f.language, country: f.country, security: f.security,
        responsiblePartner: { code: f.rpcCode, name: f.rpcName }, originator: { code: f.orgCode, name: f.orgName },
        brex: { mode: f.brexMode, dmc: f.brexMode === 'project' ? f.brexDmc : null },
      }, b.version);
      toast('Configuration saved', 'success'); reload();
    } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const rpcs = ref.data?.rpc ?? [];
  return (
    <div className="v2-card v2-card-pad v2-stack" style={{ maxWidth: 720 }} data-testid="s1000d-identity">
      {b.lock.locked ? <Alert tone="warn"><div className="v2-row v2-spread"><span><b>{b.lock.fields.includes('issue') ? 'Model code and issue are locked.' : 'The model code is locked.'}</b> {b.lock.explanation}</span>{can && b.lock.fields.includes('mic') ? <ModelCodeChange id={id} current={c.mic} onDone={reload} /> : null}</div></Alert> : null}
      <div className="v2-grid cols-2">
        <Field label="Model identification code" hint="2–14 letters or digits; part of every data module code."><input className="v2-input v2-mono" value={f.mic} maxLength={14} disabled={!can || locked('mic')} onChange={set('mic')} /></Field>
        <Field label="S1000D issue" hint={c.issue ? undefined : 'Not set yet: choose the issue the data modules are written for.'}>
          <select className="v2-select" value={f.issue} disabled={!can || locked('issue')} onChange={set('issue')}>
            {!c.issue ? <option value="">(not set)</option> : null}{ISSUE_OPTIONS.map((i) => <option key={i.key} value={i.key}>Issue {i.label}</option>)}
          </select>
        </Field>
        <Field label="Language"><input className="v2-input" value={f.language} maxLength={3} disabled={!can} onChange={set('language')} /></Field>
        <Field label="Country"><input className="v2-input" value={f.country} maxLength={2} disabled={!can} onChange={set('country')} /></Field>
        <Field label="Responsible partner company — code" hint="5 characters (CAGE / NCAGE).">
          {rpcs.length ? <select className="v2-select" value={f.rpcCode} disabled={!can} onChange={(e) => { const r = rpcs.find((x) => x.cage === e.target.value); setF({ ...f, rpcCode: e.target.value, rpcName: r?.name ?? f.rpcName }); }}><option value="">(not set)</option>{rpcs.map((r) => <option key={r.cage} value={r.cage}>{r.cage} – {r.name}</option>)}</select>
            : <input className="v2-input v2-mono" value={f.rpcCode} maxLength={5} disabled={!can} onChange={set('rpcCode')} />}
        </Field>
        <Field label="Responsible partner company — name"><input className="v2-input" value={f.rpcName} disabled={!can || rpcs.length > 0} onChange={set('rpcName')} /></Field>
        <Field label="Originator — code" hint="Leave empty when it is the same enterprise."><input className="v2-input v2-mono" value={f.orgCode} maxLength={5} disabled={!can} onChange={set('orgCode')} /></Field>
        <Field label="Originator — name"><input className="v2-input" value={f.orgName} disabled={!can} onChange={set('orgName')} /></Field>
        <Field label="Default security classification"><select className="v2-select" value={f.security} disabled={!can} onChange={set('security')}>{(ref.data?.security ?? [{ code: '01', name: 'Unclassified' }]).map((s) => <option key={s.code} value={s.code}>{s.code} – {s.name}</option>)}</select></Field>
        <Field label="Business rules (BREX)" hint="The default BREX of the issue is used unless the project has its own BREX data module.">
          <select className="v2-select" value={f.brexMode} disabled={!can} onChange={set('brexMode')}><option value="default">Default BREX of the issue ({issueLabel(c.issue)})</option><option value="project">This project's own BREX data module</option></select>
        </Field>
        {f.brexMode === 'project' ? <Field label="Project BREX data module code" hint="e.g. MYPROJ-A-00-00-00-00A-022A-D"><input className="v2-input v2-mono" value={f.brexDmc} disabled={!can} onChange={set('brexDmc')} /></Field> : null}
      </div>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      {can ? <div><button className="btn btn-primary" disabled={busy} onClick={save} data-testid="s1000d-save-identity">Save configuration</button></div> : null}
    </div>
  );
}

// ── Information codes ────────────────────────────────────────────────────────
function Codes({ b, id, can, reload }: P) {
  const toast = useUi((s) => s.toast);
  const issue = b.issue;
  const cat = useAsync(() => s1000dApi.catalogue(issue, 'infoCode'), [issue]);
  const [mode, setMode] = useState(b.config.codeMode);
  const [sel, setSel] = useState<Set<string>>(new Set(b.selected.infoCode));
  const [q, setQ] = useState(''); const [busy, setBusy] = useState(false);
  const rows = useMemo(() => (cat.data?.codes ?? []).filter((c) => !q || `${c.code} ${c.title}`.toLowerCase().includes(q.toLowerCase())), [cat.data, q]);
  const recommended = useMemo(() => new Set(b.dmTypes.flatMap((t) => [t.infoCode ?? '', ...(t.advice?.recommended ?? [])]).filter(Boolean)), [b]);
  const save = async () => {
    setBusy(true);
    try { await s1000dApi.saveCodes(id, 'infoCode', [...sel], mode); toast('Information codes saved', 'success'); reload(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); }
  };
  if (cat.loading && !cat.data) return <Loading />;
  return (
    <div className="v2-stack" data-testid="s1000d-codes">
      {b.issueAssumed ? <Alert tone="warn">The project has no S1000D issue yet, so the Issue {issueLabel(issue)} catalogue is shown. Set the issue under Identity.</Alert> : null}
      <div className="v2-card v2-card-pad v2-stack">
        <div className="v2-row v2-spread">
          <div><h4 style={{ margin: 0 }}>Information codes — Issue {issueLabel(issue)}</h4><p className="v2-sub" style={{ margin: '2px 0 0' }}>From the issue's default BREX (rule {cat.data?.rule}). {cat.data?.codes.length} codes{cat.data?.ranges.length ? ` and ${cat.data.ranges.length} project-available ranges` : ''}.</p></div>
        </div>
        <label className="v2-row" style={{ gap: 6 }}><input type="radio" checked={mode === 'all'} disabled={!can} onChange={() => setMode('all')} />Offer every code of the issue (default)</label>
        <label className="v2-row" style={{ gap: 6 }}><input type="radio" checked={mode === 'selected'} disabled={!can} onChange={() => setMode('selected')} data-testid="codes-selected" />Offer only the codes I choose ({sel.size} chosen)</label>
        {mode === 'selected' ? (
          <>
            <div className="v2-row wrap">
              <input className="v2-input" style={{ maxWidth: 260 }} placeholder="Filter codes…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Filter information codes" />
              {can ? <button className="btn btn-sm" onClick={() => setSel(new Set([...sel, ...[...recommended].filter((c) => cat.data?.codes.some((x) => x.code === c))]))}>Add the codes the 21 types suggest</button> : null}
              {can ? <button className="btn btn-sm" onClick={() => setSel(new Set([...sel, ...rows.map((r) => r.code)]))}>Add all shown</button> : null}
              {can ? <button className="btn btn-sm" onClick={() => setSel(new Set())}>Clear</button> : null}
            </div>
            <div className="v2-card" style={{ maxHeight: 420, overflow: 'auto' }}>
              <table className="v2-table"><tbody>{rows.map((c) => (
                <tr key={c.code}><td style={{ width: 36 }}><input type="checkbox" checked={sel.has(c.code)} disabled={!can} aria-label={`Offer ${c.code}`} onChange={(e) => { const n = new Set(sel); if (e.target.checked) n.add(c.code); else n.delete(c.code); setSel(n); }} /></td>
                  <td className="v2-mono" style={{ width: 70 }}>{c.code}</td><td>{c.title}{c.origin === 'custom' ? <> <Badge tone={c.brexAccepts ? 'ok' : 'warn'}>{c.brexAccepts ? 'project range' : 'custom, outside BREX'}</Badge></> : null}</td></tr>))}</tbody></table>
            </div>
          </>
        ) : null}
        {can ? <div><button className="btn btn-primary" disabled={busy || (mode === 'selected' && !sel.size)} onClick={save} data-testid="s1000d-save-codes">Save</button></div> : null}
        <p className="v2-hint" style={{ margin: 0 }}>Choosing codes narrows what the New data module wizard offers and what the server accepts for NEW data modules. Existing data modules and the BREX check are not changed by it.</p>
      </div>
    </div>
  );
}

// ── Data module types ────────────────────────────────────────────────────────
function Types({ b, id, can, reload }: P) {
  const toast = useUi((s) => s.toast);
  const [on, setOn] = useState<Set<string>>(new Set(b.dmTypes.filter((t) => t.enabled).map((t) => t.schema)));
  const [busy, setBusy] = useState(false);
  const save = async () => { setBusy(true); try { await s1000dApi.saveTypes(id, [...on]); toast('Data module types saved', 'success'); reload(); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(false); } };
  return (
    <div className="v2-stack" data-testid="s1000d-types">
      <div className="v2-card">
        <table className="v2-table"><thead><tr><th style={{ width: 40 }} /><th>Type</th><th style={{ width: 130 }}>Default info code</th><th>Other codes it suggests</th></tr></thead><tbody>
          {b.dmTypes.map((t) => (
            <tr key={t.schema}><td><input type="checkbox" aria-label={`Offer ${t.name}`} checked={on.has(t.schema)} disabled={!can} onChange={(e) => { const n = new Set(on); if (e.target.checked) n.add(t.schema); else n.delete(t.schema); setOn(n); }} /></td>
              <td><b>{t.name}</b> <span className="v2-mono v2-hint">{t.schema}</span></td>
              <td className="v2-mono">{t.infoCode || '—'}{t.advice?.unresolved ? <> <Badge tone="warn" title={t.advice.unresolved}>unconfirmed</Badge></> : t.advice?.evidence ? <> <Badge tone="ok" title={`${t.advice.evidence.note} (${t.advice.evidence.refs.join('; ')})`}>spec: {t.advice.evidence.status}</Badge></> : null}</td>
              <td className="v2-hint">{t.advice?.recommended.length ? `${t.advice.recommended.slice(0, 8).join(', ')}${t.advice.recommended.length > 8 ? ` … (${t.advice.recommended.length})` : ''}` : '—'}</td></tr>))}
        </tbody></table>
      </div>
      <p className="v2-hint" style={{ margin: 0 }}>Suggestions come from the s1kd-newdm code map and are advice only (not S1000D text). Any enabled code can be used with any type; BREX decides what is valid. "Unconfirmed" defaults are not settled by the specification (hover for why); "spec" badges say what the S1000D 4.2 text confirms.</p>
      {can ? <div><button className="btn btn-primary" disabled={busy || !on.size} onClick={save}>Save</button></div> : null}
    </div>
  );
}

// ── SNS ──────────────────────────────────────────────────────────────────────
function ReportView({ r }: { r: ImportReport }) {
  return (
    <div className="v2-stack" style={{ gap: 6 }} data-testid="sns-report">
      <div><b>{r.added}</b> to add · {r.unchanged} unchanged · {r.conflicts.length} with a different title · {r.skipped.length} skipped · {r.errors.length} errors</div>
      {r.errors.length ? <Alert tone="bad"><ul style={{ margin: 0, paddingLeft: 18 }}>{r.errors.slice(0, 12).map((e, i) => <li key={i}>{String(e.line)}: {e.message}</li>)}</ul></Alert> : null}
      {r.conflicts.length ? <Alert tone="warn">Different title already in the project (kept): {r.conflicts.slice(0, 6).map((c) => `${c.path} “${c.existing}” vs “${c.incoming}”`).join('; ')}</Alert> : null}
      {r.skipped.length ? <details><summary>{r.skipped.length} skipped</summary><ul style={{ margin: 0, paddingLeft: 18 }}>{r.skipped.slice(0, 40).map((s, i) => <li key={i}><span className="v2-mono">{s.path}</span> — {s.reason}</li>)}</ul></details> : null}
    </div>
  );
}

function Sns({ b, id, can, reload }: P) {
  const toast = useUi((s) => s.toast);
  const [q, setQ] = useState('');
  const sns = useAsync(() => s1000dApi.sns(id, q), [id, q, b.version]);
  const presets = useAsync(() => s1000dApi.presets(), []);
  const [adding, setAdding] = useState<{ parent: string } | null>(null);
  const [editing, setEditing] = useState<SnsNode | null>(null);
  const [del, setDel] = useState<SnsNode | null>(null);
  const [applying, setApplying] = useState(false);
  const [importing, setImporting] = useState(false);
  const flat = useMemo(() => (sns.data?.nodes ?? []).slice().sort((a, b2) => a.path.localeCompare(b2.path)), [sns.data]);
  const refresh = () => { sns.reload(); reload(); };
  const toggleEnforce = async (v: boolean) => { try { await s1000dApi.saveProject(id, { snsEnforced: v }, b.version); reload(); } catch (e) { toast(errText(e), 'error'); } };
  return (
    <div className="v2-stack" data-testid="s1000d-sns">
      <div className="v2-card v2-card-pad v2-stack">
        <div className="v2-row v2-spread wrap">
          <div><h4 style={{ margin: 0 }}>Standard numbering system</h4><p className="v2-sub" style={{ margin: '2px 0 0' }}>{sns.data?.total ?? 0} entries. The project's own hierarchy: system → subsystem (sub + sub-sub) → assembly. The New data module wizard picks the code from it.</p></div>
          <div className="v2-row wrap">
            <input className="v2-input" style={{ width: 200 }} placeholder="Search code or title…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the SNS" />
            {can ? <button className="btn" onClick={() => setApplying(true)} data-testid="sns-preset">Start from a preset…</button> : null}
            {can ? <button className="btn" onClick={() => setImporting(true)}>Import…</button> : null}
            <a className="btn" href={s1000dApi.snsExportUrl(id, 'csv')} download>Export CSV</a>
            <a className="btn" href={s1000dApi.snsExportUrl(id, 'json')} download>Export JSON</a>
            {can ? <button className="btn btn-primary" onClick={() => setAdding({ parent: '' })} data-testid="sns-add"><Icon name="plus" />Add system</button> : null}
          </div>
        </div>
        <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={b.config.snsEnforced} disabled={!can} onChange={(e) => void toggleEnforce(e.target.checked)} />New data modules must use codes from this SNS (when it has entries)</label>
        {sns.loading && !sns.data ? <Loading /> : flat.length === 0 ? <Empty title={q ? 'Nothing matches' : 'No SNS yet'}>{q ? 'Try a different search.' : 'Add a system, or start from a preset. Until it has entries, the wizard asks for free codes.'}</Empty> : (
          <div className="v2-card" style={{ maxHeight: 480, overflow: 'auto' }}>
            <table className="v2-table"><tbody>{flat.map((n) => (
              <tr key={n.path} data-testid="sns-row">
                <td style={{ paddingLeft: 8 + (n.level - 1) * 22, width: 150 }} className="v2-mono">{n.code}</td>
                <td>{n.title || <span className="v2-hint">no title</span>}{n.used ? <> <Badge title="Data modules use this entry">{n.used} DM</Badge></> : null}</td>
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>{can ? <>
                  {n.level < 3 ? <button className="icon-btn" title={n.level === 1 ? 'Add subsystem' : 'Add assembly'} aria-label={`Add below ${n.path}`} onClick={() => setAdding({ parent: n.path })}><Icon name="plus" size={14} /></button> : null}
                  <button className="icon-btn" title="Edit" aria-label={`Edit ${n.path}`} onClick={() => setEditing(n)}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" title="Delete" aria-label={`Delete ${n.path}`} onClick={() => setDel(n)}><Icon name="trash" size={14} /></button></> : null}</td>
              </tr>))}</tbody></table>
          </div>
        )}
      </div>
      {adding ? <SnsAdd id={id} parent={adding.parent} onClose={() => setAdding(null)} onSaved={() => { setAdding(null); refresh(); }} /> : null}
      {editing ? <SnsEdit id={id} node={editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); refresh(); }} /> : null}
      {del ? (
        <ConfirmModal title="Delete this SNS entry?" danger confirmLabel="Delete" onClose={() => setDel(null)}
          body={<p style={{ marginTop: 0 }}><span className="v2-mono">{del.path}</span> {del.title}. Entries below it go too. An entry that data modules use cannot be deleted.</p>}
          onConfirm={async () => { const d = del; setDel(null); try { await s1000dApi.deleteSns(id, d.path, true); toast('Deleted', 'success'); refresh(); } catch (e) { toast(errText(e), 'error'); } }} />
      ) : null}
      {applying ? <PresetModal id={id} presets={presets.data ?? []} onClose={() => setApplying(false)} onDone={() => { setApplying(false); refresh(); }} /> : null}
      {importing ? <ImportModal id={id} onClose={() => setImporting(false)} onDone={() => { setImporting(false); refresh(); }} /> : null}
    </div>
  );
}

function SnsAdd({ id, parent, onClose, onSaved }: { id: string; parent: string; onClose: () => void; onSaved: () => void }) {
  const level = parent ? parent.split('/').length + 1 : 1;
  const [code, setCode] = useState(''); const [title, setTitle] = useState(''); const [err, setErr] = useState('');
  const hint = ['2 or 3 letters/digits', '2 letters/digits (subsystem + sub-subsystem, e.g. 10)', '2 or 4 letters/digits'][level - 1];
  const save = async () => { try { await s1000dApi.addSns(id, `${parent ? parent + '/' : ''}${code.trim().toUpperCase()}`, title); onSaved(); } catch (e) { setErr(errText(e)); } };
  return (
    <Modal title={`Add ${['system', 'subsystem', 'assembly'][level - 1]}${parent ? ` under ${parent}` : ''}`} onClose={onClose} width={440} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save} disabled={!code.trim()} data-testid="sns-save">Add</button></>}>
      <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <Field label="Code" hint={hint}><input className="v2-input v2-mono" autoFocus maxLength={4} value={code} onChange={(e) => setCode(e.target.value)} data-testid="sns-code" /></Field>
        <Field label="Title"><input className="v2-input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} data-testid="sns-title" /></Field>
        {err ? <Alert tone="bad">{err}</Alert> : null}<button type="submit" hidden />
      </form>
    </Modal>
  );
}

function SnsEdit({ id, node, onClose, onSaved }: { id: string; node: SnsNode; onClose: () => void; onSaved: () => void }) {
  const [code, setCode] = useState(node.code); const [title, setTitle] = useState(node.title); const [err, setErr] = useState('');
  const save = async () => { try { await s1000dApi.editSns(id, node.path, { title, ...(code.toUpperCase() !== node.code ? { code } : {}) }); onSaved(); } catch (e) { setErr(errText(e)); } };
  return (
    <Modal title={`Edit ${node.path}`} onClose={onClose} width={440} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" onClick={save}>Save</button></>}>
      <div className="v2-stack">
        <Field label="Code" hint="Changing it moves the entry and everything below it. Not possible while data modules use it."><input className="v2-input v2-mono" maxLength={4} value={code} onChange={(e) => setCode(e.target.value)} /></Field>
        <Field label="Title"><input className="v2-input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        {err ? <Alert tone="bad">{err}</Alert> : null}
      </div>
    </Modal>
  );
}

function PresetModal({ id, presets, onClose, onDone }: { id: string; presets: Array<{ id: string; name: string; source: string; limitation: string | null; systems: number }>; onClose: () => void; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [pid, setPid] = useState(presets[0]?.id ?? ''); const [rep, setRep] = useState<ImportReport | null>(null); const [err, setErr] = useState('');
  const p = presets.find((x) => x.id === pid);
  const preview = async () => { setErr(''); try { setRep(await s1000dApi.applyPreset(id, pid, true)); } catch (e) { setErr(errText(e)); } };
  const apply = async () => { try { const r = await s1000dApi.applyPreset(id, pid, false); toast(`${r.added} entries added`, 'success'); onDone(); } catch (e) { setErr(errText(e)); } };
  return (
    <Modal title="Start from a preset" onClose={onClose} width={640} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn" onClick={preview} disabled={!pid}>Preview</button><button className="btn btn-primary" onClick={apply} disabled={!pid || !rep || !!rep.errors.length} data-testid="preset-apply">Copy into project</button></>}>
      <div className="v2-stack">
        <Field label="Preset"><select className="v2-select" value={pid} onChange={(e) => { setPid(e.target.value); setRep(null); }} data-testid="preset-select">{presets.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.systems} systems)</option>)}</select></Field>
        {p ? <p className="v2-hint" style={{ margin: 0 }}><b>Source:</b> {p.source}<br /><b>Limitation:</b> {p.limitation ?? 'none recorded'}</p> : null}
        <p className="v2-hint" style={{ margin: 0 }}>The entries are copied: from then on the project's SNS is its own, and changing the preset does not change it. Existing entries are never overwritten.</p>
        {err ? <Alert tone="bad">{err}</Alert> : null}{rep ? <ReportView r={rep} /> : null}
      </div>
    </Modal>
  );
}

function ImportModal({ id, onClose, onDone }: { id: string; onClose: () => void; onDone: () => void }) {
  const toast = useUi((s) => s.toast);
  const [text, setText] = useState(''); const [format, setFormat] = useState<'csv' | 'json'>('csv'); const [rep, setRep] = useState<ImportReport | null>(null); const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const run = async (dry: boolean) => { setErr(''); try { const r = await s1000dApi.importSns(id, format, text, dry); setRep(r); if (!dry) { toast(`${r.added} entries added`, 'success'); onDone(); } } catch (e) { setErr(errText(e)); } };
  return (
    <Modal title="Import SNS" onClose={onClose} width={640} buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn" onClick={() => run(true)} disabled={!text.trim()}>Check</button><button className="btn btn-primary" onClick={() => run(false)} disabled={!rep || !!rep.errors.length || !rep.added}>Import</button></>}>
      <div className="v2-stack">
        <div className="v2-row"><select className="v2-select" style={{ width: 120 }} value={format} onChange={(e) => { setFormat(e.target.value as 'csv' | 'json'); setRep(null); }} aria-label="Format"><option value="csv">CSV</option><option value="json">JSON</option></select>
          <button className="btn" onClick={() => file.current?.click()}>Choose a file…</button>
          <input ref={file} type="file" hidden accept=".csv,.json,text/csv,application/json" onChange={async (e) => { const f = e.target.files?.[0]; if (f) { setText(await f.text()); setFormat(/\.json$/i.test(f.name) ? 'json' : 'csv'); setRep(null); } }} /></div>
        <textarea className="v2-input v2-mono" rows={8} value={text} placeholder={'system,subsystem,assembly,title\n21,,,Environmental control\n21,10,,Compression'} onChange={(e) => { setText(e.target.value); setRep(null); }} aria-label="SNS data" />
        {err ? <Alert tone="bad">{err}</Alert> : null}{rep ? <ReportView r={rep} /> : null}
      </div>
    </Modal>
  );
}
