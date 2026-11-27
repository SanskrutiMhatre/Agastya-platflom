// Everything that happens before the dashboard: first-run setup, sign-in, the
// onboarding gate (a new account chooses its own username and password) and the
// forced-password-change gate. The server enforces the gates; these screens are
// simply the only way out of them.

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { authApi } from '../api';
import { Icon } from '../components/Icon';
import { Alert, Field, errText } from '../components/ui';
import { PasswordInput } from '../components/PasswordInput';
import { useSession } from '../store/session';
import { useDocumentTitle } from '../components/a11y';

function Frame({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  useDocumentTitle(title, 'Agastya Platform');   // WP-23 (WCAG 2.4.2)
  return (
    <main className="v2-auth">
      <div className="v2-card v2-auth-card">
        <div className="v2-row v2-auth-brand">
          <span className="v2-brand-mark"><Icon name="book" size={16} /></span><strong>Agastya Platform</strong>
        </div>
        <h1>{title}</h1>
        {sub ? <p className="v2-sub">{sub}</p> : <div className="v2-auth-gap" />}
        {children}
      </div>
      <p className="v2-auth-foot">Offline · on-premises</p>
    </main>
  );
}

function Form({ onSubmit, children, submit, busy, error }: { onSubmit: () => Promise<void>; children: ReactNode; submit: string; busy: boolean; error: string }) {
  return (
    <form className="v2-stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void onSubmit(); }}>
      {children}
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <button className="btn btn-primary v2-auth-submit" disabled={busy} aria-busy={busy || undefined}>{busy ? 'Please wait…' : submit}</button>
    </form>
  );
}

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return { busy, error, run, setError };
}

/**
 * WP-35 (UID-002): the "repeat password" check belongs to the repeat field: its message sits under it (aria-invalid, announced), the focus
 * moves to it on submit, and the message goes as soon as the two agree. Nothing is sent to the server while they differ.
 */
function useRepeat(p: string, p2: string) {
  const id = useId();
  const [error, setError] = useState('');
  const check = (): boolean => {
    if (p === p2) { setError(''); return true; }
    setError('The passwords do not match.');
    document.getElementById(id)?.focus();
    return false;
  };
  return { id, error: error && p !== p2 ? error : '', check };
}

function Login() {
  const { login, signedOutReason } = useSession();
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [forgot, setForgot] = useState(false);
  const [sent, setSent] = useState(false);
  const a = useAction();

  if (forgot) {
    return (
      <Frame title="Reset your password" sub="Password reset is approved by a software administrator — there is no email on an offline system.">
        {sent
          ? <Alert tone="ok">If that account exists, an administrator has been notified and will give you a temporary password.</Alert>
          : <Form submit="Ask an administrator" busy={a.busy} error={a.error} onSubmit={() => a.run(async () => { await authApi.forgot(u); setSent(true); })}>
            <Field label="Username"><input className="v2-input" autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" /></Field>
          </Form>}
        <p className="v2-auth-alt"><button type="button" className="v2-linkbtn" onClick={() => { a.setError(''); setForgot(false); setSent(false); }}>Back to sign in</button></p>
      </Frame>
    );
  }
  return (
    <Frame title="Sign in" sub="Offline, on-premises authoring and publishing for S1000D, JSS and JSG.">
      {signedOutReason && <Alert tone="warn">{signedOutReason}</Alert>}
      <Form submit="Sign in" busy={a.busy} error={a.error} onSubmit={() => a.run(() => login(u, p))}>
        <Field label="Username"><input className="v2-input" autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" name="username" /></Field>
        <Field label="Password"><PasswordInput value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" name="password" /></Field>
      </Form>
      <p className="v2-auth-alt"><button type="button" className="v2-linkbtn" onClick={() => { a.setError(''); setForgot(true); }}>Forgot your password?</button></p>
    </Frame>
  );
}

function Setup() {
  const { setup } = useSession();
  const [name, setName] = useState('');
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const rep = useRepeat(p, p2);
  const a = useAction();
  return (
    <Frame title="Set up Agastya" sub="No account exists yet. Create the software administrator — you choose the credentials, nothing ships with a default.">
      <Form submit="Create administrator" busy={a.busy} error={a.error} onSubmit={() => (rep.check() ? a.run(async () => {
        await setup(u, p, name);
      }) : Promise.resolve())}>
        <Field label="Full name"><input className="v2-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} name="fullName" /></Field>
        <Field label="Username" hint="3–32 characters: lowercase letters, digits, dot, dash, underscore."><input className="v2-input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" name="username" /></Field>
        <Field label="Password" hint="At least 15 characters (a few words make a good one), and not a common password or your name."><PasswordInput value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" name="password" /></Field>
        <Field label="Repeat password" error={rep.error}><PasswordInput id={rep.id} value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" name="password2" /></Field>
      </Form>
    </Frame>
  );
}

function Onboarding() {
  const { load, user, logout } = useSession();
  const [u, setU] = useState(user?.username ?? '');
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const rep = useRepeat(p, p2);
  const a = useAction();
  return (
    <Frame title={`Welcome, ${user?.fullName ?? ''}`} sub="Choose your own username and password to finish setting up your account. The temporary password you were given stops working.">
      <Form submit="Finish" busy={a.busy} error={a.error} onSubmit={() => (rep.check() ? a.run(async () => {
        await authApi.onboarding({ username: u, password: p });
        await load();
      }) : Promise.resolve())}>
        <Field label="Username" hint="You cannot change this later."><input className="v2-input" autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" name="username" /></Field>
        <Field label="New password"><PasswordInput value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" name="password" /></Field>
        <Field label="Repeat password" error={rep.error}><PasswordInput id={rep.id} value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" name="password2" /></Field>
      </Form>
      <p className="v2-auth-alt"><button type="button" className="v2-linkbtn" onClick={() => { void logout(); }}>Sign out</button></p>
    </Frame>
  );
}

function ForcedChange() {
  const { load, logout } = useSession();
  const [cur, setCur] = useState('');
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const rep = useRepeat(p, p2);
  const a = useAction();
  return (
    <Frame title="Choose a new password" sub="An administrator reset your password. Set a new one to continue.">
      <Form submit="Change password" busy={a.busy} error={a.error} onSubmit={() => (rep.check() ? a.run(async () => {
        await authApi.changePassword(cur, p);
        await load();
      }) : Promise.resolve())}>
        <Field label="Temporary password"><PasswordInput autoFocus value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password"><PasswordInput value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Repeat password" error={rep.error}><PasswordInput id={rep.id} value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></Field>
      </Form>
      <p className="v2-auth-alt"><button type="button" className="v2-linkbtn" onClick={() => { void logout(); }}>Sign out</button></p>
    </Frame>
  );
}

export function AuthScreens() {
  const { status, gates } = useSession();
  if (status === 'setup') return <Setup />;
  if (status === 'gated') return gates.onboarding ? <Onboarding /> : <ForcedChange />;
  return <Login />;
}
