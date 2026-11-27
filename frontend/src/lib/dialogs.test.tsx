// @vitest-environment jsdom
// WP-35 (GAP-002): the dialog service and the architecture rule "no native browser dialog in the source".
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { alertDialog, confirmDialog, dialogQueue, promptDialog } from './dialogs';
import { DialogHost } from '../components/DialogHost';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SRC = join(__dirname, '..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  return statSync(p).isDirectory() ? files(p) : /\.(ts|tsx)$/.test(n) && !/\.test\.tsx?$/.test(n) ? [p] : [];
});
// The Studio's own dialog class defines methods called confirm() and alert() (studio/ui/dialogs.ts) and every Studio caller goes through
// `this.dialogs.` / `app.dialogs.`: a property access, which the rule below does not match.
const NATIVE = /(?:\b(?:window|globalThis|self|top|parent)\s*\.\s*|(?<![.\w$]))(confirm|prompt|alert)\s*\(/g;
const DEFINITION = /^\s*(?:async\s+)?(confirm|prompt|alert)\s*\([^)]*:\s*\w/;

function nativeDialogCalls(text: string): string[] {
  const hits: string[] = [];
  text.split(/\r?\n/).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '');
    if (DEFINITION.test(code)) return;
    for (const m of code.matchAll(NATIVE)) hits.push(`${i + 1}: ${m[0].trim()}`);
  });
  return hits;
}

describe('no native browser dialog (GAP-002)', () => {
  it('finds no window.confirm / prompt / alert anywhere in src', () => {
    const found = files(SRC).flatMap((f) => nativeDialogCalls(readFileSync(f, 'utf8')).map((h) => `${relative(SRC, f)}:${h}`));
    expect(found).toEqual([]);
  });
  it('the rule is not vacuous: it catches each form and leaves the Studio method and its callers alone', () => {
    expect(nativeDialogCalls("if (window.confirm('x')) go();")).toHaveLength(1);
    expect(nativeDialogCalls("const t = prompt('rows', '');")).toHaveLength(1);
    expect(nativeDialogCalls("globalThis.alert('x')")).toHaveLength(1);
    expect(nativeDialogCalls("  confirm(title: string, message: string): Promise<string> {")).toEqual([]);
    expect(nativeDialogCalls("await this.dialogs.confirm('t', 'm', [])")).toEqual([]);
    expect(nativeDialogCalls("await confirmDialog({ title: 't' })")).toEqual([]);
  });
});

describe('dialog service', () => {
  let host: HTMLDivElement | null = null;
  afterEach(() => { host?.remove(); host = null; });
  const mount = async () => {
    host = document.createElement('div'); document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => { root.render(<DialogHost />); });
    return root;
  };
  const click = async (id: string) => { await act(async () => { (document.querySelector(`[data-testid="${id}"]`) as HTMLButtonElement).click(); }); };

  it('confirm resolves true on the confirm button and false on Cancel; the danger tone and the message are shown', async () => {
    await mount();
    let p!: Promise<boolean>;
    await act(async () => { p = confirmDialog({ title: 'Delete the plate?', message: 'This removes plate I-A with its 2 views and 14 parts.', confirmLabel: 'Delete plate', danger: true }); });
    const dlg = document.querySelector('[role="dialog"]')!;
    expect(dlg.getAttribute('aria-label')).toBe('Delete the plate?');
    expect(dlg.textContent).toContain('14 parts');
    expect(document.querySelector('[data-testid="app-dialog-confirm"]')!.className).toContain('btn-danger-solid');
    expect(document.activeElement?.getAttribute('data-testid')).toBe('app-dialog-cancel');          // the safe choice has the focus
    await click('app-dialog-confirm');
    await expect(p).resolves.toBe(true);
    await act(async () => { p = confirmDialog({ title: 'Again?' }); });
    await click('app-dialog-cancel');
    await expect(p).resolves.toBe(false);
    expect(dialogQueue()).toHaveLength(0);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('prompt returns the typed text (several lines) or null; alert resolves on OK', async () => {
    await mount();
    let p!: Promise<string | null>;
    await act(async () => { p = promptDialog({ title: 'Paste rows', label: 'Rows', multiline: true, initial: 'a\tb\nc\td' }); });
    const area = document.querySelector('[data-testid="app-dialog-input"]') as HTMLTextAreaElement;
    expect(area.tagName).toBe('TEXTAREA');
    expect(document.querySelector('label')!.htmlFor).toBe(area.id);
    await click('app-dialog-confirm');
    await expect(p).resolves.toBe('a\tb\nc\td');
    await act(async () => { p = promptDialog({ title: 'Name', label: 'Name' }); });
    await click('app-dialog-cancel');
    await expect(p).resolves.toBeNull();
    let a!: Promise<void>;
    await act(async () => { a = alertDialog({ title: 'Done', message: 'Saved.' }); });
    expect(document.querySelector('[data-testid="app-dialog-cancel"]')).toBeNull();
    await click('app-dialog-confirm');
    await expect(a).resolves.toBeUndefined();
  });

  it('Escape closes only the top dialog and answers it as cancelled', async () => {
    await mount();
    let first!: Promise<boolean>, second!: Promise<boolean>;
    await act(async () => { first = confirmDialog({ title: 'First' }); });
    await act(async () => { second = confirmDialog({ title: 'Second' }); });
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2);
    await act(async () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    await expect(second).resolves.toBe(false);
    expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    await click('app-dialog-confirm');
    await expect(first).resolves.toBe(true);
  });
});
