// WP-35 (UID-001): the one password field: label tied to the input, Show / Hide with aria-pressed, Caps Lock notice, back to hidden after a minute away.
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PasswordInput } from './PasswordInput';
import { Field } from './ui';
import { cleanup, click, render } from '../testing/render';

afterEach(() => { cleanup(); vi.useRealTimers(); });

function Form({ error }: { error?: string }) {
  const [v, setV] = useState('');
  return <Field label="Password" hint="At least 15 characters." error={error}><PasswordInput value={v} onChange={(e) => setV(e.target.value)} autoComplete="current-password" /></Field>;
}

describe('PasswordInput', () => {
  it('is the control of its Field: the label, the hint and the error reach the input', () => {
    const r = render(<Form error="Too short." />);
    const input = r.field('Password');
    expect(input.tagName).toBe('INPUT');
    expect(input.type).toBe('password');
    expect(input.getAttribute('autocomplete')).toBe('current-password');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(document.getElementById(input.getAttribute('aria-describedby')!.split(' ')[0])!.textContent).toBe('Too short.');
  });

  it('Show reveals and Hide hides; the button says what it does and its state, and its name does not contain "password"', () => {
    const r = render(<Form />);
    const input = r.field('Password');
    const toggle = r.$('[data-testid="password-reveal"]') as HTMLButtonElement;
    expect(toggle.type).toBe('button');                                    // never submits the form
    expect(toggle.textContent).toBe('Show');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(toggle.getAttribute('aria-controls')).toBe(input.id);
    expect(toggle.textContent!.toLowerCase()).not.toContain('password');
    click(toggle);
    expect(input.type).toBe('text');
    expect(toggle.textContent).toBe('Hide');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    click(toggle);
    expect(input.type).toBe('password');
  });

  it('shows a Caps Lock notice while Caps Lock is on, described by the input', () => {
    const r = render(<Form />);
    const input = r.field('Password');
    const press = (caps: boolean) => act(() => {
      const e = new KeyboardEvent('keydown', { key: 'a', bubbles: true });
      Object.defineProperty(e, 'getModifierState', { value: (k: string) => k === 'CapsLock' && caps });
      input.dispatchEvent(e);
    });
    press(true);
    const note = r.$('[data-testid="caps-lock"]');
    expect(note.textContent).toBe('Caps Lock is on');
    expect(input.getAttribute('aria-describedby')).toContain(note.id);
    press(false);
    expect(document.querySelector('[data-testid="caps-lock"]')).toBeNull();
  });

  it('goes back to hidden a minute after the field was left, not at once', () => {
    vi.useFakeTimers();
    const r = render(<Form />);
    const input = r.field('Password');
    click(r.$('[data-testid="password-reveal"]'));
    act(() => { input.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); });
    act(() => { vi.advanceTimersByTime(30_000); });
    expect(input.type).toBe('text');
    act(() => { vi.advanceTimersByTime(31_000); });
    expect(input.type).toBe('password');
  });
});
