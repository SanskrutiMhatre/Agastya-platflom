// Phase 3 (P3-5): Administration > System > GitLab. The intranet GitLab instance: its address, the internal CA certificate (used only for
// the GitLab requests, never installed on the machine), the OAuth application (with the redirect URI to copy into it), personal access tokens
// as a fallback, an optional service token, timeouts. "Test connection" runs the checks; Save runs them again and saves only when they pass.
// Secrets are typed once and never shown again (the server keeps them encrypted and never sends them back).
import { useEffect, useState } from 'react';
import { gitlabAdminApi, type GitlabAdminView, type GitlabConfigInput, type GitlabTestReport } from '../api/gitlab';
import { Icon } from '../components/Icon';
import { Callout, ConfirmModal, Field, Loading, Pill, errText, fmtDate, useAsync } from '../components/ui';
import { useUi } from '../store/ui';

/** The administrator pages' section heading (the same markup as Administrator's SectionHead; kept here so the two files do not import each other). */
function SectionHead({ title, sub, actions }: { title: string; sub?: string; actions?: React.ReactNode }) {
  return <div className="adm-sec-head"><div><h3>{title}</h3>{sub ? <p className="faint">{sub}</p> : null}</div>{actions ? <div className="row wrap">{actions}</div> : null}</div>;
}

interface Form { baseUrl: string; appUrl: string; caPem: string | null; caName: string; oauthAppId: string; clientSecret: string; clearClientSecret: boolean; allowPat: boolean;
  serviceToken: string; clearServiceToken: boolean; timeoutSec: number; retries: number; testToken: string }
const formOf = (v: GitlabAdminView): Form => ({
  baseUrl: v.config.baseUrl, appUrl: v.config.appUrl, caPem: v.config.caPem, caName: v.config.caPem ? 'Saved certificate' : '', oauthAppId: v.config.oauthAppId ?? '',
  clientSecret: '', clearClientSecret: false, allowPat: v.config.allowPat, serviceToken: '', clearServiceToken: false,
  timeoutSec: Math.round(v.config.timeoutMs / 1000), retries: v.config.retries, testToken: '',
});
const inputOf = (f: Form): GitlabConfigInput => ({
  baseUrl: f.baseUrl.trim(), appUrl: f.appUrl.trim(), caPem: f.caPem, oauthAppId: f.oauthAppId.trim() || null, clientSecret: f.clientSecret.trim() || undefined, clearClientSecret: f.clearClientSecret,
  allowPat: f.allowPat, serviceToken: f.serviceToken.trim() || undefined, clearServiceToken: f.clearServiceToken, timeoutMs: f.timeoutSec * 1000, retries: f.retries, testToken: f.testToken.trim() || undefined,
});

function Report({ r }: { r: GitlabTestReport }) {
  return (
    <div className="stack adm-gap" data-testid="gitlab-report">
      <Callout tone={r.ok ? 'success' : 'danger'} title={r.ok ? 'The connection works' : 'The connection does not work yet'}>{r.ok ? `GitLab ${r.version ?? ''} answered in ${r.ms} ms.` : 'Fix the checks marked below, then test again. Nothing was saved.'}</Callout>
      <div className="table-wrap"><table className="table"><thead><tr><th className="adm-w-180">Check</th><th className="adm-w-180">Result</th><th>Detail</th></tr></thead>
        <tbody>{r.checks.map((c) => (
          <tr key={c.id} data-testid={`gitlab-check-${c.id}`}>
            <td>{c.label}{c.required ? null : <span className="faint"> (optional)</span>}</td>
            <td>{c.ok === true ? <Pill tone="success" icon="ok">Passed</Pill> : c.ok === false ? <Pill tone={c.required ? 'danger' : 'warning'} icon="alert">Failed</Pill> : <Pill>Skipped</Pill>}</td>
            <td className="adm-xs">{c.detail}</td>
          </tr>
        ))}</tbody></table></div>
    </div>
  );
}

function Accounts({ count, onChange }: { count: number; onChange: () => void }) {
  const toast = useUi((s) => s.toast);
  const list = useAsync(() => gitlabAdminApi.accounts(), [count]);
  const [revoking, setRevoking] = useState<{ userId: string; name: string } | null>(null);
  const revoke = async (userId: string) => {
    try { const r = await gitlabAdminApi.revoke(userId); toast(r.revokedAtGitlab ? 'Disconnected, and the token was revoked in GitLab' : 'Disconnected', 'success'); list.reload(); onChange(); } catch (e) { toast(errText(e), 'error'); }
  };
  return (
    <section className="card" aria-labelledby="gl-acc-h" data-testid="gitlab-accounts">
      {revoking ? <ConfirmModal title={`Disconnect ${revoking.name}?`} icon="unlock" tone="warning" body={<p>The stored GitLab token of {revoking.name} is deleted (an OAuth token is also revoked in GitLab). They can connect again from their account page.</p>}
        confirmLabel="Disconnect" onClose={() => setRevoking(null)} onConfirm={() => { const r = revoking; setRevoking(null); void revoke(r.userId); }} /> : null}
      <div className="card-head"><h3 id="gl-acc-h"><Icon name="users" />Connected people <span className="count">{list.data?.length ?? 0}</span></h3></div>
      {list.data && list.data.length ? (
        <div className="table-wrap"><table className="table"><thead><tr><th>Person</th><th>GitLab account</th><th className="adm-w-180">How</th><th className="adm-w-180">Connected</th><th className="v2-td-end" /></tr></thead>
          <tbody>{list.data.map((a) => (
            <tr key={a.userId} data-testid={`gitlab-account-${a.user ?? a.userId}`}>
              <td>{a.fullName ?? a.user}</td><td className="mono">{a.username}</td><td>{a.method === 'oauth' ? 'OAuth' : 'Personal access token'}</td><td>{fmtDate(a.connectedAt)}</td>
              <td className="v2-td-end"><button className="btn sm" onClick={() => setRevoking({ userId: a.userId, name: a.fullName ?? a.user ?? a.username })} data-testid="gitlab-revoke">Disconnect</button></td>
            </tr>
          ))}</tbody></table></div>
      ) : <div className="card-body"><p className="faint">Nobody has connected a GitLab account yet. People connect from their account page (top right, Account).</p></div>}
    </section>
  );
}

export function GitlabSection() {
  const toast = useUi((s) => s.toast);
  const data = useAsync(() => gitlabAdminApi.get(), []);
  const [f, setF] = useState<Form | null>(null);
  const [report, setReport] = useState<GitlabTestReport | null>(null);
  const [busy, setBusy] = useState<'' | 'test' | 'save' | 'remove'>('');
  const [err, setErr] = useState('');
  const [removing, setRemoving] = useState(false);
  useEffect(() => { if (data.data) setF(formOf(data.data)); }, [data.data]);
  if (data.loading && !data.data) return <Loading />;
  if (data.error) return <Callout tone="danger">{data.error}</Callout>;
  if (!f || !data.data) return null;
  const v = data.data;
  const set = (p: Partial<Form>) => { setF({ ...f, ...p }); setReport(null); };
  const run = async (what: 'test' | 'save') => {
    setBusy(what); setErr('');
    try {
      if (what === 'test') setReport(await gitlabAdminApi.test(inputOf(f)));
      else { const r = await gitlabAdminApi.save(inputOf(f)); setReport(r.report); data.set(r.settings); toast('GitLab is set up', 'success'); }
    } catch (e) {
      const body = (e as { body?: { report?: GitlabTestReport } }).body;
      if (body?.report) setReport(body.report);
      setErr(errText(e));
    } finally { setBusy(''); }
  };
  const remove = async () => {
    setBusy('remove'); setErr('');
    try { const r = await gitlabAdminApi.remove(); toast(`GitLab is switched off${r.accountsRemoved ? `; ${r.accountsRemoved} connection${r.accountsRemoved === 1 ? '' : 's'} removed` : ''}`, 'success'); setReport(null); data.reload(); } catch (e) { setErr(errText(e)); } finally { setBusy(''); }
  };
  const readCa = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 200_000) { setErr('That file is too large for a CA certificate.'); return; }
    set({ caPem: await file.text(), caName: file.name });
  };
  const copy = async () => { try { await navigator.clipboard.writeText(v.redirectUri); toast('Copied', 'success'); } catch { toast('Select the address and copy it', 'info'); } };
  return (
    <div className="stack adm-gap" data-testid="gitlab-admin">
      {removing ? <ConfirmModal title="Switch GitLab off?" icon="warn" tone="danger" danger body={<p>The configuration and every person's stored GitLab token are deleted (OAuth tokens are revoked in GitLab). Linked projects keep their link and work again when GitLab is set up again. Nothing in GitLab is deleted.</p>}
        confirmLabel="Switch off" onClose={() => setRemoving(false)} onConfirm={() => { setRemoving(false); void remove(); }} /> : null}
      <SectionHead title="GitLab" sub="Connect the intranet GitLab: people push and pull project sources, keep released PDFs as GitLab releases and review through merge requests. Until a configuration is saved here (it must pass the connection test), nobody else sees anything of GitLab."
        actions={v.enabled ? <Pill tone="success" icon="ok">On · GitLab {v.verifiedVersion ?? ''}</Pill> : <Pill icon="ban">Off</Pill>} />
      {v.secretProblem ? <Callout tone="danger" title="The saved secrets cannot be read">{v.secretProblem === 'other-key' ? 'They were encrypted with another key file (keys/secrets.key was replaced or restored from another machine).' : 'They are damaged.'} Type the application secret and service token again and save.</Callout> : null}
      <div className="adm-cols">
        <section className="card" aria-labelledby="gl-conn-h">
          <div className="card-head"><div className="adm-card-title"><h3 id="gl-conn-h"><Icon name="server" />Instance</h3><p className="faint">Where GitLab is, and how to trust its certificate.</p></div></div>
          <div className="card-body stack adm-gap">
            <Field label="GitLab address" hint="The address people open GitLab with, https only, e.g. https://gitlab.corp.local. Every request the platform makes stays on this address.">
              <input className="input mono" value={f.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} placeholder="https://gitlab.corp.local" data-testid="gitlab-base-url" />
            </Field>
            <Field label="Internal CA certificate (PEM)" hint="The certificate of the CA that signed GitLab's certificate, when it is not one this server already trusts. Used only for GitLab requests; nothing is installed on the machine.">
              <div className="row wrap">
                <label className="btn"><Icon name="upload" />Choose file<input type="file" accept=".pem,.crt,.cer,.txt" hidden onChange={(e) => void readCa(e.target.files?.[0])} data-testid="gitlab-ca-file" /></label>
                {f.caPem ? <><span className="adm-xs mono" data-testid="gitlab-ca-name">{f.caName || 'Certificate'}</span><button className="btn sm" onClick={() => set({ caPem: null, caName: '' })}>Remove</button></> : <span className="faint adm-xs">None: the system's trusted CAs are used.</span>}
              </div>
            </Field>
            {v.ca.length && f.caPem === v.config.caPem ? <ul className="adm-xs faint">{v.ca.map((c) => <li key={c.fingerprint256}>{c.subject} · valid to {c.validTo}</li>)}</ul> : null}
            <div className="adm-grid-2">
              <Field label="Timeout (seconds)" hint="For one GitLab request."><input className="input" type="number" min={2} max={300} value={f.timeoutSec} onChange={(e) => set({ timeoutSec: Number(e.target.value) })} data-testid="gitlab-timeout" /></Field>
              <Field label="Retries" hint="Reads only, after a network error or a busy GitLab."><input className="input" type="number" min={0} max={5} value={f.retries} onChange={(e) => set({ retries: Number(e.target.value) })} data-testid="gitlab-retries" /></Field>
            </div>
          </div>
        </section>
        <section className="card" aria-labelledby="gl-auth-h">
          <div className="card-head"><div className="adm-card-title"><h3 id="gl-auth-h"><Icon name="key" />Sign-in</h3><p className="faint">How people connect their own GitLab accounts.</p></div></div>
          <div className="card-body stack adm-gap">
            <Field label="Agastya address" hint="The address people open Agastya with. GitLab sends them back here after they agree.">
              <input className="input mono" value={f.appUrl} onChange={(e) => set({ appUrl: e.target.value })} data-testid="gitlab-app-url" />
            </Field>
            <Field label="Redirect URI" hint="In GitLab: Admin area > Applications > New application. Paste this as the redirect URI, tick Confidential and the scopes api and read_user.">
              <div className="row"><input className="input mono" readOnly value={v.redirectUri} aria-label="Redirect URI" data-testid="gitlab-redirect-uri" /><button className="btn" onClick={() => void copy()}><Icon name="copy" />Copy</button></div>
            </Field>
            <div className="adm-grid-2">
              <Field label="Application ID"><input className="input mono" value={f.oauthAppId} onChange={(e) => set({ oauthAppId: e.target.value })} data-testid="gitlab-app-id" /></Field>
              <Field label="Application secret" hint={v.hasClientSecret && !f.clearClientSecret ? 'Saved. Leave empty to keep it.' : undefined}>
                <input className="input mono" type="password" autoComplete="new-password" value={f.clientSecret} onChange={(e) => set({ clientSecret: e.target.value, clearClientSecret: false })} placeholder={v.hasClientSecret && !f.clearClientSecret ? '••••••••' : ''} data-testid="gitlab-app-secret" />
              </Field>
            </div>
            <div className="toggle"><span><div className="t">Personal access tokens</div><div className="d">People may connect with a token they create in GitLab (scope api) instead of signing in through GitLab.</div></span>
              <input type="checkbox" className="switch" role="switch" checked={f.allowPat} onChange={(e) => set({ allowPat: e.target.checked })} aria-label="Personal access tokens" data-testid="gitlab-allow-pat" /></div>
            <Field label="Service token (optional)" hint={v.hasServiceToken && !f.clearServiceToken ? 'Saved. Leave empty to keep it. Used to check the connection and, for reading only, for people who have not connected.' : 'A token of a GitLab service account. Used to check the connection and, for reading only, for people who have not connected.'}>
              <div className="row">
                <input className="input mono" type="password" autoComplete="new-password" value={f.serviceToken} onChange={(e) => set({ serviceToken: e.target.value, clearServiceToken: false })} placeholder={v.hasServiceToken && !f.clearServiceToken ? '••••••••' : ''} data-testid="gitlab-service-token" />
                {v.hasServiceToken ? <button className="btn sm" onClick={() => set({ clearServiceToken: true, serviceToken: '' })} disabled={f.clearServiceToken}>Forget</button> : null}
              </div>
            </Field>
            {!v.hasServiceToken && !f.serviceToken ? (
              <Field label="Token for this test only (optional)" hint="Without a service token the version check needs some token; it is used once and not kept.">
                <input className="input mono" type="password" autoComplete="off" value={f.testToken} onChange={(e) => set({ testToken: e.target.value })} data-testid="gitlab-test-token" />
              </Field>
            ) : null}
          </div>
        </section>
      </div>
      {report ? <Report r={report} /> : null}
      {err ? <Callout tone="danger" testId="gitlab-admin-error">{err}</Callout> : null}
      <div className="row end">
        {v.configured ? <button className="btn" disabled={!!busy} onClick={() => setRemoving(true)} data-testid="gitlab-remove"><Icon name="trash" />Switch off</button> : null}
        <button className="btn" disabled={!!busy || !f.baseUrl.trim()} onClick={() => void run('test')} data-testid="gitlab-test"><Icon name="activity" />{busy === 'test' ? 'Testing…' : 'Test connection'}</button>
        <button className="btn primary" disabled={!!busy || !report?.ok} title={report?.ok ? undefined : 'Test the connection first'} onClick={() => void run('save')} data-testid="gitlab-save"><Icon name="save" />{busy === 'save' ? 'Saving…' : 'Save'}</button>
      </div>
      {v.enabled ? <Accounts count={v.accounts} onChange={data.reload} /> : null}
    </div>
  );
}
