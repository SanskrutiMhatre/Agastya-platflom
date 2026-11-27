import { useState } from 'react';
import { useSession } from '../store/session';
import { Alert, Field, Modal, errText } from './ui';

/**
 * FE-003: the session ended while the person was working (idle limit, time limit, a sign-in elsewhere, an administrator). The page under
 * this dialog stays mounted with everything typed in it; signing in again sends the request that failed (a Save) once more.
 */
export function ReauthDialog() {
  const reauth = useSession((s) => s.reauth);
  const user = useSession((s) => s.user);
  const resume = useSession((s) => s.resume);
  const abandon = useSession((s) => s.abandon);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!reauth || !user) return null;
  const go = async () => {
    setBusy(true); setErr('');
    try { await resume(password); setPassword(''); } catch (e) { setErr(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title="Sign in again to continue" sticky onClose={() => undefined} width={440} buttons={<>
      <button className="btn" onClick={abandon} disabled={busy} data-testid="reauth-signout">Sign out</button>
      <button className="btn btn-primary" form="reauth-form" disabled={busy || !password} data-testid="reauth-submit">Sign in</button>
    </>}>
      <form id="reauth-form" className="v2-stack" onSubmit={(e) => { e.preventDefault(); void go(); }} data-testid="reauth-dialog">
        <Alert tone="warn">{reauth.reason}</Alert>
        <p className="v2-hint" style={{ margin: 0 }}>Nothing you typed has been lost. Sign in as {user.fullName || user.username} and the page carries on where it was; a save that was refused is sent again.</p>
        <Field label="Password"><input className="v2-input" type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="reauth-password" /></Field>
        {err ? <Alert tone="bad">{err}</Alert> : null}
      </form>
    </Modal>
  );
}

/** FE-004: the server is not answering. The person stays signed in and the page stays as it is; the session store retries. */
export function UnreachableBanner() {
  const unreachable = useSession((s) => s.unreachable);
  if (!unreachable) return null;
  return <div className="v2-offline-banner" role="status" data-testid="server-unreachable">The server is not answering. Your work is still here; trying again…</div>;
}
