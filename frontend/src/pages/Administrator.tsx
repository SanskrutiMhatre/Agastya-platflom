// The Administrator section: every section V1's Software Admin Panel had, each doing something real.
//
//   people & access   Roles (read-only: the code enforces them), Users, Groups, Directory sign-on, Security
//   S1000D            Code catalogue (per issue, with provenance), SNS presets
//   reference data    Country codes, Language codes, DM types, PM templates, RPC CAGEs,
//                     Originator CAGEs, Security classifications, PDF customisations,
//                     DDN, DDN metadata, Interface languages  -> one generic table editor
//   system            Audit logs, Maintenance, Backup, Visual settings, Settings, Licence
//
// The RPC and Originator CAGE lists are what DM import is checked against.
//
// UI redesign screen 6 (owner-approved mockup docs/audit/mockups/admin.html, made exact 2026-11-28): the page head with its two actions,
// the mockup's tab row, and under "Users and roles" the mockup's overview: three health tiles, then the users table and the newest audit
// entries on the left, the appearance defaults (with the two-theme contrast check) and the storage card on the right. The ~30 sections do
// not fit one tab row, so they are grouped into eight tabs in the mockup's tab style; a tab with several sections lists them as chips.

import { useEffect, useMemo, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { adminApi, backupApi, configApi, platformApi, workspaceApi, type AppSettings, type BackupStatus, type ConfigItem, type ConfigSpec, type SecurityPolicy, type User } from '../api';
import { Icon } from '../components/Icon';
import { Callout, ConfirmModal, Empty, Field, Loading, Modal, Pill, errText, fmtDate, useAsync } from '../components/ui';
import { AdmHead, HealthTile, Meter, SubNav, TabLinks, bytes, duration } from './adminParts';
import tokens from '../styles/tokens/tokens.json';
import '../styles/pages/admin.css';   // WP-35 second pass: the administrator screens' styles load with this chunk
import { useApp } from '../store/appSettings';
import { DEFAULT_ACCENT, deriveAccent } from '../lib/accent';
import { useUi } from '../store/ui';
import { Audit, RecentAudit, Users } from './Settings';
import { CatalogueSection, SnsPresetsSection, ExtensionsSection, CoverageSection } from './AdminS1000d';
import { PlatformBackups } from './PlatformBackups';
import { DirectorySection, GroupsSection } from './AccessAdmin';
import { GitlabSection } from './AdminGitlab';

const VERSION = typeof __AGASTYA_CLIENT_VERSION__ === 'string' ? __AGASTYA_CLIENT_VERSION__ : '';

const REFERENCE: Array<[string, string]> = [
  ['country-codes', 'Country codes'], ['language-codes', 'Language codes'], ['dm-types', 'DM types'],
  ['pm-templates', 'PM templates'], ['rpc-cages', 'RPC CAGEs'], ['originator-cages', 'Originator CAGEs'],
  ['security-classes', 'Security classifications'], ['pdf-customisations', 'PDF customisations'],
  ['ddn', 'Data dispatch notes'], ['ddn-metadata', 'DDN metadata'], ['languages', 'Interface languages'],
];
// Grouped by what they are for: everyone, S1000D only, JSS, JSG, and the system. Nothing S1000D-specific (business rules, information codes, SNS) appears
// under JSS or JSG. The names are the plain ones; the technical sections are set apart after the others.
const SHARED: Array<[string, string]> = [['language-codes', 'Language codes'], ['country-codes', 'Country codes'], ['security-classes', 'Security classifications'], ['languages', 'Interface languages'], ['pdf-customisations', 'PDF customisations']];
const S1000D_ITEMS: Array<[string, string]> = [['s1000d-catalogue', 'Information codes'], ['sns-presets', 'Numbering (SNS)'], ['dm-types', 'Data module types'], ['pm-templates', 'Publication templates'], ['rpc-cages', 'Responsible partner companies'], ['originator-cages', 'Originator companies'], ['ddn', 'Data dispatch notes'], ['ddn-metadata', 'DDN metadata']];
const S1000D_ADVANCED: Array<[string, string]> = [['extensions', 'Extension profiles'], ['coverage', 'Standards coverage']];
/** The tabs (the mockup's Users and roles / Appearance / System / Backup / Audit log, plus Access, Reference data and S1000D for the sections
 *  the mockup does not draw). The first section is where the tab goes. */
const TABS: Array<{ label: string; items: Array<[string, string]>; more?: Array<[string, string]> }> = [
  { label: 'Users and roles', items: [['users', 'Users'], ['roles', 'Roles']] },
  { label: 'Access', items: [['groups', 'Groups'], ['directory', 'Directory sign-on'], ['security', 'Security']] },
  { label: 'Appearance', items: [['visual-settings', 'Visual settings'], ['settings', 'Settings']] },
  { label: 'Reference data', items: [...SHARED, ['format-jss', 'JSS manual types'], ['format-jsg', 'JSG manual types']] },
  { label: 'S1000D', items: S1000D_ITEMS, more: S1000D_ADVANCED },
  { label: 'System', items: [['maintenance', 'Maintenance'], ['gitlab', 'GitLab'], ['licence', 'Licence']] },
  { label: 'Backup', items: [['backup', 'Platform backup']] },
  { label: 'Audit log', items: [['audit-logs', 'Audit logs']] },
];
const ENTERPRISE = new Set(['rpc-cages', 'originator-cages']);
const sectionOf = (pathname: string): string => pathname.replace(/^\/administrator\/?/, '').split('/')[0] || 'users';

/** JSS and JSG have no business rules, information codes or numbering to set up: this page only says which manual types exist and whether their stencil is built in yet. */
function FormatSection({ format }: { format: 'jss' | 'jsg' }) {
  const formats = useAsync(() => workspaceApi.formats(), []);
  const f = formats.data?.find((x) => x.id === format);
  if (!f) return <Loading />;
  return (
    <div className="stack adm-gap" data-testid={`format-${format}`}>
      <SectionHead title={`${f.label} manuals`} sub={`${f.description} There is nothing to configure here: the layout of each manual type comes from its stencil, which is built into the platform. People pick the domain and manual type when they create a project.`} />
      {f.domains.map((d) => (
        <section key={d.id} className="card" aria-label={d.label}>
          <div className="card-head"><h3><Icon name="book" />{d.label} <span className="count">{d.manualTypes.length}</span></h3></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Manual type</th><th className="adm-w-180">Stencil</th></tr></thead>
            <tbody>{d.manualTypes.map((m) => <tr key={m.id}><td>{m.label}</td><td>{f.ready && m.ready ? <Pill tone="success">Available</Pill> : <Pill tone="warning">Coming soon</Pill>}</td></tr>)}</tbody></table></div>
        </section>
      ))}
    </div>
  );
}

/** A section's own heading under the tabs: title, one line of purpose, actions on the right. */
export function SectionHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return (
    <div className="adm-sec-head">
      <div><h3>{title}</h3>{sub ? <p className="faint">{sub}</p> : null}</div>
      {actions ? <div className="row wrap">{actions}</div> : null}
    </div>
  );
}

type Figures = { health?: Awaited<ReturnType<typeof platformApi.health>>; backups?: BackupStatus; users?: User[] };
/** What the health tiles and the storage card read; each part this administrator may not read stays undefined (a dash, not an error). */
function useFigures() {
  const h = useAsync(() => Promise.allSettled([platformApi.health(), backupApi.status(), adminApi.users()]), []);
  const [health, backups, users] = h.data ?? [];
  return {
    health: health?.status === 'fulfilled' ? health.value : undefined,
    backups: backups?.status === 'fulfilled' ? backups.value : undefined,
    users: users?.status === 'fulfilled' ? users.value : undefined,
  } as Figures;
}

const clock = (iso: string): string => new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });

/** The health tiles of the mockup: Service (running, uptime, and whether the audit log records), Last backup (when, size, restore test,
 *  how many are kept) and Licence (none is needed: the accounts in use instead of seats). */
function HealthTiles({ f }: { f: Figures }) {
  const audit = f.health?.audit ?? undefined;
  const sys = f.health?.system ?? undefined;
  const b = f.backups;
  const u = f.users;
  const serviceTone = !f.health ? undefined : audit && audit.failures > 0 ? 'danger' : audit?.lastVerification?.ok === false ? 'warning' : 'success';
  const auditSays = !audit ? 'audit log recording' : audit.failures > 0 ? `${audit.failures} action${audit.failures === 1 ? '' : 's'} not recorded` : audit.lastVerification ? (audit.lastVerification.ok ? 'audit chain intact' : 'audit chain: problems found') : 'audit log recording';
  const latest = b?.latest;
  const when = !latest ? 'None yet' : latest.ageDays === 0 ? clock(latest.createdAt) : latest.ageDays === 1 ? 'Yesterday' : `${latest.ageDays} days ago`;
  const tested = b?.state.lastRestoreTest;
  const active = u ? u.filter((x) => !x.disabled).length : 0;
  return (
    <section className="hh" aria-label="Health" data-testid="admin-health">
      <HealthTile label="Service" tone={serviceTone} testId="health-audit" value={f.health ? 'Running' : '—'}
        line={f.health ? `${sys ? `Uptime ${duration(sys.uptimeSeconds)} · ` : ''}${auditSays}` : undefined} />
      <HealthTile label="Last backup" tone={!b ? undefined : !latest || b.stale || b.state.lastBackup?.ok === false ? 'warning' : 'success'} testId="health-backup"
        value={b ? when : '—'}
        line={b ? (latest ? `${bytes(latest.bytes)} · ${tested ? (tested.ok ? 'restore tested' : 'restore test failed') : 'not restore-tested yet'} · ${b.backups.length} kept` : `Every ${b.intervalHours} h · back up now under Backup`) : undefined} />
      <HealthTile label="Licence" tone={u ? 'success' : undefined} testId="health-people" value={u ? 'No expiry' : '—'}
        line={u ? `${active} of ${u.length} account${u.length === 1 ? '' : 's'} active · no seat limit` : undefined} />
    </section>
  );
}

/** The mockup's storage card: the disk that holds the data folder, and the platform backups against their retention slots. */
function StorageCard({ f }: { f: Figures }) {
  const disk = f.health?.system?.disk ?? null;
  const b = f.backups;
  const usedPct = disk ? Math.round(((disk.totalBytes - disk.freeBytes) / disk.totalBytes) * 100) : 0;
  const slots = b ? b.keep.daily + b.keep.weekly + b.keep.monthly : 0;
  const kept = b ? b.backups.reduce((n, x) => n + x.bytes, 0) : 0;
  const state = !disk ? null : usedPct >= 90 ? { tone: 'danger' as const, label: 'Nearly full' } : usedPct >= 80 ? { tone: 'warning' as const, label: 'Filling up' } : { tone: 'success' as const, label: 'Healthy' };
  return (
    <>
      <section className="card" aria-labelledby="st-h" data-testid="admin-storage">
        <div className="card-head"><h3 id="st-h"><Icon name="disk" />Storage</h3>{state ? <Pill tone={state.tone}>{state.label}</Pill> : null}</div>
        <ul className="disk">
          <li><span>Workspace disk</span><span className="faint">{disk ? `${bytes(disk.totalBytes - disk.freeBytes)} of ${bytes(disk.totalBytes)}` : '—'}</span>
            {disk ? <Meter value={disk.totalBytes - disk.freeBytes} max={disk.totalBytes} label="Workspace disk usage" /> : null}</li>
          <li><span>Backups</span><span className="faint">{b ? `${bytes(kept)} · ${b.backups.length} of ${slots} kept` : '—'}</span>
            {b && slots ? <Meter value={b.backups.length} max={slots} label="Backups kept of the retention slots" tone={b.stale ? 'warning' : 'success'} /> : null}</li>
        </ul>
      </section>
      {disk && usedPct >= 80
        ? <Callout tone="warning"><strong>The workspace disk is {usedPct} % full.</strong> Old scheduled backups are pruned by the retention; move older copies to another disk.</Callout>
        : b && (b.stale || !b.latest)
          ? <Callout tone="warning"><strong>{b.latest ? `The newest backup is ${b.latest.ageDays} days old.` : 'There is no platform backup yet.'}</strong> Back up now, and keep a copy on another disk.</Callout>
          : b ? <Callout tone="info"><strong>Backups run {b.intervalHours > 0 ? `every ${b.intervalHours} h` : 'on demand'}.</strong> {b.keep.daily} daily, {b.keep.weekly} weekly and {b.keep.monthly} monthly copies are kept.</Callout> : null}
    </>
  );
}

/** Users and roles: the mockup's overview (health, users, newest audit entries, appearance defaults, storage). */
function Overview({ createTick, startCreating }: { createTick: number; startCreating: boolean }) {
  const f = useFigures();
  return (
    <>
      <HealthTiles f={f} />
      <div className="adm-cols">
        <div className="stack adm-gap">
          <Users limit={6} createTick={createTick} startCreating={startCreating} inlineNew={false} rolesHref="/administrator/roles" />
          <RecentAudit rows={4} allHref="/administrator/audit-logs" />
        </div>
        <aside className="stack adm-gap" aria-label="Defaults and storage">
          <AppearanceCard />
          <StorageCard f={f} />
        </aside>
      </div>
    </>
  );
}

export function AdministratorPage() {
  const { pathname, state } = useLocation();
  const nav = useNavigate();
  const section = sectionOf(pathname);
  const tab = TABS.find((t) => [...t.items, ...(t.more ?? [])].some(([id]) => id === section)) ?? TABS[0];
  const [createTick, setCreateTick] = useState(0);
  const overview = section === 'users';
  return (
    <div className="v2-page adm">
      <AdmHead title="Administration" sub={`Users, defaults, backups and audit for this installation · on-premises${VERSION ? ` · v${VERSION}` : ''}`}
        actions={<>
          <a className="btn" href={platformApi.AUDIT_CSV} download><Icon name="download" />Audit log (CSV)</a>
          <button className="btn primary" onClick={() => { if (overview) setCreateTick((n) => n + 1); else nav('/administrator/users', { state: { newUser: true } }); }} data-testid="admin-new-user"><Icon name="plus" />New user</button>
        </>} />
      <TabLinks label="Administration" tabs={TABS.map((t) => ({ to: `/administrator/${t.items[0][0]}`, label: t.label, match: () => t === tab }))} />
      {!overview && t2(tab) ? <SubNav label="Administrator sections" items={tab.items.map(([id, l]) => [`/administrator/${id}`, l])} more={tab.more?.map(([id, l]) => [`/administrator/${id}`, l])} /> : null}
      <div className="adm-body">
        <Routes>
          <Route index element={<Navigate to="users" replace />} />
          <Route path="users" element={<Overview createTick={createTick} startCreating={!!(state as { newUser?: boolean } | null)?.newUser} />} />
          <Route path="roles" element={<RolesSection />} />
          <Route path="s1000d-catalogue" element={<CatalogueSection />} />
          <Route path="sns-presets" element={<SnsPresetsSection />} />
          <Route path="extensions" element={<ExtensionsSection />} />
          <Route path="format-jss" element={<FormatSection format="jss" />} />
          <Route path="format-jsg" element={<FormatSection format="jsg" />} />
          <Route path="coverage" element={<CoverageSection />} />
          <Route path="groups" element={<GroupsSection />} />
          <Route path="directory" element={<DirectorySection />} />
          {REFERENCE.map(([id]) => <Route key={id} path={id} element={<ConfigTable key={id} collection={id} />} />)}
          <Route path="sns-defaults" element={<Navigate to="../sns-presets" replace />} />   {/* the second SNS screen was removed (2026-11-26): Numbering (SNS) is the one */}
          <Route path="audit-logs" element={<AuditSection />} />
          <Route path="security" element={<SecuritySection />} />
          <Route path="maintenance" element={<MaintenanceSection />} />
          <Route path="backup" element={<BackupSection />} />
          <Route path="visual-settings" element={<VisualSection />} />
          <Route path="settings" element={<SettingsSection />} />
          <Route path="licence" element={<LicenceSection />} />
          <Route path="gitlab" element={<GitlabSection />} />
          <Route path="*" element={<Navigate to="users" replace />} />
        </Routes>
      </div>
    </div>
  );
}
/** A tab lists its sections as chips only when it has more than one. */
const t2 = (t: (typeof TABS)[number]): boolean => t.items.length + (t.more?.length ?? 0) > 1;

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
  if (data.error || !spec) return <Callout tone="danger">{data.error}</Callout>;
  return (
    <div className="stack adm-gap" data-testid={`config-${collection}`}>
      {ENTERPRISE.has(collection) && !data.data?.items.length ? <Callout tone="warning">No enterprises are registered, so imported data modules are <b>not checked</b> against this list. Register the enterprises to switch the check on.</Callout> : null}
      <section className="card" aria-labelledby={`cfg-${collection}-h`}>
        <div className="card-head">
          <div className="adm-card-title"><h3 id={`cfg-${collection}-h`}>{spec.title} <span className="count">{data.data?.items.length ?? 0}</span></h3><p className="faint">{spec.description}</p></div>
          <div className="row">
            <input className="input search adm-search" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} aria-label={`Filter ${spec.title}`} />
            <button className="btn primary" onClick={() => setEditing('new')} data-testid="config-add"><Icon name="plus" />Add {spec.noun}</button>
          </div>
        </div>
        {items.length === 0 ? <Empty title={q ? 'Nothing matches' : `No ${spec.title.toLowerCase()} yet`} /> : (
          <div className="table-wrap"><table className="table">
            <thead><tr>{spec.fields.map((f) => <th key={f.key} style={{ width: f.width }}>{f.label}</th>)}<th className="adm-w-actions"><span className="sr">Actions</span></th></tr></thead>
            <tbody>{items.map((it) => (
              <tr key={it.id} data-testid="config-row">
                {spec.fields.map((f) => <td key={f.key} className={f.mono ? 'mono' : ''}>{f.type === 'boolean' ? <Pill tone={it[f.key] ? 'success' : undefined}>{it[f.key] ? 'Yes' : 'No'}</Pill> : String(it[f.key] ?? '')}</td>)}
                <td className="adm-td-end">
                  <button className="icon-btn" aria-label={`Edit ${String(it[spec.fields[0].key])}`} title="Edit" onClick={() => setEditing(it)}><Icon name="edit" size={14} /></button>
                  <button className="icon-btn" aria-label={`Delete ${String(it[spec.fields[0].key])}`} title="Delete" onClick={() => setDel(it)}><Icon name="trash" size={14} /></button>
                </td>
              </tr>))}</tbody>
          </table></div>
        )}
        <div className="card-foot"><span className="faint">{items.length} of {data.data?.items.length ?? 0} shown</span></div>
      </section>
      {editing ? <ItemModal spec={spec} collection={collection} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); data.reload(); }} /> : null}
      {del ? (
        <ConfirmModal title={`Delete this ${spec.noun}?`} danger icon="trash" confirmLabel="Delete" onClose={() => setDel(null)}
          body={<p><strong>{String(del[spec.fields[0].key])}</strong> is removed from {spec.title}.</p>}
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
      buttons={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" disabled={busy} onClick={save} data-testid="config-save">Save</button></>}>
      <form className="stack adm-gap" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        {spec.fields.map((f) => f.type === 'boolean'
          ? <label key={f.key} className="check"><input type="checkbox" checked={!!form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.checked })} />{f.label}</label>
          : <Field key={f.key} label={f.label}><input className={`input ${f.mono ? 'mono' : ''}`} value={String(form[f.key] ?? '')} maxLength={300} autoFocus={f === spec.fields[0]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} /></Field>)}
        {err ? <Callout tone="danger">{err}</Callout> : null}
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}

// ── People ───────────────────────────────────────────────────────────────────

function RolesSection() {
  const r = useAsync(() => configApi.roles(), []);
  if (r.loading && !r.data) return <Loading />;
  if (!r.data) return <Callout tone="danger">{r.error}</Callout>;
  const card = (id: string, title: string, rows: Array<{ name: string; description: string }>) => (
    <section className="card" aria-labelledby={id}>
      <div className="card-head"><h3 id={id}><Icon name="shield" />{title} <span className="count">{rows.length}</span></h3></div>
      <div className="table-wrap"><table className="table"><thead><tr><th className="adm-w-200">Role</th><th>What it can do</th></tr></thead><tbody>{rows.map((x) => <tr key={x.name}><td><span className="nm">{x.name}</span></td><td className="adm-wrap">{x.description}</td></tr>)}</tbody></table></div>
    </section>
  );
  return (
    <div className="stack adm-gap" data-testid="roles">
      <SectionHead title="Roles" sub="The platform's roles are fixed by the code that enforces them, so they are shown here, not edited." />
      <div className="adm-grid-2 adm-start">
        {card('roles-platform-h', 'Platform roles', r.data.roles)}
        {card('roles-project-h', 'Roles inside a project', r.data.projectRoles)}
      </div>
      {r.data.capabilities?.length ? (
        <section className="card" data-testid="capabilities" aria-labelledby="caps-h">
          <div className="card-head"><div className="adm-card-title"><h3 id="caps-h"><Icon name="key" />Actions inside a project</h3><p className="faint">The lowest project role that may do each action. A project's managers can allow one action to a person or group below that role, or deny it (Project settings &gt; Access).</p></div></div>
          <div className="table-wrap"><table className="table"><thead><tr><th>Action</th><th>From role</th></tr></thead><tbody>{r.data.capabilities.map((c) => <tr key={c.capability}><td className="mono">{c.capability}</td><td><Pill>{c.minRole}</Pill></td></tr>)}</tbody></table></div>
        </section>
      ) : null}
    </div>
  );
}

function AuditSection() {
  return (
    <div className="stack adm-gap">
      <SectionHead title="Audit logs" sub="Who did what, newest first. Every row is chained and signed; Verify chain shows whether any was changed, removed or inserted."
        actions={<a className="btn" href={platformApi.AUDIT_CSV} download data-testid="audit-export"><Icon name="download" />Export all (CSV)</a>} />
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
  if (data.error) return <Callout tone="danger">{data.error}</Callout>;
  if (!form) return null;
  const audit = data.data?.[1].audit;
  const num = (k: 'idleMinutes' | 'absoluteHours' | 'passwordMinLength') => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: Number(e.target.value) });
  const save = async () => {
    setBusy(true); setErr('');
    try { setForm(await platformApi.saveSecurityPolicy(form)); toast('Saved', 'success'); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <div className="adm-cols" data-testid="security-policy">
      <section className="card" aria-labelledby="sec-h">
        <div className="card-head"><div className="adm-card-title"><h3 id="sec-h"><Icon name="shield" />Security</h3><p className="faint">How long people stay signed in, and who may approve a release.</p></div></div>
        <div className="card-body stack adm-gap">
          <div className="adm-grid-3">
            <Field label="Sign out after this many minutes without activity" hint="0 means no idle limit. Typing in an editor counts as activity."><input className="input" type="number" min={0} max={1440} value={form.idleMinutes} onChange={num('idleMinutes')} data-testid="sec-idle" /></Field>
            <Field label="Sign out this many hours after signing in" hint="Whatever happens; one working day is usual."><input className="input" type="number" min={1} max={720} value={form.absoluteHours} onChange={num('absoluteHours')} data-testid="sec-absolute" /></Field>
            <Field label="Shortest password a person may choose" hint="15 or more when there is no second sign-in factor. Existing passwords keep working."><input className="input" type="number" min={8} max={64} value={form.passwordMinLength} onChange={num('passwordMinLength')} data-testid="sec-pwmin" /></Field>
          </div>
          <div>
            <div className="toggle"><span><div className="t">One session per person</div><div className="d">Signing in on another computer signs the first one out (it is told why).</div></span>
              <input type="checkbox" className="switch" role="switch" checked={form.singleSession} onChange={(e) => setForm({ ...form, singleSession: e.target.checked })} aria-label="One session per person" data-testid="sec-single" /></div>
            <div className="toggle"><span><div className="t">Separation of duties</div><div className="d">The person who requests a release cannot approve it.</div></span>
              <input type="checkbox" className="switch" role="switch" checked={form.separationOfDuties} onChange={(e) => setForm({ ...form, separationOfDuties: e.target.checked })} aria-label="Separation of duties" data-testid="sec-sod" /></div>
          </div>
          {!form.separationOfDuties ? <Callout tone="warning">Self-approval is allowed. Use this only on a one-person installation; the change is recorded in the audit log.</Callout> : null}
          {err ? <Callout tone="danger">{err}</Callout> : null}
          <div className="row end"><button className="btn primary" disabled={busy} onClick={() => void save()} data-testid="sec-save">Save</button></div>
        </div>
      </section>
      <aside className="stack adm-gap" aria-label="Audit log state">
        {audit && audit.failures > 0 ? <Callout tone="danger" title="Not every action was recorded">The audit log could not record {audit.failures} action{audit.failures === 1 ? '' : 's'} since the server started (last: {audit.last?.action} at {audit.last?.at}: {audit.last?.error}). The details are in workspace\logs\audit-failures.log.</Callout> : null}
        {audit?.lastVerification
          ? <Callout tone={audit.lastVerification.ok ? 'success' : 'danger'} title="Audit chain"><span data-testid="sec-audit-verify">Audit chain, last checked {fmtDate(audit.lastVerification.at)}: {audit.lastVerification.summary}.</span>{audit.lastVerification.ok ? null : ' See Audit logs > Verify chain, and docs/OPERATIONS.md section 13.'}</Callout>
          : <Callout tone="info" title="Audit chain">Not checked since the server started. Audit log &gt; Verify chain checks every row.</Callout>}
      </aside>
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
  const cards: Array<{ id: string; icon: 'refresh' | 'xml' | 'trash' | 'pdf'; title: string; desc: string; btn: string; go: () => Promise<string> }> = [
    { id: 'reindex', icon: 'refresh', title: 'Re-index documents', desc: 'Rebuild the document index of every project, after files were copied in by hand.', btn: 'Re-index', go: async () => { const r = await platformApi.reindex(); return `Re-indexed ${r.projects} project${r.projects === 1 ? '' : 's'}`; } },
    { id: 'schemas', icon: 'xml', title: 'Check schemas', desc: 'Confirm the S1000D schema sets the editor offers are installed on the server.', btn: 'Check', go: async () => { const r = await platformApi.checkSchemas(); return r.missing.length ? `Missing schema sets: ${r.missing.join(', ')}` : `All schema sets installed (${r.installed.join(', ')})`; } },
    { id: 'previews', icon: 'trash', title: 'Clear preview files', desc: 'Delete the temporary single-module preview files projects accumulate.', btn: 'Clear', go: async () => { const r = await platformApi.clearPreviews(); return `Removed ${r.removed} file${r.removed === 1 ? '' : 's'}`; } },
    { id: 'rebuild', icon: 'pdf', title: 'Rebuild all PDFs', desc: 'Regenerate every project\'s PDF. It runs in the background; the audit log records the result.', btn: 'Rebuild', go: async () => { const r = await platformApi.rebuildPdfs(); return `Rebuilding ${r.queued} project${r.queued === 1 ? '' : 's'} in the background`; } },
  ];
  return (
    <div className="stack adm-gap" data-testid="maintenance">
      {asking ? <ConfirmModal title={`${asking.title}?`} icon="wrench" tone="warning" body={<p>{asking.ask}</p>} confirmLabel="Go ahead" onClose={() => setAsking(null)} onConfirm={() => { const a = asking; setAsking(null); void run(a.id, a.go); }} /> : null}
      <SectionHead title="Maintenance" sub="System maintenance tools. What changes data or starts a long job asks first." />
      <div className="adm-grid-2">
        {cards.map((c) => (
          <section key={c.id} className="card adm-tool" aria-labelledby={`maint-${c.id}-h`}>
            <div className="card-head"><h3 id={`maint-${c.id}-h`}><Icon name={c.icon} />{c.title}</h3></div>
            <div className="card-body stack adm-gap">
              <p className="faint">{c.desc}</p>
              {result[c.id] ? <p className="adm-xs" data-testid={`maint-${c.id}-result`}>{result[c.id]}</p> : null}
              <div className="row end"><button className="btn" disabled={!!busy} onClick={() => { if (ASK[c.id]) setAsking({ id: c.id, title: c.title, ask: ASK[c.id], go: c.go }); else void run(c.id, c.go); }} data-testid={`maint-${c.id}`}>{busy === c.id ? 'Working…' : c.btn}</button></div>
            </div>
          </section>
        ))}
        <section className="card adm-tool" aria-labelledby="maint-logs-h">
          <div className="card-head"><h3 id="maint-logs-h"><Icon name="log" />Download logs</h3></div>
          <div className="card-body stack adm-gap">
            <p className="faint">The audit log of everything done on the platform, as CSV.</p>
            <div className="row end"><a className="btn" href={platformApi.AUDIT_CSV} download><Icon name="download" />Download</a></div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** The mockup's Backup tab: the restorable platform backup (WP-12) and, apart from it, the project files export. */
function BackupSection() {
  return (
    <div className="stack adm-gap" data-testid="admin-backup">
      {/* WP-12 (PLT-001, ENT-006, ARC-005): the restorable platform backup; the project files export below is a convenience copy */}
      <PlatformBackups />
      <section className="card" aria-labelledby="export-h">
        <div className="card-head"><h3 id="export-h"><Icon name="archive" />Project files export</h3><a className="btn" href="/api/backup" download><Icon name="download" />Export project files</a></div>
        <div className="card-body stack adm-gap">
          <p className="faint">A ZIP of every project's files, the people and their memberships, and the last 5,000 events of the activity log, to read or hand on.</p>
          <p className="adm-xs faint">It is not a backup: it holds no passwords, settings, history or release records and cannot be restored. Use Platform backup above for that.</p>
        </div>
      </section>
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
    <section className="card narrow" data-testid="platform-settings" aria-labelledby="ps-h">
      <div className="card-head"><div className="adm-card-title"><h3 id="ps-h"><Icon name="settings" />Settings</h3><p className="faint">Shown to everyone once they are signed in.</p></div></div>
      <div className="card-body stack adm-gap">
        <Field label="Application name" hint="Appears at the top of the sidebar."><input className="input" maxLength={60} value={form.appName} onChange={(e) => setForm({ ...form, appName: e.target.value })} /></Field>
        <Field label="Organisation"><input className="input" maxLength={100} value={form.organisation} onChange={(e) => setForm({ ...form, organisation: e.target.value })} /></Field>
        {err ? <Callout tone="danger">{err}</Callout> : null}
        <div className="row end"><button className="btn primary" disabled={busy} onClick={() => void save({ appName: form.appName, organisation: form.organisation })} data-testid="settings-save">Save</button></div>
      </div>
    </section>
  );
}

/** The mockup's accent swatches: the design tokens' own accent and status fills (light theme value), so none is a colour literal. Blue is
 *  the default accent (stored as "", no override). A missing token is skipped. */
const PRIM = tokens.primitive as Record<string, string>;
const SEM = tokens.semantic as unknown as Record<string, [string, string]>;
const lightOf = (name: string): string | undefined => { const ref = SEM[name]?.[0]; return ref ? PRIM[ref.slice(1, -1)] : undefined; };
const SWATCHES: Array<[string, string]> = ([['Blue', ''], ['Teal', lightOf('info-solid')], ['Green', lightOf('success-solid')], ['Amber', lightOf('warning-solid')], ['Red', lightOf('danger-solid')]] as Array<[string, string | undefined]>)
  .filter((s): s is [string, string] => s[1] !== undefined);

/** Appearance defaults (the mockup card): the default theme for people who have not chosen one, the accent with its two-theme contrast
 *  check (saving waits while a check fails), compact layout, Reset and Save defaults. On the overview and under Appearance > Visual settings. */
function AppearanceCard() {
  const { form, setForm, save, busy, err } = useSettingsForm();
  const hex = form.accent || DEFAULT_ACCENT;
  const derived = deriveAccent(hex);
  const blocked = !!form.accent && !derived.ok;             // the server refuses it too (TH-003); saving waits for a readable colour
  const named = SWATCHES.find(([, h]) => h === (form.accent || ''))?.[0];
  return (
    <section className="card" aria-labelledby="ap-h" data-testid="appearance-defaults">
      <div className="card-head"><h3 id="ap-h"><Icon name="palette" />Appearance defaults</h3></div>
      <div className="card-body stack adm-gap-4">
        <Field label="Default theme for new users" hint="Each user can override this; the choice is stored per user.">
          <select className="select" value={form.theme === 'dark' ? 'dark' : 'light'} onChange={(e) => setForm({ ...form, theme: e.target.value as AppSettings['theme'] })}>
            <option value="light">Light</option><option value="dark">Dark</option></select>
        </Field>
        <div className="field">
          <span className="fl" id="acl">Accent colour</span>
          <div className="swatches" role="radiogroup" aria-labelledby="acl">
            {SWATCHES.map(([name, h]) => (
              <button key={name} type="button" className="sw" role="radio" aria-checked={(form.accent || '') === h} aria-label={name} title={name}
                style={{ background: h || DEFAULT_ACCENT }} onClick={() => setForm({ ...form, accent: h })} />
            ))}
            <label className={`sw sw-custom${named ? '' : ' on'}`} title="Another colour">
              <input type="color" value={hex} onChange={(e) => setForm({ ...form, accent: e.target.value })} aria-label="Accent colour" />
              <Icon name="plus" size={14} />
            </label>
          </div>
          <AccentCheck hex={hex} name={named ? named.toLowerCase() : form.accent} />
          <span className="hint">Saving is blocked when any check fails in either theme. The dark variant is derived and shown here.</span>
          {form.accent && derived.ok && derived.adjusted ? <span className="hint" data-testid="accent-adjusted">{hex} is adjusted so text on it stays readable (at least 4.5 : 1) in each theme.</span> : null}
        </div>
        <div>
          <div className="toggle"><span><div className="t">Compact layout</div><div className="d">Tighter spacing in lists and tables</div></span>
            <input type="checkbox" className="switch" role="switch" checked={form.compact} onChange={(e) => setForm({ ...form, compact: e.target.checked })} aria-label="Compact layout (tighter spacing)" /></div>
        </div>
        {err ? <Callout tone="danger">{err}</Callout> : null}
        <div className="row end">
          <button className="btn" onClick={() => setForm({ ...form, accent: '', theme: 'light', compact: false })}>Reset</button>
          <button className="btn primary" disabled={busy || blocked} title={blocked ? 'A check fails in one theme: choose another colour' : undefined} onClick={() => void save({ accent: form.accent, theme: form.theme === 'dark' ? 'dark' : 'light', compact: form.compact })} data-testid="visual-save">Save defaults</button>
        </div>
      </div>
    </section>
  );
}

function VisualSection() {
  return (
    <div className="adm-narrow-col" data-testid="visual-settings"><AppearanceCard /></div>
  );
}

/** TH-003: the mockup's two-theme contrast check of the accent, measured on the shade each theme will really use; the server refuses a
 *  colour that has no readable shade. */
function AccentCheck({ hex, name }: { hex: string; name: string }) {
  const d = deriveAccent(hex);
  if (!d.ok) return <Callout tone="danger">{d.reason}</Callout>;
  const cell = (ratio: number, min: number) => (
    <td className={`num ${ratio >= min ? 'pass' : 'fail'}`}>{ratio.toFixed(1)} <Icon name={ratio >= min ? 'ok' : 'alert'} size={14} /></td>
  );
  return (
    <table className="table contrast" aria-label="Contrast check" data-testid="accent-contrast">
      <thead><tr><th>Check ({name || 'default'} accent)</th><th className="num">Light</th><th className="num">Dark</th></tr></thead>
      <tbody data-testid="accent-preview">
        <tr><td>Button text on accent (4.5 : 1)</td>{cell(d.light.ratios.onAccent, 4.5)}{cell(d.dark.ratios.onAccent, 4.5)}</tr>
        <tr><td>Accent as text and edge (4.5 : 1)</td>{cell(d.light.ratios.worstSurface, 4.5)}{cell(d.dark.ratios.worstSurface, 4.5)}</tr>
      </tbody>
    </table>
  );
}

function LicenceSection() {
  const app = useApp((s) => s.settings);
  return (
    <section className="card narrow" data-testid="licence" aria-labelledby="lic-h">
      <div className="card-head"><div className="adm-card-title"><h3 id="lic-h"><Icon name="key" />Licence</h3><p className="faint">About this installation.</p></div><Pill tone="success">No expiry</Pill></div>
      <div className="table-wrap"><table className="table"><tbody>
        <tr><td className="faint adm-w-180">Product</td><td><span className="nm">{app.appName}</span> {VERSION || '2.0'}</td></tr>
        <tr><td className="faint">Organisation</td><td>{app.organisation || '—'}</td></tr>
        <tr><td className="faint">Deployment</td><td>Offline, on-premises</td></tr>
        <tr><td className="faint">Licence key</td><td>None required: this build does not enforce a licence.</td></tr>
      </tbody></table></div>
    </section>
  );
}
