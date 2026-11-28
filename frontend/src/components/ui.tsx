// Shared UI primitives. Buttons, modals and form chrome reuse the Studio's own
// classes (.btn, .modal-*) so the platform and the embedded editor look alike.

import { Children, cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import { ApiError } from '../api/client';
import { useUi, type Toast } from '../store/ui';
import { Icon } from './Icon';

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * WP-35 (UID-003): the design-system pattern for a button that shows only an icon or a glyph. It always carries both an accessible name
 * (`aria-label`) and a tooltip (`title`): the browser shows the title on mouse hover and `FocusTooltip` shows the same text, themed, on
 * keyboard focus. `components/iconButtons.test.ts` fails the build for any icon-only `<button>` written without both.
 */
export function IconButton({ label, tip, icon, size, className = 'icon-btn', testId, onClick, disabled, pressed }: {
  label: string; tip?: string; icon: Parameters<typeof Icon>[0]['name']; size?: number; className?: string; testId?: string;
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void; disabled?: boolean; pressed?: boolean;
}) {
  return (
    <button type="button" className={className} aria-label={label} title={tip ?? label} data-testid={testId} onClick={onClick} disabled={disabled}
      aria-pressed={pressed === undefined ? undefined : pressed}><Icon name={icon} size={size} /></button>
  );
}

export function Spinner({ label }: { label?: string }) {
  return <span className="v2-row" role="status"><span className="v2-spin" />{label ? <span className="muted">{label}</span> : null}</span>;
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return <div className="v2-center"><Spinner label={label} /></div>;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="v2-empty"><strong className="v2-empty-title">{title}</strong>{children}</div>;
}

export function Badge({ tone, children, title }: { tone?: 'ok' | 'warn' | 'bad' | 'accent' | 'info'; children: ReactNode; title?: string }) {
  return <span className={`v2-badge ${tone ?? ''}`} title={title}>{children}</span>;
}

/** The mockup's `.alert` (components.css): the tone's icon, then the text in the primary ink on the tone's tint. The old tone names stay
 *  (bad, warn, ok); the `v2-alert` class stays as the hook of older rules. */
export function Alert({ tone, children }: { tone?: 'bad' | 'warn' | 'ok'; children: ReactNode }) {
  const t = tone === 'bad' ? 'danger' : tone === 'warn' ? 'warning' : tone === 'ok' ? 'success' : 'info';
  const icon: IconId = t === 'danger' ? 'alert' : t === 'warning' ? 'warn' : t === 'success' ? 'ok' : 'info';
  return <div className={`alert ${t} v2-alert${tone ? ` ${tone}` : ''}`} role={tone === 'bad' ? 'alert' : 'status'}><Icon name={icon} className="ico" /><div>{children}</div></div>;
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

export function Modal({ title, onClose, children, buttons, width, sticky, icon, tone }: { title: string; onClose: () => void; children: ReactNode; buttons?: ReactNode; width?: number; sticky?: boolean;
  /** The mockup's confirm dialog (docs/audit/mockups/admin.html): a round tinted icon before the title, no close button (Cancel and Escape close it). */
  icon?: IconId; tone?: 'danger' | 'warning' | 'info' }) {
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
      <div className={`modal${icon ? ' modal-confirm' : ''}`} role="dialog" aria-modal="true" aria-label={title} style={width ? { width } : undefined} ref={box} tabIndex={-1} onKeyDown={trap}>
        {icon
          ? <div className="modal-head"><span className={`ico-wrap ${tone ?? 'danger'}`} aria-hidden="true"><Icon name={icon} size={20} /></span><h2 className="modal-title">{title}</h2></div>
          : <div className="modal-head"><h2 className="modal-title">{title}</h2><IconButton label="Close" icon="close" onClick={onClose} /></div>}
        <div className="modal-body">{children}</div>
        {buttons ? <div className="modal-buttons">{buttons}</div> : null}
      </div>
    </div>
  );
}

export function ConfirmModal({ title, body, confirmLabel = 'Confirm', danger, busy, onConfirm, onClose, icon, tone }: {
  title: string; body: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void; onClose: () => void;
  /** The mockup's confirm dialog look: the icon in a tinted circle before the title, and on the confirm button. */
  icon?: IconId; tone?: 'danger' | 'warning' | 'info';
}) {
  return (
    // every confirmation is the mockup's confirm dialog (admin.html): the tone's icon in a tinted circle before the title
    <Modal title={title} onClose={onClose} width={460} icon={icon ?? (danger ? 'alert' : 'info')} tone={tone ?? (danger ? 'danger' : 'info')} buttons={<>
      <button className="btn" onClick={onClose}>Cancel</button>
      <button className={`btn btn-primary ${danger ? 'btn-danger-solid' : ''}`} disabled={busy} aria-busy={busy || undefined} onClick={onConfirm}>{icon && danger ? <Icon name={icon} size={14} /> : null}{confirmLabel}</button>
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
      {/* the mockup toast (admin.html): the kind's icon first, an icon dismiss button last */}
      <span className="v2-toast-ico" aria-hidden="true"><Icon name={t.kind === 'error' ? 'xcircle' : t.kind === 'success' ? 'ok' : 'info'} /></span>
      <span className="v2-toast-text">{t.text}</span>
      <button type="button" className="v2-toast-x" aria-label="Dismiss" title="Dismiss" onClick={(e) => { e.stopPropagation(); onDismiss(); }}><Icon name="close" size={14} /></button>
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

// ---------------------------------------------------------------------------------------------------------------------------------------
// UI redesign step 1 (owner-approved mockups, docs/audit/mockups): small React wrappers over the mockup classes of styles/components.css.
// Screens may also write the classes directly (<div className="card">); these exist so the common shapes are written once.

type IconId = Parameters<typeof Icon>[0]['name'];
/** The status tones of the mockups (badge, dot, alert, progress, toast). */
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'accent';

/** `.card` with an optional `.card-head` (icon, title, right-hand actions) and a `.card-body` (or the children as they are with `flush`). */
export function Card({ title, icon, actions, children, flush, className, id, testId }: {
  title?: ReactNode; icon?: IconId; actions?: ReactNode; children?: ReactNode; flush?: boolean; className?: string; id?: string; testId?: string;
}) {
  const hid = useId();
  return (
    <section className={`card${className ? ` ${className}` : ''}`} id={id} data-testid={testId} aria-labelledby={title ? hid : undefined}>
      {title || actions ? <div className="card-head"><h3 id={hid}>{icon ? <Icon name={icon} /> : null}{title}</h3>{actions ? <div className="row">{actions}</div> : null}</div> : null}
      {flush ? children : <div className="card-body">{children}</div>}
    </section>
  );
}

/** `.card.stat`: a big figure, its label and an optional detail line (with a tone colour and icon). */
export function StatTile({ value, label, detail, tone, icon, testId }: { value: ReactNode; label: ReactNode; detail?: ReactNode; tone?: Tone | 'muted'; icon?: IconId; testId?: string }) {
  const color = tone && tone !== 'muted' ? `var(--${tone === 'accent' ? 'text-link' : tone})` : undefined;
  return (
    <div className="card stat" data-testid={testId}>
      <div className="v">{value}</div><div className="l">{label}</div>
      {detail ? <div className={`d${color ? '' : ' muted'}`} style={color ? { color } : undefined}>{icon ? <Icon name={icon} size={14} /> : null}{detail}</div> : null}
    </div>
  );
}

/** `.badge` with a tone (the mockup's names: success, warning, danger, info, accent). */
export function Pill({ tone, children, title, icon }: { tone?: Tone; children: ReactNode; title?: string; icon?: IconId }) {
  return <span className={`badge${tone ? ` ${tone}` : ''}`} title={title}>{icon ? <Icon name={icon} size={14} /> : null}{children}</span>;
}

/** `.dot`: a status mark, always beside a text label (never colour alone). */
export const Dot = ({ tone }: { tone?: Tone }) => <span className={`dot${tone ? ` ${tone}` : ''}`} aria-hidden="true" />;

/** `.progress` as a progressbar with its accessible name. */
export function Progress({ value, max = 100, label, tone }: { value: number; max?: number; label: string; tone?: Exclude<Tone, 'accent'> }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return <div className="progress grow" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100} aria-label={label}><i className={tone} style={{ width: `${pct}%` }} /></div>;
}

/** `.alert` with an icon, a title line, text and actions on the right. */
export function Callout({ tone = 'info', title, children, actions, testId }: { tone?: Exclude<Tone, 'accent'>; title?: ReactNode; children?: ReactNode; actions?: ReactNode; testId?: string }) {
  const icon: IconId = tone === 'danger' ? 'alert' : tone === 'warning' ? 'warn' : tone === 'success' ? 'ok' : 'info';
  return (
    <div className={`alert ${tone}`} role={tone === 'danger' ? 'alert' : 'status'} data-testid={testId}>
      <Icon name={icon} className="ico" /><div>{title ? <div className="title">{title}</div> : null}{children}</div>{actions ? <div className="actions">{actions}</div> : null}
    </div>
  );
}

/** `.seg`: a segmented choice. Each option is a toggle button (aria-pressed); `count` is shown after the label. */
export function Seg<T extends string>({ label, value, options, onChange, testId }: { label: string; value: T; options: Array<{ value: T; label: ReactNode; count?: number; title?: string }>; onChange: (v: T) => void; testId?: string }) {
  return (
    <div className="seg" role="group" aria-label={label} data-testid={testId}>
      {options.map((o) => <button key={o.value} type="button" aria-pressed={value === o.value} title={o.title} onClick={() => onChange(o.value)}>{o.label}{o.count !== undefined ? <span className="faint"> {o.count}</span> : null}</button>)}
    </div>
  );
}

/** `.empty-state`: an icon, a title, a line of help and the actions that fill the space. */
export function EmptyState({ icon = 'info', title, children, actions }: { icon?: IconId; title: string; children?: ReactNode; actions?: ReactNode }) {
  return <div className="empty-state"><Icon name={icon} size={28} /><div className="title">{title}</div>{children ? <div>{children}</div> : null}{actions ? <div className="actions">{actions}</div> : null}</div>;
}

/** Two-letter initials for `.avatar`. */
export const initialsOf = (name: string): string => name.split(/\s+/).filter(Boolean).map((p) => p.charAt(0)).slice(0, 2).join('').toUpperCase();
