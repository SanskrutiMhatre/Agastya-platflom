// The Administrator section: every section V1's Software Admin Panel had, each doing something real.
//
//   people & access   Roles (read-only: the code enforces them), Users
//   S1000D            Code catalogue (per issue, with provenance), SNS presets
//   reference data    Country codes, Language codes, DM types, PM templates, RPC CAGEs,
//                     Originator CAGEs, Security classifications, PDF customisations,
//                     DDN, DDN metadata, Interface languages  -> one generic table editor
//   system            Audit logs, Maintenance, Visual settings, Settings, Licence
//
// The RPC and Originator CAGE lists are what DM import is checked against.

import { useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { configApi, platformApi, workspaceApi, type AppSettings, type ConfigItem, type ConfigSpec, type SecurityPolicy } from '../api';
import { Icon } from '../components/Icon';
import { PageHeader } from '../components/PageHeader';
import { Alert, Badge, ConfirmModal, Empty, Field, Loading, Modal, errText, useAsync } from '../components/ui';
import { useApp } from '../store/appSettings';
import { DEFAULT_ACCENT, deriveAccent } from '../lib/accent';
import { useUi } from '../store/ui';
import { Audit, Users } from './Settings';
import { CatalogueSection, SnsPresetsSection, ExtensionsSection, CoverageSection } from './AdminS1000d';

const REFERENCE: Array<[string, string]> = [
  ['country-codes', 'Country codes'], ['language-codes', 'Language codes'], ['dm-types', 'DM types'],
  ['pm-templates', 'PM templates'], ['rpc-cages', 'RPC CAGEs'], ['originator-cages', 'Originator CAGEs'],
  ['security-classes', 'Security classifications'], ['pdf-customisations', 'PDF customisations'],
  ['ddn', 'Data dispatch notes'], ['ddn-metadata', 'DDN metadata'], ['languages', 'Interface languages'],
];
// Grouped by what they are for: everyone, S1000D only, JSS, JSG, and the system. Nothing S1000D-specific (business rules, information codes, SNS) appears
// under JSS or JSG. The names are the plain ones; the technical sections are folded under "Advanced".
const SHARED: Array<[string, string]> = [['language-codes', 'Language codes'], ['country-codes', 'Country codes'], ['security-classes', 'Security classifications'], ['languages', 'Interface languages'], ['pdf-customisations', 'PDF customisations']];
const S1000D_ITEMS: Array<[string, string]> = [['s1000d-catalogue', 'Information codes'], ['sns-presets', 'Numbering (SNS)'], ['dm-types', 'Data module types'], ['pm-templates', 'Publication templates'], ['rpc-cages', 'Responsible partner companies'], ['originator-cages', 'Originator companies'], ['ddn', 'Data dispatch notes'], ['ddn-metadata', 'DDN metadata']];
const S1000D_ADVANCED: Array<[string, string]> = [['extensions', 'Extension profiles'], ['coverage', 'Standards coverage']];
const GROUPS: Array<{ title: string; items: Array<[string, string]>; advanced?: Array<[string, string]> }> = [
  { title: 'People and access', items: [['roles', 'Roles'], ['users', 'Users']] },
  { title: 'All manual types', items: SHARED },
  { title: 'S1000D', items: S1000D_ITEMS, advanced: S1000D_ADVANCED },
  { title: 'JSS', items: [['format-jss', 'Manual types and stencils']] },
  { title: 'JSG', items: [['format-jsg', 'Manual types and stencils']] },
  { title: 'System', items: [['audit-logs', 'Audit logs'], ['security', 'Security'], ['maintenance', 'Maintenance'], ['visual-settings', 'Visual settings'], ['settings', 'Settings'], ['licence', 'Licence']] },
];
const ENTERPRISE = new Set(['rpc-cages', 'originator-cages']);

/** JSS and JSG have no business rules, information codes or numbering to set up: this page only says which manual types exist and whether their stencil is built in yet. */
function FormatSection({ format }: { format: 'jss' | 'jsg' }) {
  const formats = useAsync(() => workspaceApi.formats(), []);
  const f = formats.data?.find((x) => x.id === format);
  if (!f) return <Loading />;
  return (
    <div className="v2-stack" data-testid={`format-${format}`}>
      <div><h3 style={{ margin: 0 }}>{f.label} manuals</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>{f.description} There is nothing to configure here: the layout of each manual type comes from its stencil, which is built into the platform. People pick the domain and manual type when they create a project.</p></div>
      {f.domains.map((d) => (
        <div key={d.id} className="v2-card v2-card-pad">
          <h4 style={{ marginTop: 0 }}>{d.label}</h4>
          <table className="v2-table"><tbody>{d.manualTypes.map((m) => <tr key={m.id}><td>{m.label}</td><td style={{ width: 180 }}>{f.ready && m.ready ? <Badge tone="ok">Available</Badge> : <Badge tone="warn">Coming soon</Badge>}</td></tr>)}</tbody></table>
        </div>
      ))}
    </div>
  );
}

export function AdministratorPage() {
  return (
    <div className="v2-page">
      <PageHeader icon="shield" title="Administrator" sub="People, reference data and the system itself." />
      <div className="v2-admin">
        <nav className="v2-admin-nav" aria-label="Administrator sections">
          {GROUPS.map((g) => (
            <div key={g.title}>
              <div className="v2-admin-group">{g.title}</div>
              {g.items.map(([to, label]) => <NavLink key={to} to={`/administrator/${to}`} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>)}
              {g.advanced ? <details><summary className="v2-hint" style={{ cursor: 'pointer', padding: '4px 12px' }}>Advanced</summary>
                {g.advanced.map(([to, label]) => <NavLink key={to} to={`/administrator/${to}`} className={({ isActive }) => (isActive ? 'active' : '')}>{label}</NavLink>)}</details> : null}
            </div>
          ))}
        </nav>
        <div className="v2-admin-body">
          <Routes>
            <Route index element={<Navigate to="users" replace />} />
            <Route path="roles" element={<RolesSection />} />
            <Route path="s1000d-catalogue" element={<CatalogueSection />} />
            <Route path="sns-presets" element={<SnsPresetsSection />} />
            <Route path="extensions" element={<ExtensionsSection />} />
            <Route path="format-jss" element={<FormatSection format="jss" />} />
            <Route path="format-jsg" element={<FormatSection format="jsg" />} />
            <Route path="coverage" element={<CoverageSection />} />
            <Route path="users" element={<Users />} />
            {REFERENCE.map(([id]) => <Route key={id} path={id} element={<ConfigTable key={id} collection={id} />} />)}
            <Route path="sns-defaults" element={<Navigate to="../sns-presets" replace />} />   {/* the second SNS screen was removed (2026-11-26): Numbering (SNS) is the one */}
            <Route path="audit-logs" element={<AuditSection />} />
            <Route path="security" element={<SecuritySection />} />
            <Route path="maintenance" element={<MaintenanceSection />} />
            <Route path="visual-settings" element={<VisualSection />} />
            <Route path="settings" element={<SettingsSection />} />
            <Route path="licence" element={<LicenceSection />} />
            <Route path="*" element={<Navigate to="users" replace />} />
          </Routes>
        </div>
      </div>
    </div>
  );
}

// ── Reference data: one editor for every table ──────────────────────────────

function ConfigTable({ collection }: { collection: string }) {
  const toast = useUi((s) => s.toast);
  const data = useAsync(() => configApi.list(collection), [collection]);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<ConfigItem | 'new' | null>(null);
  const [del, setDel] = useState<ConfigItem | null>(null);
  const spec = data.data?.spec;
  const items = useMemo(() => (data.data?.items ?? []).filter((i) => !q || JSON.stringify(i).toLowerCase().includes(q.toLowerCase())), [data.data, q]);

  if (data.loading && !data.data) return <Loading />;
  if (data.error || !spec) return <Alert tone="bad">{data.error}</Alert>;
  return (
    <div className="v2-stack" data-testid={`config-${collection}`}>
      <div className="v2-row v2-spread">
        <div><h3 style={{ margin: 0 }}>{spec.title}</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>{spec.description}</p></div>
        <button className="btn btn-primary" onClick={() => setEditing('new')} data-testid="config-add"><Icon name="plus" />Add {spec.noun}</button>
      </div>
      {ENTERPRISE.has(collection) && !data.data?.items.length ? <Alert tone="warn">No enterprises are registered, so imported data modules are <b>not checked</b> against this list. Register the enterprises to switch the check on.</Alert> : null}
      <div className="v2-row"><input className="v2-input" style={{ maxWidth: 280 }} placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Filter ${spec.title}`} /></div>
      <div className="v2-card">
        {items.length === 0 ? <Empty title={q ? 'Nothing matches' : `No ${spec.title.toLowerCase()} yet`} /> : (
          <div className="v2-scroll-x"><table className="v2-table">
            <thead><tr>{spec.fields.map((f) => <th key={f.key} style={{ width: f.width }}>{f.label}</th>)}<th /></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.id} data-testid="config-row">
                {spec.fields.map((f) => <td key={f.key} className={f.mono ? 'v2-mono' : ''}>{f.type === 'boolean' ? <Badge tone={it[f.key] ? 'ok' : undefined}>{it[f.key] ? 'Yes' : 'No'}</Badge> : String(it[f.key] ?? '')}</td>)}
                <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <button className="icon-btn" aria-label={`Edit ${String(it[spec.fields[0].key])}`} title="Edit" onClick={() => setEditing(it)}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" aria-label={`Delete ${String(it[spec.fields[0].key])}`} title="Delete" onClick={() => setDel(it)}><Icon name="trash" size={14} /></button>
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
      </div>
      {editing ? <ItemModal spec={spec} collection={collection} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} /> : null}
      {del ? (
        <ConfirmModal title={`Delete this ${spec.noun}?`} danger confirmLabel="Delete" onClose={() => setDel(null)}
          body={<p style={{ marginTop: 0 }}><strong>{String(del[spec.fields[0].key])}</strong> is removed from {spec.title}.</p>}
          onConfirm={async () => { const d = del; setDel(null); try { await configApi.remove(collection, d.id); toast('Deleted', 'success'); data.reload(); } catch (e) { toast(errText(e), 'error'); } }} />
      ) : null}
    </div>
  );
}

function ItemModal({ spec, collection, item, onClose, onSaved }: { spec: ConfigSpec; collection: string; item: ConfigItem | null; onClose: () => void; onSaved: () => void }) {
  const toast = useUi((s) => s.toast);
  const [form, setForm] = useState<Record<string, unknown>>(() => Object.fromEntries(spec.fields.map((f) => [f.key, item?.[f.key] ?? (f.type === 'boolean' ? false : '')])));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const save = async () => {
    setBusy(true); setErr('');
    try { if (item) await configApi.update(collection, item.id, form); else await configApi.create(collection, form); toast('Saved', 'success'); onSaved(); }
    catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={item ? `Edit ${spec.noun}` : `Add ${spec.noun}`} onClose={onClose} width={480}
      buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save} data-testid="config-save">Save</button></>}>
      <form className="v2-stack" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {spec.fields.map((f) => f.type === 'boolean'
          ? <label key={f.key} className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />{f.label}</label>
          : <Field key={f.key} label={f.label}><input className={`v2-input ${f.mono ? 'v2-mono' : ''}`} value={String(form[f.key] ?? '')} maxLength={300} autoFocus={f === spec.fields[0]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /></Field>)}
        {err ? <Alert tone="bad">{err}</Alert> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

function RolesSection() {
  const r = useAsync(() => configApi.roles(), []);
  if (r.loading && !r.data) return <Loading />;
  if (!r.data) return <Alert tone="bad">{r.error}</Alert>;
  const table = (rows: Array<{ name: string; description: string }>) => (
    <div className="v2-card"><table className="v2-table"><thead><tr><th style={{ width: 200 }}>Role</th><th>What it can do</th></tr></thead><tbody>{rows.map((x) => <tr key={x.name}><td><b>{x.name}</b></td><td>{x.description}</td></tr>)}</tbody></table></div>
  );
  return (
    <div className="v2-stack" data-testid="roles">
      <div><h3 style={{ margin: 0 }}>Roles</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>The platform's roles are fixed by the code that enforces them, so they are shown here, not edited.</p></div>
      <h4 style={{ margin: 0 }}>Platform roles</h4>{table(r.data.roles)}
      <h4 style={{ margin: 0 }}>Roles inside a project</h4>{table(r.data.projectRoles)}
    </div>
  );
}

function AuditSection() {
  return (
    <div className="v2-stack">
      <div className="v2-row v2-spread">
        <div><h3 style={{ margin: 0 }}>Audit logs</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>Who did what, newest first.</p></div>
        <a className="btn" href={platformApi.AUDIT_CSV} download data-testid="audit-export"><Icon name="download" />Export CSV</a>
      </div>
      <Audit />
    </div>
  );
}

// ── System ───────────────────────────────────────────────────────────────────

/** Account and session rules (WP-03). The separation-of-duties switch is the documented override for a one-person installation (D7). */
function SecuritySection() {
  const toast = useUi((s) => s.toast);
  const data = useAsync(() => Promise.all([platformApi.securityPolicy(), platformApi.health()]), []);
  const [form, setForm] = useState<SecurityPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { if (data.data) setForm(data.data[0].policy); }, [data.data]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <Alert tone="bad">{data.error}</Alert>;
  if (!form) return null;
  const audit = data.data?.[1].audit;
  const num = (k: 'idleMinutes' | 'absoluteHours' | 'passwordMinLength') => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });
  const save = async () => {
    setBusy(true); setErr('');
    try { setForm(await platformApi.saveSecurityPolicy(form)); toast('Saved', 'success'); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="v2-stack" style={{ maxWidth: 560 }} data-testid="security-policy">
      <div><h3 style={{ margin: 0 }}>Security</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>How long people stay signed in, and who may approve a release.</p></div>
      {audit && audit.failures > 0 ? <Alert tone="bad">The audit log could not record {audit.failures} action{audit.failures === 1 ? '' : 's'} since the server started (last: {audit.last?.action} at {audit.last?.at}: {audit.last?.error}). The details are in workspace\logs\audit-failures.log.</Alert> : null}
      <Field label="Sign out after this many minutes without activity" hint="0 means no idle limit. Typing in an editor counts as activity."><input className="v2-input" type="number" min={0} max={1440} value={form.idleMinutes} onChange={num('idleMinutes')} data-testid="sec-idle" /></Field>
      <Field label="Sign out this many hours after signing in" hint="Whatever happens; one working day is usual."><input className="v2-input" type="number" min={1} max={720} value={form.absoluteHours} onChange={num('absoluteHours')} data-testid="sec-absolute" /></Field>
      <Field label="Shortest password a person may choose" hint="15 or more when there is no second sign-in factor. Existing passwords keep working."><input className="v2-input" type="number" min={8} max={64} value={form.passwordMinLength} onChange={num('passwordMinLength')} data-testid="sec-pwmin" /></Field>
      <label className="v2-row" style={{ gap: 8 }}><input type="checkbox" checked={form.singleSession} onChange={(e) => setForm({ ...form, singleSession: e.target.checked })} data-testid="sec-single" />One session per person: signing in on another computer signs the first one out (it is told why).</label>
      <label className="v2-row" style={{ gap: 8 }}><input type="checkbox" checked={form.separationOfDuties} onChange={(e) => setForm({ ...form, separationOfDuties: e.target.checked })} data-testid="sec-sod" />Separation of duties: the person who requests a release cannot approve it.</label>
      {!form.separationOfDuties ? <Alert tone="warn">Self-approval is allowed. Use this only on a one-person installation; the change is recorded in the audit log.</Alert> : null}
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <div><button className="btn btn-primary" disabled={busy} onClick={() => void save()} data-testid="sec-save">Save</button></div>
    </div>
  );
}

function MaintenanceSection() {
  const toast = useUi((s) => s.toast);
  const [busy, setBusy] = useState('');
  const [result, setResult] = useState<Record<string, string>>({});
  const run = async (id: string, fn: () => Promise<string>) => {
    setBusy(id);
    try { const msg = await fn(); setResult((r) => ({ ...r, [id]: msg })); toast(msg, 'success'); } catch (e) { toast(errText(e), 'error'); } finally { setBusy(''); }
  };
  // FE-012: what changes data or starts a long job asks first; a read-only check runs at once
  const [asking, setAsking] = useState<{ id: string; title: string; ask: string; go: () => Promise<string> } | null>(null);
  const ASK: Record<string, string> = {
    reindex: "Every project's document index is rebuilt from its files. People can keep working; lists may be incomplete for a moment.",
    previews: 'The temporary single-module preview files of every project are deleted. They are made again when someone previews.',
    rebuild: "Every project's PDF is generated again in the background. This can take a long time and keeps the server busy.",
  };
  const cards: Array<{ id: string; title: string; desc: string; btn: string; go: () => Promise<string> }> = [
    { id: 'reindex', title: 'Re-index documents', desc: 'Rebuild the document index of every project, after files were copied in by hand.', btn: 'Re-index', go: async () => { const r = await platformApi.reindex(); return `Re-indexed ${r.projects} project${r.projects === 1 ? '' : 's'}`; } },
    { id: 'schemas', title: 'Check schemas', desc: 'Confirm the S1000D schema sets the editor offers are installed on the server.', btn: 'Check', go: async () => { const r = await platformApi.checkSchemas(); return r.missing.length ? `Missing schema sets: ${r.missing.join(', ')}` : `All schema sets installed (${r.installed.join(', ')})`; } },
    { id: 'previews', title: 'Clear preview files', desc: 'Delete the temporary single-module preview files projects accumulate.', btn: 'Clear', go: async () => { const r = await platformApi.clearPreviews(); return `Removed ${r.removed} file${r.removed === 1 ? '' : 's'}`; } },
    { id: 'rebuild', title: 'Rebuild all PDFs', desc: 'Regenerate every project\'s PDF. It runs in the background; the audit log records the result.', btn: 'Rebuild', go: async () => { const r = await platformApi.rebuildPdfs(); return `Rebuilding ${r.queued} project${r.queued === 1 ? '' : 's'} in the background`; } },
  ];
  return (
    <div className="v2-stack" data-testid="maintenance">
      {asking ? <ConfirmModal title={`${asking.title}?`} body={<p>{asking.ask}</p>} confirmLabel="Go ahead" onClose={() => setAsking(null)} onConfirm={() => { const a = asking; setAsking(null); void run(a.id, a.go); }} /> : null}
      <div><h3 style={{ margin: 0 }}>Maintenance</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>System maintenance tools.</p></div>
      <div className="v2-grid cols-2">
        {cards.map((c) => (
          <div key={c.id} className="v2-card v2-card-pad">
            <h4 style={{ marginTop: 0 }}>{c.title}</h4>
            <p className="v2-sub">{c.desc}</p>
            <button className="btn btn-primary" disabled={!!busy} onClick={() => { if (ASK[c.id]) setAsking({ id: c.id, title: c.title, ask: ASK[c.id], go: c.go }); else void run(c.id, c.go); }} data-testid={`maint-${c.id}`}>{busy === c.id ? 'Working…' : c.btn}</button>
            {result[c.id] ? <p className="v2-hint" style={{ marginBottom: 0 }} data-testid={`maint-${c.id}-result`}>{result[c.id]}</p> : null}
          </div>
        ))}
        <div className="v2-card v2-card-pad">
          {/* WP-07 (FE-013): named for what it holds; a database backup with restore is WP-12 */}
          <h4 style={{ marginTop: 0 }}>Project data export</h4>
          <p className="v2-sub">A ZIP of every project, the people and their memberships, and the last 5,000 events of the activity log.</p>
          <p className="v2-hint">It is not a database backup: it holds no passwords, settings or release records, and it cannot be restored from here. For a complete backup, copy the data folder of the stopped server (administrator guide, section 7).</p>
          <a className="btn btn-primary" href="/api/backup" download>Export project data</a>
        </div>
        <div className="v2-card v2-card-pad">
          <h4 style={{ marginTop: 0 }}>Download logs</h4>
          <p className="v2-sub">The audit log of everything done on the platform, as CSV.</p>
          <a className="btn btn-primary" href={platformApi.AUDIT_CSV} download>Download</a>
        </div>
      </div>
    </div>
  );
}

function useSettingsForm() {
  const app = useApp((s) => s.settings);
  const set = useApp((s) => s.set);
  const toast = useUi((s) => s.toast);
  const [form, setForm] = useState<AppSettings>(app);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  useEffect(() => { setForm(app); }, [app]);
  const save = async (patch: Partial<AppSettings>) => {
    setBusy(true); setErr('');
    try { set(await platformApi.saveSettings(patch)); toast('Saved', 'success'); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return { form, setForm, save, busy, err };
}

function SettingsSection() {
  const { form, setForm, save, busy, err } = useSettingsForm();
  return (
    <div className="v2-stack" style={{ maxWidth: 520 }} data-testid="platform-settings">
      <div><h3 style={{ margin: 0 }}>Settings</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>Shown to everyone once they are signed in.</p></div>
      <Field label="Application name" hint="Appears at the top of the sidebar."><input className="v2-input" maxLength={60} value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} /></Field>
      <Field label="Organisation"><input className="v2-input" maxLength={100} value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} /></Field>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <div><button className="btn btn-primary" disabled={busy} onClick={() => void save({ appName: form.appName, organisation: form.organisation })} data-testid="settings-save">Save</button></div>
    </div>
  );
}

function VisualSection() {
  const { form, setForm, save, busy, err } = useSettingsForm();
  return (
    <div className="v2-stack" style={{ maxWidth: 520 }} data-testid="visual-settings">
      <div><h3 style={{ margin: 0 }}>Visual settings</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>How the application looks for everyone.</p></div>
      <Field label="Accent colour" hint="Buttons, links and highlights. Clear it to use the default."><div className="v2-row">
        <input type="color" value={form.accent || DEFAULT_ACCENT} onChange={(e) => setForm({ ...form, accent: e.target.value })} aria-label="Accent colour" style={{ width: 44, height: 32 }} />
        <span className="v2-mono">{form.accent || 'default'}</span>{form.accent ? <button className="btn btn-sm" onClick={() => setForm({ ...form, accent: '' })}>Use default</button> : null}
      </div></Field>
      {form.accent ? <AccentPreview hex={form.accent} /> : null}
      <Field label="Default theme" hint="Used until a person picks their own with the theme button."><select className="v2-select" value={form.theme} onChange={(e) => setForm({ ...form, theme: e.target.value as AppSettings['theme'] })}>
        <option value="system">Follow the device</option><option value="light">Light</option><option value="dark">Dark</option></select></Field>
      <label className="v2-row" style={{ gap: 6 }}><input type="checkbox" checked={form.compact} onChange={(e) => setForm({ ...form, compact: e.target.checked })} />Compact layout (tighter spacing)</label>
      {err ? <Alert tone="bad">{err}</Alert> : null}
      <div><button className="btn btn-primary" disabled={busy} onClick={() => void save({ accent: form.accent, theme: form.theme, compact: form.compact })} data-testid="visual-save">Save</button></div>
    </div>
  );
}

/** TH-003: what the accent becomes in each theme, with the measured contrast; the server refuses a colour that has no readable shade. */
function AccentPreview({ hex }: { hex: string }) {
  const d = deriveAccent(hex);
  if (!d.ok) return <Alert tone="bad">{d.reason}</Alert>;
  const swatch = (theme: 'light' | 'dark') => {
    const v = d[theme];
    return (
      <div className="v2-accent-prev" data-theme-preview={theme} key={theme}>
        <span className="v2-hint">{theme === 'light' ? 'Light theme' : 'Dark theme'}</span>
        <span className="v2-accent-btn" style={{ background: v.accent, color: v.onAccent }}>Primary button</span>
        <span className="v2-mono">{v.accent} · text {v.ratios.onAccent}:1 · on surfaces {v.ratios.worstSurface}:1</span>
      </div>
    );
  };
  return (
    <div className="v2-stack" data-testid="accent-preview" style={{ gap: 6 }}>
      <div className="v2-row wrap">{swatch('light')}{swatch('dark')}</div>
      {d.adjusted ? <span className="v2-hint" data-testid="accent-adjusted">{hex} is adjusted so text on it stays readable (at least 4.5:1) in each theme.</span> : null}
    </div>
  );
}

function LicenceSection() {
  const app = useApp((s) => s.settings);
  return (
    <div className="v2-stack" style={{ maxWidth: 560 }} data-testid="licence">
      <div><h3 style={{ margin: 0 }}>Licence</h3><p className="v2-sub" style={{ margin: '2px 0 0' }}>About this installation.</p></div>
      <div className="v2-card v2-card-pad">
        <table className="v2-table"><tbody>
          <tr><td>Product</td><td><b>{app.appName}</b> 2.0</td></tr>
          <tr><td>Organisation</td><td>{app.organisation || '—'}</td></tr>
          <tr><td>Deployment</td><td>Offline, on-premises</td></tr>
          <tr><td>Licence key</td><td>None required: this build does not enforce a licence.</td></tr>
        </tbody></table>
      </div>
    </div>
  );
}
