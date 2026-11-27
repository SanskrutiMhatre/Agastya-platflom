// WP-35 (UID-001): every password field of the application. A Show / Hide button (aria-pressed, keyboard reachable) reveals what was typed,
// a notice says when Caps Lock is on, paste and password managers work (the autoComplete of the caller is kept, nothing is blocked).
// The value goes hidden again when the field has been left for a minute, and of course whenever the page changes (the component unmounts).
// Used inside <Field>: Field gives it the id and the description like a native input (`fieldControl`).
//
// The button's name is "Show" / "Hide", deliberately without the word "password": a label lookup for "Password" must find the field only.

import { useEffect, useId, useRef, useState, type InputHTMLAttributes, type KeyboardEvent } from 'react';

const HIDE_AFTER_MS = 60_000;

export function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { className, onKeyDown, onKeyUp, onBlur, onFocus, ...rest } = props;
  const [shown, setShown] = useState(false);
  const [caps, setCaps] = useState(false);
  const capsId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const readCaps = (e: KeyboardEvent<HTMLInputElement>) => { if (typeof e.getModifierState === 'function') setCaps(e.getModifierState('CapsLock')); };
  const describedBy = [rest['aria-describedby'], caps ? capsId : ''].filter(Boolean).join(' ') || undefined;
  return (
    <span className="v2-pw">
      <span className="v2-pw-row">
        <input {...rest} className={className ?? 'v2-input'} type={shown ? 'text' : 'password'} aria-describedby={describedBy}
          autoCapitalize="off" autoCorrect="off" spellCheck={false}
          onKeyDown={(e) => { readCaps(e); onKeyDown?.(e); }}
          onKeyUp={(e) => { readCaps(e); onKeyUp?.(e); }}
          onFocus={(e) => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } onFocus?.(e); }}
          onBlur={(e) => { setCaps(false); if (shown) timer.current = setTimeout(() => setShown(false), HIDE_AFTER_MS); onBlur?.(e); }} />
        <button type="button" className="v2-pw-toggle" aria-pressed={shown} aria-controls={rest.id}
          title={shown ? 'Hide the characters you typed' : 'Show the characters you typed'} data-testid="password-reveal"
          onClick={() => setShown((s) => !s)}>{shown ? 'Hide' : 'Show'}</button>
      </span>
      {caps ? <span id={capsId} className="v2-pw-caps" role="status" data-testid="caps-lock">Caps Lock is on</span> : null}
    </span>
  );
}
PasswordInput.fieldControl = true;
