// Shared UI primitives. Buttons, modals and form chrome reuse the Studio's own
// classes (.btn, .modal-*) so the platform and the embedded editor look alike.

import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactElement, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useUi, type Toast } from '../store/ui';
import { Icon } from './Icon';

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function Spinner({ label }: { label?: string }) {
  return <span className="v2-row" role="status"><span className="v2-spin" />{label ? <span className="muted">{label}</span> : null}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="v2-center"><Spinner label={label} /></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="v2-empty"><strong className="v2-empty-title">{title}</strong>{children}</div>;
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
  // WP-09: the label points at the control's own id when it has one (it used to point at the generated id, which then named nothing)
  let controlId = id;
  const kids = Children.map(children, (c) => {
    // WP-35: a component that marks itself `fieldControl` (PasswordInput) is tagged like a native control and passes the props to its input
    const isControl = isValidElement(c) && (typeof c.type === 'string' ? /^(input|select|textarea)$/.test(c.type) : !!(c.type as { fieldControl?: boolean }).fieldControl);
    if (!tagged && isValidElement(c) && isControl) {
      tagged = true;
      const el = c as ReactElement<{ id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }>;
      controlId = el.props.id ?? id;
      // UID-002: an error marks the control itself (styles/states.css draws the danger border), not only the text under it
      return cloneElement(el, { id: controlId, 'aria-describedby': hint || error ? `${id}-note` : undefined, 'aria-invalid': error ? true : el.props['aria-invalid'] });
    }
    return c;
  });
  return (
    <div className="v2-field">
      <label htmlFor={controlId}>{label}</label>
      {kids}
      {error ? <span id={`${id}-note`} className="v2-error" role="alert">{error}</span> : hint ? <span id={`${id}-note`} className="v2-hint">{hint}</span> : null}
    </div>
  );
}

/** `sticky`: a click on the dimmed backdrop does not close it (a dialog that holds work in progress); Escape and the close button still do. */
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** WP-23 (UX-004, FE-014): the open dialogs, innermost last. Escape closes only the top one (a waiver over a refusal, a confirm over the wizard). */
const openDialogs: object[] = [];

export function Modal({ title, onClose, children, buttons, width, sticky }: { title: string; onClose: () => void; children: ReactNode; buttons?: ReactNode; width?: number; sticky?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [me] = useState(() => ({}));
  useEffect(() => {
    openDialogs.push(me);
    return () => { const i = openDialogs.lastIndexOf(me); if (i >= 0) openDialogs.splice(i, 1); };
  }, [me]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || openDialogs[openDialogs.length - 1] !== me) return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, me]);
  // DS-005: focus moves into the dialog on open (an autoFocus field keeps it), Tab stays inside, and focus returns to the trigger on close.
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const body = el.querySelector<HTMLElement>(`.modal-body :is(${FOCUSABLE})`);
      (body ?? el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    }
    return () => { if (trigger && trigger.isConnected && typeof trigger.focus === 'function') trigger.focus(); };
  }, []);
  const trap = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab' || !box.current) return;
    const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null || x === document.activeElement);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  };
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (!sticky && e.target === e.currentTarget) onClose(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined} ref={box} tabIndex={-1} onKeyDown={trap}>
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
      <button className={`btn btn-primary ${danger ? 'btn-danger-solid' : ''}`} disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>{confirmLabel}</button>
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
      <button className="btn btn-primary" disabled={busy || !v.trim()} aria-busy={busy || undefined} onClick={submit}>{confirmLabel}</button>
    </>}>
      <Field label={label} hint={hint} error={err}>
        <input className="v2-input" autoFocus value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && v.trim() && !busy) void submit(); }} />
      </Field>
    </Modal>
  );
}

/**
 * WP-23 (UX-028, WCAG 4.1.3): success and information go to a polite live region that is always in the page (a region made at the moment
 * of the message is often not announced); an error is a role="alert" of its own outside that region, so it is announced at once and not
 * queued behind the polite ones.
 */
export function Toasts() {
  const { toasts, dismiss } = useUi();
  const item = (t: Toast) => <ToastItem key={t.id} toast={t} onDismiss={() => dismiss(t.id)} />;
  return (
    <div className="v2-toasts">
      <div className="v2-toast-region" aria-live="polite" data-testid="toasts-polite">{toasts.filter((t) => t.kind !== 'error').map(item)}</div>
      <div className="v2-toast-region" data-testid="toasts-errors">{toasts.filter((t) => t.kind === 'error').map(item)}</div>
    </div>
  );
}

/** DS-005: a toast has a dismiss button, pauses while the pointer or the keyboard is on it, and an error stays twice as long (10 s). */
function ToastItem({ toast: t, onDismiss }: { toast: Toast; onDismiss: () => void }) {
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return undefined;
    const timer = setTimeout(onDismiss, t.kind === 'error' ? 10000 : 3200);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, t.id]);
  return (
    <div className={'v2-toast ' + t.kind} role={t.kind === 'error' ? 'alert' : undefined} onClick={onDismiss}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}>
      <span className="v2-toast-text">{t.text}</span>
      <button type="button" className="v2-toast-x" aria-label="Dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(); }}>×</button>
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
