// Phase 3 (P3-5): a person's own GitLab connection (Account page, and the project Repository page when they are not connected).
// Renders nothing while GitLab is switched off. OAuth goes through GitLab's own sign-in page and comes back with ?gitlab=connected or
// ?gitlab=error&reason=...; a personal access token is sent once to the server, which checks it and keeps it encrypted.
import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { gitlabApi, type GitlabMe } from '../api/gitlab';
import { Icon } from './Icon';
import { Callout, ConfirmModal, Field, Pill, errText, fmtDate, useAsync } from './ui';
import { useUi } from '../store/ui';

/** null while loading or when GitLab is off. */
export function useGitlabMe(): { me: GitlabMe | null; reload: () => void; loading: boolean } {
  const r = useAsync(() => gitlabApi.me(), []);
  return { me: r.data, reload: r.reload, loading: r.loading };
}

export function GitlabConnectCard({ returnTo, onChange, compact }: { returnTo?: string; onChange?: () => void; compact?: boolean }) {
  const toast = useUi((s) => s.toast);
  const { me, reload } = useGitlabMe();
  const loc = useLocation(); const nav = useNavigate();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [asking, setAsking] = useState(false);
  // the answer of the OAuth round trip
  useEffect(() => {
    const q = new URLSearchParams(loc.search);
    const g = q.get('gitlab');
    if (!g) return;
    if (g === 'connected') toast('GitLab account connected', 'success');
    else if (g === 'error') setErr(`GitLab did not connect: ${q.get('reason') || 'unknown reason'}`);
    q.delete('gitlab'); q.delete('reason');
    nav({ pathname: loc.pathname, search: q.toString() ? `?${q}` : '' }, { replace: true });
  }, [loc.search]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!me) return null;
  const done = () => { reload(); onChange?.(); };
  const oauth = async () => {
    setBusy(true); setErr('');
    try { const r = await gitlabApi.startOauth(returnTo ?? `${loc.pathname}`); window.location.assign(r.authorizeUrl); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  const withToken = async () => {
    setBusy(true); setErr('');
    try { await gitlabApi.connectToken(token.trim()); setToken(''); toast('GitLab account connected', 'success'); done(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const disconnect = async () => {
    setBusy(true); setErr('');
    try { await gitlabApi.disconnect(); toast('GitLab account disconnected', 'success'); done(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  const a = me.account;
  return (
    <section className="card" aria-labelledby="gl-me-h" data-testid="gitlab-connect">
      {asking ? <ConfirmModal title="Disconnect GitLab?" icon="unlock" tone="warning" body={<p>Agastya forgets your GitLab token{a?.method === 'oauth' ? ' and revokes it in GitLab' : ''}. Nothing in GitLab changes. You can connect again at any time.</p>}
        confirmLabel="Disconnect" onClose={() => setAsking(false)} onConfirm={() => { setAsking(false); void disconnect(); }} /> : null}
      <div className="card-head"><h3 id="gl-me-h"><Icon name="branch" />GitLab</h3>{a ? <Pill tone="success" icon="ok">Connected</Pill> : <Pill>Not connected</Pill>}</div>
      <div className="card-body stack adm-gap">
        {a ? (
          <>
            <p data-testid="gitlab-me-account">Connected as <strong className="mono">{a.username}</strong>{a.name ? ` (${a.name})` : ''} on <span className="mono">{me.baseUrl}</span>, {a.method === 'oauth' ? 'through GitLab sign-in' : 'with a personal access token'}, since {fmtDate(a.connectedAt)}.</p>
            <div className="row end"><button className="btn" disabled={busy} onClick={() => setAsking(true)} data-testid="gitlab-disconnect"><Icon name="unlock" />Disconnect</button></div>
          </>
        ) : (
          <>
            {compact ? null : <p className="faint">Connect your account on <span className="mono">{me.baseUrl}</span> to push, pull and review project sources in GitLab. Your token stays on the server, encrypted.</p>}
            {me.methods.oauth ? <div className="row end"><button className="btn primary" disabled={busy} onClick={() => void oauth()} data-testid="gitlab-connect-oauth"><Icon name="external" />Connect with GitLab</button></div> : null}
            {me.methods.pat ? (
              <Field label={me.methods.oauth ? 'Or a personal access token' : 'Personal access token'} hint="In GitLab: your avatar > Preferences > Access tokens, with the scope api.">
                <div className="row">
                  <input className="input mono" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} aria-label="Personal access token" data-testid="gitlab-pat" />
                  <button className="btn" disabled={busy || token.trim().length < 8} onClick={() => void withToken()} data-testid="gitlab-connect-pat">Connect</button>
                </div>
              </Field>
            ) : null}
          </>
        )}
        {err ? <Callout tone="danger" testId="gitlab-connect-error">{err}</Callout> : null}
      </div>
    </section>
  );
}
