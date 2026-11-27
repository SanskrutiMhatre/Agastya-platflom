// WP-09 (QA-016): component tests for the shared dialogs and form chrome (components/ui.tsx), in jsdom.
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmModal, Field, Modal, PromptModal, Toasts } from './ui';
import { useUi } from '../store/ui';
import { cleanup, click, key, mouseDown, render, settle, type } from '../testing/render';

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('Modal', () => {
  it('is a labelled modal dialog; Escape, the close button and a backdrop click close it', () => {
    const onClose = vi.fn();
    const r = render(<Modal title="Rename folder" onClose={onClose}><p>Body</p></Modal>);
    const dlg = r.$('[role="dialog"]');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBe('Rename folder');
    key(window, 'Escape'); expect(onClose).toHaveBeenCalledTimes(1);
    click(r.button('Close')); expect(onClose).toHaveBeenCalledTimes(2);
    mouseDown(r.$('.modal-backdrop')); expect(onClose).toHaveBeenCalledTimes(3);
    mouseDown(dlg); expect(onClose).toHaveBeenCalledTimes(3);          // a press inside the dialog is not a backdrop click
  });

  it('sticky: a backdrop click does not close a dialog that holds work; Escape still does', () => {
    const onClose = vi.fn();
    const r = render(<Modal title="Draft" sticky onClose={onClose}><input /></Modal>);
    mouseDown(r.$('.modal-backdrop')); expect(onClose).not.toHaveBeenCalled();
    key(window, 'Escape'); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the body on open and gives it back to the trigger on close (DS-005)', () => {
    const trigger = document.createElement('button'); trigger.textContent = 'Open'; document.body.appendChild(trigger); trigger.focus();
    const r = render(<Modal title="Focus" onClose={() => {}}><input id="first-field" /><input id="second-field" /></Modal>);
    expect(document.activeElement?.id).toBe('first-field');
    r.unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps Tab inside the dialog: Tab on the last control goes to the first, Shift+Tab on the first to the last', () => {
    // jsdom has no layout, so offsetParent is always null; give every element one so the trap sees the controls as visible
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetParent', 'get').mockImplementation(function (this: HTMLElement) { return this.parentElement; });
    try {
      const r = render(<Modal title="Trap" onClose={() => {}} buttons={<button>OK</button>}><input id="a" /></Modal>);
      const close = r.button('Close'); const ok = r.button('OK');
      ok.focus(); const ev = key(r.$('[role="dialog"]'), 'Tab');
      expect(ev.defaultPrevented).toBe(true); expect(document.activeElement).toBe(close);
      close.focus(); const back = key(r.$('[role="dialog"]'), 'Tab', { shiftKey: true });
      expect(back.defaultPrevented).toBe(true); expect(document.activeElement).toBe(ok);
    } finally { spy.mockRestore(); }
  });
});

describe('ConfirmModal', () => {
  it('Confirm calls onConfirm, Cancel calls onClose; busy disables Confirm and marks it busy', () => {
    const onConfirm = vi.fn(); const onClose = vi.fn();
    const r = render(<ConfirmModal title="Delete?" body="This removes it." confirmLabel="Delete" danger onConfirm={onConfirm} onClose={onClose} />);
    click(r.button('Delete')); expect(onConfirm).toHaveBeenCalledTimes(1);
    click(r.button('Cancel')); expect(onClose).toHaveBeenCalledTimes(1);
    expect(r.button('Delete').className).toContain('btn-danger-solid');
    r.rerender(<ConfirmModal title="Delete?" body="This removes it." confirmLabel="Delete" busy onConfirm={onConfirm} onClose={onClose} />);
    expect(r.button('Delete').disabled).toBe(true); expect(r.button('Delete').getAttribute('aria-busy')).toBe('true');
  });
});

describe('PromptModal', () => {
  it('Save is disabled while the field is empty or blank; Enter submits the trimmed value and closes', async () => {
    const onSubmit = vi.fn(async () => {}); const onClose = vi.fn();
    const r = render(<PromptModal title="New folder" label="Folder name" onSubmit={onSubmit} onClose={onClose} />);
    const input = r.field('Folder name');
    expect(document.activeElement).toBe(input);
    expect(r.button('Save').disabled).toBe(true);
    type(input, '   '); expect(r.button('Save').disabled).toBe(true);
    type(input, '  Manuals  '); expect(r.button('Save').disabled).toBe(false);
    key(input, 'Enter'); await settle();
    expect(onSubmit).toHaveBeenCalledWith('Manuals'); expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a refused save keeps the dialog open, shows the reason as an alert and marks the field invalid', async () => {
    const onClose = vi.fn();
    const r = render(<PromptModal title="New folder" label="Folder name" initial="Navy" onSubmit={async () => { throw new Error('A folder named "Navy" already exists.'); }} onClose={onClose} />);
    click(r.button('Save')); await settle();
    expect(onClose).not.toHaveBeenCalled();
    expect(r.$('[role="alert"]').textContent).toContain('already exists');
    const input = r.field('Folder name');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(r.$('[role="alert"]').id);
    expect(r.button('Save').disabled).toBe(false);                       // can try again
  });
});

describe('Field', () => {
  it('ties the label to the first control and the hint to aria-describedby; an existing id is kept', () => {
    const r = render(<div><Field label="Username" hint="3-32 characters"><input /></Field><Field label="Name"><input id="mine" /></Field></div>);
    const u = r.field('Username');
    expect(u.tagName).toBe('INPUT');
    expect(document.getElementById(u.getAttribute('aria-describedby') ?? '')?.textContent).toBe('3-32 characters');
    expect(u.getAttribute('aria-invalid')).toBeNull();
    expect(r.field('Name').id).toBe('mine');
    expect(r.field('Name').getAttribute('aria-describedby')).toBeNull();
  });
});

describe('Toasts', () => {
  beforeEach(() => { useUi.setState({ toasts: [] }); });

  it('shows the store\'s toasts, at most four; the dismiss button removes one', () => {
    for (let i = 1; i <= 5; i++) useUi.getState().toast(`Message ${i}`);
    const r = render(<Toasts />);
    expect(r.$$('.v2-toast').map((t) => t.querySelector('.v2-toast-text')?.textContent)).toEqual(['Message 2', 'Message 3', 'Message 4', 'Message 5']);
    click(r.$$('.v2-toast-x')[0]);
    expect(r.$$('.v2-toast')).toHaveLength(3);
  });

  it('an information toast goes after 3.2 s, an error stays 10 s and is announced as an alert', () => {
    vi.useFakeTimers();
    useUi.getState().toast('Saved'); useUi.getState().toast('Save failed', 'error');
    const r = render(<Toasts />);
    expect(r.$('.v2-toast.error').getAttribute('role')).toBe('alert');
    act(() => { vi.advanceTimersByTime(3300); });
    expect(r.$$('.v2-toast').map((t) => t.className)).toEqual(['v2-toast error']);
    act(() => { vi.advanceTimersByTime(7000); });
    expect(r.$$('.v2-toast')).toHaveLength(0);
  });
});
