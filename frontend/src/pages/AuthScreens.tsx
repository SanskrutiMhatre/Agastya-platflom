// Everything that happens before the dashboard: first-run setup, sign-in, the
// onboarding gate (a new account chooses its own username and password) and the
// forced-password-change gate. The server enforces the gates; these screens are
// simply the only way out of them.

import { useState, type FormEvent, type ReactNode } from 'react';
import { authApi } from '../api';
import { Icon } from '../components/Icon';
import { Alert, Field, errText } from '../components/ui';
import { useSession } from '../store/session';

function Frame({ title, sub, children }: { title: string; sub?: string; children: ReactNode }) {
  return (
    <div className="v2-auth">
      <div className="v2-card v2-auth-card">
        <div className="v2-row" style={{ marginBottom: 16 }}>
          <span className="v2-brand-mark"><Icon name="book" size={16} /></span><strong style={{ fontSize: 15 }}>Agastya Platform</strong>
        </div>
        <h1>{title}</h1>
        {sub ? <p className="v2-sub" style={{ marginBottom: 16 }}>{sub}</p> : <div style={{ height: 12 }} />}
        {children}
      </div>
    </div>
  );
}

function Form({ onSubmit, children, submit, busy, error }: { onSubmit: () => Promise<void>; children: ReactNode; submit: string; busy: boolean; error: string }) {
  return (
    <form className="v2-stack" onSubmit={(e: FormEvent) => { e.preventDefault(); void onSubmit(); }}>
      {children}
      {error ? <Alert tone="bad">{error}</Alert> : null}
      <button className="btn btn-primary" style={{ justifyContent: 'center', height: 34 }} disabled={busy}>{busy ? 'Please wait…' : submit}</button>
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

function Login() {
  const { login } = useSession();
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
        <p style={{ marginTop: 14 }}><a href="#" onClick={(e) => { e.preventDefault(); setForgot(false); setSent(false); }}>Back to sign in</a></p>
      </Frame>
    );
  }
  return (
    <Frame title="Sign in" sub="Offline, on-premises S1000D authoring and publishing.">
      <Form submit="Sign in" busy={a.busy} error={a.error} onSubmit={() => a.run(() => login(u, p))}>
        <Field label="Username"><input className="v2-input" autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" name="username" /></Field>
        <Field label="Password"><input className="v2-input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" name="password" /></Field>
      </Form>
      <p style={{ marginTop: 14 }}><a href="#" onClick={(e) => { e.preventDefault(); setForgot(true); }}>Forgot your password?</a></p>
    </Frame>
  );
}

function Setup() {
  const { setup } = useSession();
  const [name, setName] = useState('');
  const [u, setU] = useState('');
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const a = useAction();
  return (
    <Frame title="Set up Agastya" sub="No account exists yet. Create the software administrator — you choose the credentials, nothing ships with a default.">
      <Form submit="Create administrator" busy={a.busy} error={a.error} onSubmit={() => a.run(async () => {
        if (p !== p2) throw new Error('The passwords do not match.');
        await setup(u, p, name);
      })}>
        <Field label="Full name"><input className="v2-input" autoFocus value={name} onChange={(e) => setName(e.target.value)} name="fullName" /></Field>
        <Field label="Username" hint="3–32 characters: lowercase letters, digits, dot, dash, underscore."><input className="v2-input" value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" name="username" /></Field>
        <Field label="Password" hint="At least 8 characters, and not a common password."><input className="v2-input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" name="password" /></Field>
        <Field label="Repeat password"><input className="v2-input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" name="password2" /></Field>
      </Form>
    </Frame>
  );
}

function Onboarding() {
  const { load, user, logout } = useSession();
  const [u, setU] = useState(user?.username ?? '');
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const a = useAction();
  return (
    <Frame title={`Welcome, ${user?.fullName ?? ''}`} sub="Choose your own username and password to finish setting up your account. The temporary password you were given stops working.">
      <Form submit="Finish" busy={a.busy} error={a.error} onSubmit={() => a.run(async () => {
        if (p !== p2) throw new Error('The passwords do not match.');
        await authApi.onboarding({ username: u, password: p });
        await load();
      })}>
        <Field label="Username" hint="You cannot change this later."><input className="v2-input" autoFocus value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" name="username" /></Field>
        <Field label="New password"><input className="v2-input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" name="password" /></Field>
        <Field label="Repeat password"><input className="v2-input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" name="password2" /></Field>
      </Form>
      <p style={{ marginTop: 14 }}><a href="#" onClick={(e) => { e.preventDefault(); void logout(); }}>Sign out</a></p>
    </Frame>
  );
}

function ForcedChange() {
  const { load, logout } = useSession();
  const [cur, setCur] = useState('');
  const [p, setP] = useState('');
  const [p2, setP2] = useState('');
  const a = useAction();
  return (
    <Frame title="Choose a new password" sub="An administrator reset your password. Set a new one to continue.">
      <Form submit="Change password" busy={a.busy} error={a.error} onSubmit={() => a.run(async () => {
        if (p !== p2) throw new Error('The passwords do not match.');
        await authApi.changePassword(cur, p);
        await load();
      })}>
        <Field label="Temporary password"><input className="v2-input" type="password" autoFocus value={cur} onChange={(e) => setCur(e.target.value)} autoComplete="current-password" /></Field>
        <Field label="New password"><input className="v2-input" type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="new-password" /></Field>
        <Field label="Repeat password"><input className="v2-input" type="password" value={p2} onChange={(e) => setP2(e.target.value)} autoComplete="new-password" /></Field>
      </Form>
      <p style={{ marginTop: 14 }}><a href="#" onClick={(e) => { e.preventDefault(); void logout(); }}>Sign out</a></p>
    </Frame>
  );
}

export function AuthScreens() {
  const { status, gates } = useSession();
  if (status === 'setup') return <Setup />;
  if (status === 'gated') return gates.onboarding ? <Onboarding /> : <ForcedChange />;
  return <Login />;
}
