// WP-23: the accessible building blocks (components/a11y.tsx) and the keyboard behaviour added to the shared dialogs and toasts, in jsdom.
import { act, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { HeadingLevel, RowButton, RowLink, SkipLink, splitterKeys, tablistKeys, useDocumentTitle } from './a11y';
import { PageHeader } from './PageHeader';
import { ConfirmModal, Modal, Toasts } from './ui';
import { useUi } from '../store/ui';
import { cleanup, click, key, render } from '../testing/render';

afterEach(() => { cleanup(); useUi.setState({ toasts: [] }); });

describe('SkipLink', () => {
  it('moves focus to the main landmark and does not change the address', () => {
    const r = render(<><SkipLink /><main id="main-content" tabIndex={-1}>Page</main></>);
    const before = location.href;
    click(r.$('[data-testid="skip-link"]'));
    expect(document.activeElement?.tagName).toBe('MAIN');
    expect(location.href).toBe(before);
  });
});

describe('useDocumentTitle', () => {
  it('joins the parts, drops empty and repeated ones', () => {
    function T({ parts }: { parts: Array<string | null> }) { useDocumentTitle(...parts); return null; }
    const r = render(<T parts={['Publication', 'Pump manual', null, 'Agastya Platform']} />);
    expect(document.title).toBe('Publication · Pump manual · Agastya Platform');
    r.rerender(<T parts={['Agastya Platform', 'Agastya Platform']} />);
    expect(document.title).toBe('Agastya Platform');
  });
});

describe('PageHeader level', () => {
  it('is the h1 of a page without a shell heading, and an h2 under the main shell', () => {
    render(<PageHeader icon="book" title="Release" />);
    expect(document.querySelector('h1')?.textContent).toBe('Release');
    cleanup();
    render(<HeadingLevel level={2}><PageHeader icon="book" title="Backup" /></HeadingLevel>);
    expect(document.querySelector('h1')).toBeNull();
    expect(document.querySelector('h2')?.textContent).toBe('Backup');
  });
});

describe('row targets', () => {
  it('RowLink opens without also firing the row, and leaves Ctrl+click to the browser', () => {
    const row = vi.fn(); const open = vi.fn();
    // a same-page address: jsdom implements only hash navigation, which the Ctrl+click below is allowed to perform
    const r = render(<table><tbody><tr onClick={row}><td><RowLink href="#projects-p1" onOpen={open}>Pump</RowLink></td></tr></tbody></table>);
    const a = r.$<HTMLAnchorElement>('a.v2-row-link');
    expect(a.getAttribute('href')).toBe('#projects-p1');
    click(a); expect(open).toHaveBeenCalledTimes(1); expect(row).not.toHaveBeenCalled();
    const notPrevented = a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
    expect(open).toHaveBeenCalledTimes(1); expect(notPrevented).toBe(true);
  });
  it('RowButton is a real button that says whether its row is selected', () => {
    const sel = vi.fn();
    const r = render(<RowButton onSelect={sel} selected>Preset A</RowButton>);
    const b = r.$('button.v2-row-link');
    expect(b.getAttribute('aria-pressed')).toBe('true');
    click(b); expect(sel).toHaveBeenCalledTimes(1);
  });
});

describe('tablistKeys', () => {
  it('moves focus with the arrows (wrapping), Home and End, skipping a disabled tab', () => {
    const r = render(<div role="tablist" onKeyDown={tablistKeys}><button role="tab">A</button><button role="tab" disabled>B</button><button role="tab">C</button><button role="tab">D</button></div>);
    const [a, , c, d] = r.$$<HTMLButtonElement>('[role="tab"]');
    a.focus();
    key(a, 'ArrowRight'); expect(document.activeElement).toBe(c);
    key(c, 'ArrowLeft'); expect(document.activeElement).toBe(a);
    key(a, 'ArrowLeft'); expect(document.activeElement).toBe(d);
    key(d, 'Home'); expect(document.activeElement).toBe(a);
    key(a, 'End'); expect(document.activeElement).toBe(d);
    expect(key(d, 'x').defaultPrevented).toBe(false);
  });
});

describe('splitterKeys', () => {
  it('steps, pages and jumps within the limits', () => {
    function S() { const [v, setV] = useState(50); return <div role="separator" tabIndex={0} aria-valuenow={v} onKeyDown={splitterKeys(v, 30, 80, 2, setV)} />; }
    const r = render(<S />);
    const sep = r.$('[role="separator"]');
    const now = () => Number(sep.getAttribute('aria-valuenow'));
    key(sep, 'ArrowRight'); expect(now()).toBe(52);
    key(sep, 'PageDown'); expect(now()).toBe(44);
    key(sep, 'End'); expect(now()).toBe(80);
    key(sep, 'ArrowRight'); expect(now()).toBe(80);
    key(sep, 'Home'); expect(now()).toBe(30);
    expect(key(sep, 'a').defaultPrevented).toBe(false);
  });
});

describe('dialogs (UX-004)', () => {
  it('Escape closes only the top dialog of two', () => {
    const outer = vi.fn(); const inner = vi.fn();
    const r = render(<><Modal title="Wizard" onClose={outer}><input /></Modal><ConfirmModal title="Discard?" body="Lost." onConfirm={() => {}} onClose={inner} /></>);
    key(window, 'Escape');
    expect(inner).toHaveBeenCalledTimes(1); expect(outer).not.toHaveBeenCalled();
    r.rerender(<Modal title="Wizard" onClose={outer}><input /></Modal>);
    key(window, 'Escape');
    expect(outer).toHaveBeenCalledTimes(1); expect(inner).toHaveBeenCalledTimes(1);
  });
});

describe('toasts (UX-028)', () => {
  it('a polite region is in the page before any message; an error is an alert outside it', () => {
    const r = render(<Toasts />);
    expect(r.$('[data-testid="toasts-polite"]').getAttribute('aria-live')).toBe('polite');
    act(() => { useUi.getState().toast('Saved'); useUi.getState().toast('Save failed', 'error'); });
    r.rerender(<Toasts />);
    expect(r.$('[data-testid="toasts-polite"]').textContent).toContain('Saved');
    const err = r.$('.v2-toast.error');
    expect(err.getAttribute('role')).toBe('alert');
    expect(err.closest('[aria-live]')).toBeNull();
  });
});
