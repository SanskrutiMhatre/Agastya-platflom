// Shared UI primitives. Buttons, modals and form chrome reuse the Studio's own
// classes (.btn, .modal-*) so the platform and the embedded editor look alike.

import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useUi } from '../store/ui';
import { Icon } from './Icon';

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function Spinner({ label }: { label?: string }) {
  return <span className="v2-row" role="status"><span className="v2-spin" />{label ? <span className="muted">{label}</span> : null}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="v2-center"><Spinner label={label} /></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="v2-empty"><strong>{title}</strong>{children}</div>;
}

export function Badge({ tone, children, title }: { tone?: 'ok' | 'warn' | 'bad' | 'accent'; children: ReactNode; title?: string }) {
  return <span className={`v2-badge ${tone ?? ''}`} title={title}>{children}</span>;
}

export function Alert({ tone, children }: { tone?: 'bad' | 'warn' | 'ok'; children: ReactNode }) {
  return <div className={`v2-alert ${tone ?? ''}`} role={tone === 'bad' ? 'alert' : 'status'}>{children}</div>;
}

/**
 * A labelled form control. The label is tied to the control (htmlFor/id) so it is announced by
 * screen readers and clicking it focuses the field; the id is given to the first element child
 * that does not already have one.
 */
export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: ReactNode }) {
  const id = useId();
  let tagged = false;
  const kids = Children.map(children, (c) => {
    if (!tagged && isValidElement(c) && typeof c.type === 'string' && /^(input|select|textarea)$/.test(c.type)) {
      tagged = true;
      const el = c as ReactElement<{ id?: string; 'aria-describedby'?: string }>;
      return cloneElement(el, { id: el.props.id ?? id, 'aria-describedby': hint || error ? `${id}-note` : undefined });
    }
    return c;
  });
  return (
    <div className="v2-field">
      <label htmlFor={id}>{label}</label>
      {kids}
      {error ? <span id={`${id}-note`} className="v2-error" role="alert">{error}</span> : hint ? <span id={`${id}-note`} className="v2-hint">{hint}</span> : null}
    </div>
  );
}

/** `sticky`: a click on the dimmed backdrop does not close it (a dialog that holds work in progress); Escape and the close button still do. */
export function Modal({ title, onClose, children, buttons, width, sticky }: { title: string; onClose: () => void; children: ReactNode; buttons?: ReactNode; width?: number; sticky?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (!sticky && e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined}>
        <div className="modal-head"><h2 className="modal-title">{title}</h2><button className="icon-btn" aria-label="Close" onClick={onClose}><Icon name="close" /></button></div>
        <div className="modal-body">{children}</div>
        {buttons ? <div className="modal-buttons">{buttons}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, body, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose }: {
  title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal title={title} onClose={onClose} width={460} buttons={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn btn-primary ${danger ? 'btn-danger-solid' : ''}`} style={danger ? { background: 'var(--danger)', borderColor: 'var(--danger)' } : undefined} disabled={busy} onClick={onConfirm}>{confirmLabel}</button>
    </>}>{body}</Modal>
  );
}

/** A modal with one text field - used for naming folders, projects, templates. */
export function PromptModal({ title, label, initial = '', hint, confirmLabel = 'Save', onSubmit, onClose }: {
  title: string; label: string; initial?: string; hint?: string; confirmLabel?: string; onSubmit: (v: string) => Promise<void>; onClose: () => void;
}) {
  const [v, setV] = useState(initial);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr('');
    try { await onSubmit(v.trim()); onClose(); } catch (e) { setErr(errText(e)); setBusy(false); }
  };
  return (
    <Modal title={title} onClose={onClose} width={440} buttons={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy || !v.trim()} onClick={submit}>{confirmLabel}</button>
    </>}>
      <Field label={label} hint={hint} error={err}>
        <input className="v2-input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim() && !busy) void submit(); }} />
      </Field>
    </Modal>
  );
}

export function Toasts() {
  const { toasts, dismiss } = useUi();
  return (
    <div className="v2-toasts" aria-live="polite">
      {toasts.map((t) => <div key={t.id} className={`v2-toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'} onClick={() => dismiss(t.id)}>{t.text}</div>)}
    </div>
  );
}

/** Load something on mount (and on `deps` change), exposing reload and error. Stale responses are discarded. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): { data: T | null; error: string; loading: boolean; reload: () => void; set: (v: T) => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const run = useRef(0);
  useEffect(() => {
    const mine = ++run.current;
    setLoading(true);
    fn().then((d) => { if (mine === run.current) { setData(d); setError(''); } })
      .catch((e) => { if (mine === run.current) setError(e instanceof ApiError && e.status === 404 ? 'Not found.' : errText(e)); })
      .finally(() => { if (mine === run.current) setLoading(false); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { data, error, loading, reload, set: setData };
}

export const ago = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
};

export const fmtDate = (iso: string | null | undefined): string => (iso ? new Date(iso).toLocaleString() : '—');
export const fmtSize = (n: number): string => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);
